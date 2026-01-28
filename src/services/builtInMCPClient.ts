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

export class BuiltInMCPClient {
  private mcpClient: InstanceType<typeof mcp.Client> | null = null;
  private isConnected = false;
  private cachedTools: Tool[] | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    // Client will be initialized on-demand
  }

  /**
   * Initialize and connect to the built-in MCP server
   */
  private async ensureConnected(): Promise<void> {
    // Return existing connection if already connected
    if (this.isConnected && this.mcpClient) {
      return;
    }

    // If connection is in progress, wait for it
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Start new connection
    this.connectionPromise = this.connect();

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Perform the actual connection (called by ensureConnected)
   */
  private async connect(): Promise<void> {
    // Check if MCP is enabled
    const mcpEnabled = await mcp.enabled();
    if (!mcpEnabled) {
      throw new Error('Built-in MCP is not available. Please install and configure grafana-llm-app.');
    }

    try {
      // Create MCP client
      this.mcpClient = new mcp.Client({
        name: 'ask-o11y-plugin',
        version: '0.2.0',
      });

      // Create transport using streamable HTTP
      const transport = new mcp.StreamableHTTPClientTransport(
        mcp.streamableHTTPURL() // Uses grafana-llm-app by default
      );

      // Connect
      await this.mcpClient.connect(transport);
      this.isConnected = true;

      console.log('[BuiltInMCPClient] Connected to built-in MCP server');
    } catch (error) {
      const connectionError = error instanceof Error ? error : new Error('Unknown connection error');
      this.isConnected = false;
      this.mcpClient = null;
      throw new Error(`Failed to connect to built-in MCP server: ${connectionError.message}`);
    }
  }

  /**
   * List all tools from the built-in MCP server with RBAC filtering
   */
  async listTools(): Promise<Tool[]> {
    // Check cache first
    if (this.cachedTools) {
      // Apply RBAC filtering on cached tools
      const userRole = (config.bootData?.user?.orgRole || 'Viewer') as UserRole;
      return filterToolsByRole(this.cachedTools, userRole);
    }

    try {
      await this.ensureConnected();

      if (!this.mcpClient) {
        throw new Error('MCP client not initialized');
      }

      // List tools from built-in server
      const response = await this.mcpClient.listTools();
      this.cachedTools = response.tools || [];

      console.log('[BuiltInMCPClient] Listed tools from built-in server:', this.cachedTools?.length || 0);

      // Apply RBAC filtering
      const userRole = (config.bootData?.user?.orgRole || 'Viewer') as UserRole;
      const filteredTools = filterToolsByRole(this.cachedTools || [], userRole);

      console.log('[BuiltInMCPClient] Filtered tools for role', userRole, ':', filteredTools.length);

      return filteredTools;
    } catch (error) {
      console.error('[BuiltInMCPClient] Failed to list tools:', error);
      return [];
    }
  }

  /**
   * Call a tool via the built-in MCP server with RBAC enforcement
   */
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    try {
      // Enforce RBAC before calling tool
      const userRole = (config.bootData?.user?.orgRole || 'Viewer') as UserRole;
      const tools = await this.listTools(); // This returns RBAC-filtered tools
      const toolExists = tools.some((tool) => tool.name === params.name);

      if (!toolExists) {
        // Either tool doesn't exist or user doesn't have permission
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

      // Connection is already established by listTools() above
      if (!this.mcpClient) {
        throw new Error('MCP client not initialized');
      }

      console.log('[BuiltInMCPClient] Calling tool via built-in server:', params.name);

      // Call the tool
      const response = await this.mcpClient.callTool({
        name: params.name,
        arguments: params.arguments || {},
      });

      // Ensure the response matches CallToolResult structure
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

  /**
   * Check if a tool is handled by the built-in MCP server (with RBAC)
   */
  isTool(toolName: string): boolean {
    if (!this.cachedTools) {
      return false;
    }

    // Check if tool exists in raw cache
    const toolExists = this.cachedTools.some((tool) => tool.name === toolName);
    if (!toolExists) {
      return false;
    }

    // Check RBAC
    const userRole = (config.bootData?.user?.orgRole || 'Viewer') as UserRole;
    const filteredTools = filterToolsByRole(this.cachedTools, userRole);
    return filteredTools.some((tool) => tool.name === toolName);
  }

  /**
   * Clear the cached tools
   */
  clearCache(): void {
    this.cachedTools = null;
  }

  /**
   * Disconnect from the built-in MCP server
   */
  async disconnect(): Promise<void> {
    if (this.mcpClient && this.isConnected) {
      try {
        await this.mcpClient.close();
        console.log('[BuiltInMCPClient] Disconnected from built-in MCP server');
      } catch (error) {
        console.error('[BuiltInMCPClient] Error disconnecting:', error);
      }
    }
    this.isConnected = false;
    this.mcpClient = null;
    this.cachedTools = null;
  }

  /**
   * Check if built-in MCP is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await mcp.enabled();
    } catch (error) {
      console.error('[BuiltInMCPClient] Error checking availability:', error);
      return false;
    }
  }

  /**
   * Get health status (compatibility with backendMCPClient interface)
   */
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

// Export singleton instance
export const builtInMCPClient = new BuiltInMCPClient();
