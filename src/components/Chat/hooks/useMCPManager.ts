import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAsync } from 'react-use';
import { llm, mcp } from '@grafana/llm';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types';
import { backendMCPClient } from '../../../services/backendMCPClient';
import { builtInMCPClient } from '../../../services/builtInMCPClient';
import { AggregatedMCPClient } from '../../../services/aggregatedMCPClient';
import { toolRequestQueue } from '../../../services/queue';
import { RenderedToolCall } from '../types';
import { usePluginJsonData } from '../../../hooks/usePluginJsonData';

export const useMCPManager = () => {
  const [toolCalls, setToolCalls] = useState<Map<string, RenderedToolCall>>(new Map());

  // Track active tool call promises for cleanup
  const activeToolCallsRef = useRef<Set<Promise<any>>>(new Set());
  const isMountedRef = useRef(true);

  // Determine which MCP client to use based on plugin settings
  const pluginSettings = usePluginJsonData();
  const useBuiltInMCP = pluginSettings?.useBuiltInMCP ?? false;
  const hasExternalServers = pluginSettings?.mcpServers?.some((s) => s.enabled) ?? false;

  // Select appropriate MCP client based on configuration
  const mcpClient = useMemo(() => {
    if (useBuiltInMCP && hasExternalServers) {
      // Combined mode: use aggregated client
      console.log('[useMCPManager] Using combined mode (built-in + external)');
      return new AggregatedMCPClient({
        builtInClient: builtInMCPClient,
        backendClient: backendMCPClient,
        useBuiltIn: true,
        useBackend: true,
      });
    } else if (useBuiltInMCP) {
      // Built-in only
      console.log('[useMCPManager] Using built-in MCP only');
      return builtInMCPClient;
    } else {
      // External only (or neither)
      console.log('[useMCPManager] Using backend MCP only');
      return backendMCPClient;
    }
  }, [useBuiltInMCP, hasExternalServers]);

  // Determine mode for logging
  const mcpMode = useBuiltInMCP && hasExternalServers ? 'combined' : useBuiltInMCP ? 'built-in' : 'backend';

  // Cleanup on unmount
  useEffect(() => {
    const activeToolCalls = activeToolCallsRef.current;
    return () => {
      isMountedRef.current = false;
      // Clear any pending tool calls
      if (activeToolCalls.size > 0) {
        console.log('[useMCPManager] Cleaning up:', activeToolCalls.size, 'active tool calls');
        activeToolCalls.clear();
      }
      // Disconnect built-in MCP client if used
      if (useBuiltInMCP) {
        if (mcpClient instanceof AggregatedMCPClient) {
          // Aggregated client handles cleanup internally
          mcpClient.disconnect();
        } else {
          builtInMCPClient.disconnect();
        }
      }
    };
  }, [useBuiltInMCP, mcpClient]);

  const clearToolCalls = useCallback(() => {
    setToolCalls(new Map());
  }, []);

  const getAvailableTools = useCallback(async () => {
    try {
      // Get tools from the selected MCP client
      const tools = await mcpClient.listTools();

      console.log('[useMCPManager] Available tools from', mcpMode, 'MCP:', tools.length);

      // Log statistics if using aggregated client
      if (mcpClient instanceof AggregatedMCPClient) {
        const stats = mcpClient.getStats();
        console.log(
          `[useMCPManager] Combined mode stats - Built-in: ${stats.builtInTools}, Backend: ${stats.backendTools}, Total: ${stats.totalTools}`
        );
      }

      return { tools };
    } catch (error) {
      console.error('Error fetching tools:', error);
      return { tools: [] };
    }
  }, [mcpClient, mcpMode]);

  const handleToolCall = useCallback(
    async (toolCall: { function: { name: string; arguments: string }; id: string }, messages: llm.Message[]) => {
      const { function: f, id } = toolCall;

      // Only update state if still mounted
      if (isMountedRef.current) {
        setToolCalls((prev) => new Map(prev).set(id, { name: f.name, arguments: f.arguments, running: true }));
      }

      const args = JSON.parse(f.arguments);

      // Create and track the tool call promise with queuing
      const toolCallPromise = toolRequestQueue
        .add(
          async () => {
            console.log('[useMCPManager] Calling', mcpMode, 'MCP tool:', f.name);

            const response = await mcpClient.callTool({ name: f.name, arguments: args });
            if (!response) {
              throw new Error('MCP tool call returned null');
            }

            const toolResult = CallToolResultSchema.parse(response);
            const textContent = toolResult.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');

            // Ensure we always have content - Anthropic API rejects empty tool results
            const finalContent = textContent.trim() || 'No results returned (empty response)';

            messages.push({ role: 'tool', tool_call_id: id, content: finalContent });

            // Only update state if still mounted
            if (isMountedRef.current) {
              setToolCalls((prev) => new Map(prev).set(id, { ...prev.get(id)!, running: false, response }));
            }

            return response;
          },
          {
            priority: 8, // Tool calls are important but lower priority than main LLM requests
            maxRetries: 1,
            id: `tool-${id}`,
          }
        )
        .catch((error: any) => {
          const errorMessage = error.message ?? error.toString();
          console.error('Tool call error:', errorMessage);

          messages.push({ role: 'tool', tool_call_id: id, content: errorMessage });

          // Only update state if still mounted
          if (isMountedRef.current) {
            setToolCalls((prev) => new Map(prev).set(id, { ...prev.get(id)!, running: false, error: errorMessage }));
          }

          // Don't re-throw to avoid unhandled rejection
          return null;
        });

      // Track the promise
      activeToolCallsRef.current.add(toolCallPromise);

      // Remove from tracking when complete
      toolCallPromise.finally(() => {
        activeToolCallsRef.current.delete(toolCallPromise);
      });

      // Wait for the tool call to complete
      await toolCallPromise;
    },
    [mcpClient, mcpMode]
  );

  const handleToolCalls = useCallback(
    async (
      toolCalls: Array<{ function: { name: string; arguments: string }; id: string }>,
      messages: llm.Message[]
    ) => {
      const functionCalls = toolCalls.filter((tc) => tc.function);
      await Promise.all(functionCalls.map((fc) => handleToolCall(fc, messages)));
    },
    [handleToolCall]
  );

  const getRunningToolCallsCount = useCallback(() => {
    return Array.from(toolCalls.values()).filter((tc) => tc.running).length;
  }, [toolCalls]);

  const hasRunningToolCalls = useCallback(() => {
    return getRunningToolCallsCount() > 0;
  }, [getRunningToolCallsCount]);

  const formatToolsForOpenAI = (tools: any[]) => {
    return mcp.convertToolsToOpenAI(tools);
  };

  const {
    loading: toolsLoading,
    error: toolsError,
    value: toolsData,
  } = useAsync(getAvailableTools, [getAvailableTools]);

  return {
    toolCalls,
    toolsLoading,
    toolsError,
    toolsData,
    clearToolCalls,
    handleToolCall,
    handleToolCalls,
    getRunningToolCallsCount,
    hasRunningToolCalls,
    formatToolsForOpenAI,
    getAvailableTools,
    // Expose which mode is active for debugging
    usingBuiltInMCP: useBuiltInMCP,
    mcpMode, // 'builtin', 'backend', or 'combined'
  };
};
