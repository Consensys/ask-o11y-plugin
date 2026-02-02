/**
 * Built-in MCP Client
 *
 * Uses @grafana/llm's MCP client to communicate with grafana-llm-app's built-in MCP server.
 * Implements the same interface as BackendMCPClient for seamless integration.
 */

import { mcp } from '@grafana/llm';
import { config } from '@grafana/runtime';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types';
import { filterToolsByRole, type UserRole } from '../utils/rbac';

interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

function getUserRole(): UserRole {
  return (config.bootData?.user?.orgRole || 'Viewer') as UserRole;
}

export class BuiltInMCPClient {
  private mcpClient: InstanceType<typeof mcp.Client> | null = null;
  private isConnected = false;
  private cachedTools: Tool[] | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor() {}

  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.mcpClient) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.connect();

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async connect(): Promise<void> {
    const mcpEnabled = await mcp.enabled();
    if (!mcpEnabled) {
      throw new Error('Built-in MCP is not available. Please install and configure grafana-llm-app.');
    }

    try {
      this.mcpClient = new mcp.Client({
        name: 'ask-o11y-plugin',
        version: '0.2.2',
      });

      const transport = new mcp.StreamableHTTPClientTransport(mcp.streamableHTTPURL());

      await this.mcpClient.connect(transport);
      this.isConnected = true;

    } catch (error) {
      const connectionError = error instanceof Error ? error : new Error('Unknown connection error');
      this.isConnected = false;
      this.mcpClient = null;
      throw new Error(`Failed to connect to built-in MCP server: ${connectionError.message}`);
    }
  }

  async listTools(): Promise<Tool[]> {
    const userRole = getUserRole();

    if (this.cachedTools) {
      return filterToolsByRole(this.cachedTools, userRole);
    }

    try {
      await this.ensureConnected();

      if (!this.mcpClient) {
        throw new Error('MCP client not initialized');
      }

      const response = await this.mcpClient.listTools();
      this.cachedTools = response.tools || [];

      return filterToolsByRole(this.cachedTools, userRole);
    } catch (error) {
      console.error('[BuiltInMCPClient] Failed to list tools:', error);
      return [];
    }
  }

  async callTool(params: CallToolParams): Promise<CallToolResult> {
    try {
      const tools = await this.listTools();
      const toolExists = tools.some((tool) => tool.name === params.name);

      if (!toolExists) {
        const userRole = getUserRole();
        return {
          content: [
            {
              type: 'text',
              text: `Error: Tool '${params.name}' is not available or you don't have permission to use it (role: ${userRole}).`,
            },
          ],
          isError: true,
        };
      }

      if (!this.mcpClient) {
        throw new Error('MCP client not initialized');
      }

      const response = await this.mcpClient.callTool({
        name: params.name,
        arguments: params.arguments || {},
      });

      return response as CallToolResult;
    } catch (error) {
      console.error('[BuiltInMCPClient] Failed to call tool:', error);

      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool via built-in MCP: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  isTool(toolName: string): boolean {
    if (!this.cachedTools) {
      return false;
    }

    // Check if tool exists in cache and is accessible to user's role
    const filteredTools = filterToolsByRole(this.cachedTools, getUserRole());
    return filteredTools.some((tool) => tool.name === toolName);
  }

  clearCache(): void {
    this.cachedTools = null;
  }

  async disconnect(): Promise<void> {
    if (this.mcpClient && this.isConnected) {
      try {
        await this.mcpClient.close();
      } catch (error) {
        console.error('[BuiltInMCPClient] Error disconnecting:', error);
      }
    }
    this.isConnected = false;
    this.mcpClient = null;
    this.cachedTools = null;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await mcp.enabled();
    } catch (error) {
      console.error('[BuiltInMCPClient] Error checking availability:', error);
      return false;
    }
  }

  async getHealth(): Promise<{ status: string; mcpServers: number; message: string }> {
    try {
      const available = await this.isAvailable();
      if (!available) {
        return {
          status: 'unavailable',
          mcpServers: 0,
          message: 'Built-in MCP is not available',
        };
      }

      await this.ensureConnected();
      return {
        status: 'ok',
        mcpServers: 1,
        message: 'Connected to built-in MCP server',
      };
    } catch (error) {
      return {
        status: 'error',
        mcpServers: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const builtInMCPClient = new BuiltInMCPClient();
