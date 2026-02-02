/** Aggregates built-in and backend MCP clients when both are enabled. */

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

  private toolRegistry: Map<string, ToolSource> = new Map();
  private cachedTools: Tool[] | null = null;

  constructor(options: AggregatedMCPClientOptions) {
    this.builtInClient = options.builtInClient;
    this.backendClient = options.backendClient;
    this.useBuiltIn = options.useBuiltIn;
    this.useBackend = options.useBackend;
  }

  async listTools(): Promise<Tool[]> {
    if (this.cachedTools) {
      return this.cachedTools;
    }

    const [builtInResult, backendResult] = await Promise.allSettled([
      this.useBuiltIn ? this.builtInClient.listTools() : Promise.resolve([]),
      this.useBackend ? this.backendClient.listTools() : Promise.resolve([]),
    ]);

    const builtInTools = this.extractToolsFromResult(builtInResult, 'Built-in');
    const backendTools = this.extractToolsFromResult(backendResult, 'Backend');

    this.toolRegistry.clear();

    builtInTools.forEach((tool) => {
      if (!this.toolRegistry.has(tool.name)) {
        this.toolRegistry.set(tool.name, 'builtin');
      }
    });

    const filteredBackendTools = backendTools.filter((tool) => {
      if (!this.toolRegistry.has(tool.name)) {
        this.toolRegistry.set(tool.name, 'backend');
        return true;
      }
      console.warn(`Tool name conflict: '${tool.name}' exists in both built-in and backend. Using built-in version.`);
      return false;
    });

    const combinedTools = [...builtInTools, ...filteredBackendTools];

    if (combinedTools.length === 0 && (this.useBuiltIn || this.useBackend)) {
      console.error('No tools available from any MCP source');
    }

    this.cachedTools = combinedTools;

    return combinedTools;
  }

  private extractToolsFromResult(
    result: PromiseSettledResult<Tool[]>,
    sourceName: string
  ): Tool[] {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    console.error(`${sourceName} MCP failed to list tools:`, result.reason);
    return [];
  }

  async callTool(params: CallToolParams): Promise<CallToolResult> {
    const source = this.toolRegistry.get(params.name);

    if (!source) {
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

    try {
      if (source === 'builtin') {
        return await this.builtInClient.callTool(params);
      } else {
        return await this.backendClient.callTool(params);
      }
    } catch (error) {
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

  isTool(toolName: string): boolean {
    return this.toolRegistry.has(toolName);
  }

  clearCache(): void {
    this.cachedTools = null;
    this.toolRegistry.clear();
    this.builtInClient.clearCache();
    this.backendClient.clearCache();
  }

  async getHealth(): Promise<{ status: string; mcpServers: number; message: string }> {
    const [builtInResult, backendResult] = await Promise.allSettled([
      this.useBuiltIn ? this.builtInClient.getHealth() : Promise.resolve(null),
      this.useBackend ? this.backendClient.getHealth() : Promise.resolve(null),
    ]);

    const builtInHealth = this.extractHealthFromResult(builtInResult, 'Built-in', 1);
    const backendHealth = this.extractHealthFromResult(backendResult, 'Backend', 0);

    const healthyCount = builtInHealth.healthy + backendHealth.healthy;
    const totalServers = builtInHealth.servers + backendHealth.servers;
    const messages = [builtInHealth.message, backendHealth.message].filter(Boolean);
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

  private extractHealthFromResult(
    result: PromiseSettledResult<{ status: string; mcpServers: number; message: string } | null>,
    sourceName: string,
    defaultServers: number
  ): { healthy: number; servers: number; message: string } {
    if (result.status !== 'fulfilled' || result.value === null) {
      if (result.status === 'rejected') {
        return { healthy: 0, servers: 0, message: `${sourceName}: Failed to get health` };
      }
      return { healthy: 0, servers: 0, message: '' };
    }

    const health = result.value;
    const isHealthy = health.status === 'healthy' || health.status === 'ok';
    return {
      healthy: isHealthy ? 1 : 0,
      servers: health.mcpServers || defaultServers,
      message: `${sourceName}: ${health.message}`,
    };
  }

  async disconnect(): Promise<void> {
    if (this.useBuiltIn) {
      await this.builtInClient.disconnect();
    }
  }

  getStats(): {
    builtInEnabled: boolean;
    backendEnabled: boolean;
    totalTools: number;
    builtInTools: number;
    backendTools: number;
  } {
    const builtInTools = Array.from(this.toolRegistry.values()).filter((s) => s === 'builtin').length;
    const backendTools = this.toolRegistry.size - builtInTools;

    return {
      builtInEnabled: this.useBuiltIn,
      backendEnabled: this.useBackend,
      totalTools: this.toolRegistry.size,
      builtInTools,
      backendTools,
    };
  }
}
