import { useState, useCallback, useEffect, useRef } from 'react';
import { useAsync } from 'react-use';
import { llm, mcp } from '@grafana/llm';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types';
import { backendMCPClient } from '../../../services/backendMCPClient';
import { toolRequestQueue } from '../../../services/queue';
import { RenderedToolCall } from '../types';

export const useMCPManager = () => {
  const [toolCalls, setToolCalls] = useState<Map<string, RenderedToolCall>>(new Map());

  // Track active tool call promises for cleanup
  const activeToolCallsRef = useRef<Set<Promise<any>>>(new Set());
  const isMountedRef = useRef(true);

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
    };
  }, []);

  const clearToolCalls = useCallback(() => {
    setToolCalls(new Map());
  }, []);

  const getAvailableTools = useCallback(async () => {
    try {
      // Get all tools from backend MCP proxy
      const tools = await backendMCPClient.listTools();

      console.log('[useMCPManager] Available tools from backend:', tools.length);

      return { tools };
    } catch (error) {
      console.error('Error fetching tools:', error);
      return { tools: [] };
    }
  }, []);

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
            console.log('[useMCPManager] Calling backend MCP tool:', f.name);

            const response = await backendMCPClient.callTool({ name: f.name, arguments: args });
            if (!response) {
              throw new Error('Backend MCP tool call returned null');
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

          throw error; // Re-throw for tracking
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
    []
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
