/**
 * Aggregated MCP Client
 *
 * Combines both built-in MCP (grafana-llm-app) and backend MCP (external servers)
 * to provide a unified interface when both are enabled simultaneously.
 *
 * Key Features:
 * - Fetches tools from both sources in parallel with error isolation
 * - Routes tool calls to the correct client based on tool registry
 * - No prefixing needed: backend already prefixes external tools with {serverid}_
 * - Graceful degradation: If one source fails, the other continues to work
 */

import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { BackendMCPClient } from './backendMCPClient';
import type { BuiltInMCPClient } from './builtInMCPClient';

interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
  scopeOrgId?: string;
}

interface AggregatedMCPClientOptions {
  builtInClient: BuiltInMCPClient;
  backendClient: BackendMCPClient;
  useBuiltIn: boolean;
  useBackend: boolean;
}

type ToolSource = 'builtin' | 'backend';

export class AggregatedMCPClient {
  private builtInClient: BuiltInMCPClient;
  private backendClient: BackendMCPClient;
  private useBuiltIn: boolean;
  private useBackend: boolean;

  // Simple registry: tool name -> source
  private toolRegistry: Map<string, ToolSource> = new Map();

  // Cached combined tools
  private cachedTools: Tool[] | null = null;

  constructor(options: AggregatedMCPClientOptions) {
    this.builtInClient = options.builtInClient;
    this.backendClient = options.backendClient;
    this.useBuiltIn = options.useBuiltIn;
    this.useBackend = options.useBackend;
  }

  /**
   * List tools from both sources and combine them
   * Uses Promise.allSettled for error isolation
   */
  async listTools(): Promise<Tool[]> {
    // Return cached if available
    if (this.cachedTools) {
      return this.cachedTools;
    }

    const promises: Promise<Tool[]>[] = [];

    if (this.useBuiltIn) {
      promises.push(this.builtInClient.listTools());
    }
    if (this.useBackend) {
      promises.push(this.backendClient.listTools());
    }

    // Fetch from both sources in parallel with error isolation
    const results = await Promise.allSettled(promises);

    const builtInTools: Tool[] = [];
    const backendTools: Tool[] = [];

    // Process built-in results
    if (this.useBuiltIn && results[0]) {
      if (results[0].status === 'fulfilled') {
        builtInTools.push(...results[0].value);
      } else {
        console.error('[AggregatedMCPClient] Built-in MCP failed:', results[0].reason);
      }
    }

    // Process backend results
    const backendIndex = this.useBuiltIn ? 1 : 0;
    if (this.useBackend && results[backendIndex]) {
      if (results[backendIndex].status === 'fulfilled') {
        backendTools.push(...(results[backendIndex] as PromiseFulfilledResult<Tool[]>).value);
      } else {
        console.error(
          '[AggregatedMCPClient] Backend MCP failed:',
          (results[backendIndex] as PromiseRejectedResult).reason
        );
      }
    }

    // Build tool registry for routing
    this.toolRegistry.clear();

    // Register built-in tools (no prefix needed)
    builtInTools.forEach((tool) => {
      if (this.toolRegistry.has(tool.name)) {
        // Conflict detected - log warning and prioritize built-in
        console.warn(
          `[AggregatedMCPClient] Tool name conflict: '${tool.name}' exists in both built-in and backend. Prioritizing built-in.`
        );
      } else {
        this.toolRegistry.set(tool.name, 'builtin');
      }
    });

    // Register backend tools (already prefixed by backend) and filter out conflicts
    const filteredBackendTools = backendTools.filter((tool) => {
      if (!this.toolRegistry.has(tool.name)) {
        // Only add if not conflicting with built-in
        this.toolRegistry.set(tool.name, 'backend');
        return true;
      }
      // Tool conflicts with built-in - log warning and skip it
      console.warn(
        `[AggregatedMCPClient] Tool name conflict: '${tool.name}' exists in both built-in and backend. Prioritizing built-in.`
      );
      return false;
    });

    // Combine tools (built-in + filtered backend)
    const combinedTools = [...builtInTools, ...filteredBackendTools];

    // Check if we have any tools
    if (combinedTools.length === 0) {
      console.error('[AggregatedMCPClient] No tools available from any source');
    }

    console.log(
      `[AggregatedMCPClient] Combined tools - Built-in: ${builtInTools.length}, Backend: ${filteredBackendTools.length}, Total: ${combinedTools.length}`
    );

    // Cache the combined list
    this.cachedTools = combinedTools;

    return combinedTools;
  }

