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

  const activeToolCallsRef = useRef<Set<Promise<any>>>(new Set());
  const isMountedRef = useRef(true);

  const pluginSettings = usePluginJsonData();
  const useBuiltInMCP = pluginSettings?.useBuiltInMCP ?? false;
  const hasExternalServers = pluginSettings?.mcpServers?.some((s) => s.enabled) ?? false;

  const mcpMode = useMemo(() => {
    if (useBuiltInMCP && hasExternalServers) {
      return 'combined';
    }
    return useBuiltInMCP ? 'built-in' : 'backend';
  }, [useBuiltInMCP, hasExternalServers]);

  const mcpClient = useMemo(() => {
    if (mcpMode === 'combined') {
      return new AggregatedMCPClient({
        builtInClient: builtInMCPClient,
        backendClient: backendMCPClient,
        useBuiltIn: true,
        useBackend: true,
      });
    }
    return useBuiltInMCP ? builtInMCPClient : backendMCPClient;
  }, [mcpMode, useBuiltInMCP]);

  // Cleanup on unmount
  useEffect(() => {
    const activeToolCalls = activeToolCallsRef.current;
    return () => {
      isMountedRef.current = false;
      if (activeToolCalls.size > 0) {
        activeToolCalls.clear();
      }
      if (useBuiltInMCP) {
        if (mcpClient instanceof AggregatedMCPClient) {
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
      const tools = await mcpClient.listTools();
      return { tools };
    } catch (error) {
      console.error('Error fetching tools:', error);
      return { tools: [] };
    }
  }, [mcpClient]);

  const updateToolCallState = useCallback(
    (id: string, updates: Partial<RenderedToolCall>) => {
      if (isMountedRef.current) {
        setToolCalls((prev) => {
          const existing = prev.get(id);
          return new Map(prev).set(id, { ...existing!, ...updates });
        });
      }
    },
    []
  );

  const handleToolCall = useCallback(
    async (toolCall: { function: { name: string; arguments: string }; id: string }, messages: llm.Message[]) => {
      const { function: f, id } = toolCall;

      if (isMountedRef.current) {
        setToolCalls((prev) => new Map(prev).set(id, { name: f.name, arguments: f.arguments, running: true }));
      }

      const args = JSON.parse(f.arguments);

      const toolCallPromise = toolRequestQueue
        .add(
          async () => {
            const response = await mcpClient.callTool({ name: f.name, arguments: args });
            if (!response) {
              throw new Error('MCP tool call returned null');
            }

            const toolResult = CallToolResultSchema.parse(response);
            const textContent = toolResult.content
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map((c) => c.text)
              .join('');

            // Ensure we always have content - Anthropic API rejects empty tool results
            const finalContent = textContent.trim() || 'No results returned (empty response)';

            messages.push({ role: 'tool', tool_call_id: id, content: finalContent });
            updateToolCallState(id, { running: false, response });

            return response;
          },
          {
            priority: 8, // Tool calls are important but lower priority than main LLM requests
            maxRetries: 1,
            id: `tool-${id}`,
          }
        )
        .catch((error: Error | { message?: string; toString(): string }) => {
          const errorMessage = error.message ?? error.toString();
          console.error('Tool call error:', errorMessage);

          messages.push({ role: 'tool', tool_call_id: id, content: errorMessage });
          updateToolCallState(id, { running: false, error: errorMessage });
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
    [mcpClient, updateToolCallState]
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
  };
};