  /**
   * Call a tool by routing to the correct client
   */
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    // Lookup tool in registry to determine source
    const source = this.toolRegistry.get(params.name);

    if (!source) {
      // Tool not found in registry
      console.error(`[AggregatedMCPClient] Tool '${params.name}' not found in registry`);
      return {
        content: [
          {
            type: 'text',
            text: `Error: Tool '${params.name}' is not available. It may not exist or you may not have permission to use it.`,
          },
        ],
        isError: true,
      };
    }

    // Route to the appropriate client
    try {
      if (source === 'builtin') {
        console.log(`[AggregatedMCPClient] Routing '${params.name}' to built-in MCP`);
        return await this.builtInClient.callTool(params);
      } else {
        console.log(`[AggregatedMCPClient] Routing '${params.name}' to backend MCP`);
        return await this.backendClient.callTool(params);
      }
    } catch (error) {
      console.error(`[AggregatedMCPClient] Failed to call tool '${params.name}':`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Check if a tool exists in either source
   */
  isTool(toolName: string): boolean {
    return this.toolRegistry.has(toolName);
  }

  /**
   * Clear cached tools and registry
   */
  clearCache(): void {
    this.cachedTools = null;
    this.toolRegistry.clear();
    this.builtInClient.clearCache();
    this.backendClient.clearCache();
  }

  /**
   * Get aggregated health status from both sources
   */
  async getHealth(): Promise<{ status: string; mcpServers: number; message: string }> {
    const promises: Promise<{ status: string; mcpServers: number; message: string }>[] = [];

    if (this.useBuiltIn) {
      promises.push(this.builtInClient.getHealth());
    }
    if (this.useBackend) {
      promises.push(this.backendClient.getHealth());
    }

    const results = await Promise.allSettled(promises);

    let healthyCount = 0;
    let totalServers = 0;
    const messages: string[] = [];

    // Process built-in health
    if (this.useBuiltIn && results[0]) {
      if (results[0].status === 'fulfilled') {
        const health = results[0].value;
        if (health.status === 'healthy' || health.status === 'ok') {
          healthyCount++;
        }
        totalServers += health.mcpServers || 1; // Built-in counts as 1 server
        messages.push(`Built-in: ${health.message}`);
      } else {
        messages.push('Built-in: Failed to get health');
      }
    }

    // Process backend health
    const backendIndex = this.useBuiltIn ? 1 : 0;
    if (this.useBackend && results[backendIndex]) {
      if (results[backendIndex].status === 'fulfilled') {
        const health = (results[backendIndex] as PromiseFulfilledResult<any>).value;
        if (health.status === 'healthy' || health.status === 'ok') {
          healthyCount++;
        }
        totalServers += health.mcpServers || 0;
        messages.push(`Backend: ${health.message}`);
      } else {
        messages.push('Backend: Failed to get health');
      }
    }

    // Determine overall status
    const sourcesEnabled = (this.useBuiltIn ? 1 : 0) + (this.useBackend ? 1 : 0);
    let status: string;
    if (healthyCount === sourcesEnabled) {
      status = 'healthy';
    } else if (healthyCount > 0) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      mcpServers: totalServers,
      message: messages.join('; '),
    };
  }

  /**
   * Disconnect from built-in MCP if connected
   */
  async disconnect(): Promise<void> {
    if (this.useBuiltIn) {
      await this.builtInClient.disconnect();
    }
  }

  /**
   * Get statistics about the aggregated client
   */
  getStats(): {
    builtInEnabled: boolean;
    backendEnabled: boolean;
    totalTools: number;
    builtInTools: number;
    backendTools: number;
  } {
    let builtInTools = 0;
    let backendTools = 0;

    this.toolRegistry.forEach((source) => {
      if (source === 'builtin') {
        builtInTools++;
      } else {
        backendTools++;
      }
    });

    return {
      builtInEnabled: this.useBuiltIn,
      backendEnabled: this.useBackend,
      totalTools: this.toolRegistry.size,
      builtInTools,
      backendTools,
    };
  }
}

// Create and export a singleton instance for use in useMCPManager
// Note: This will be created on-demand when both sources are enabled
export function createAggregatedMCPClient(
  builtInClient: BuiltInMCPClient,
  backendClient: BackendMCPClient
): AggregatedMCPClient {
  return new AggregatedMCPClient({
    builtInClient,
    backendClient,
    useBuiltIn: true,
    useBackend: true,
  });
}
