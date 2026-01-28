/**
 * Backend MCP Client
 * Communicates with the backend MCP proxy instead of directly connecting to external servers
 */

import { firstValueFrom } from 'rxjs';
import { getBackendSrv, config } from '@grafana/runtime';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types';

// Define CallToolParams locally since it's not exported from SDK
interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
  scopeOrgId?: string; // Optional: Direct X-Scope-OrgId value for multi-tenant systems (takes priority over orgName)
}

export class BackendMCPClient {
  private baseUrl: string;
  private cachedTools: Tool[] | null = null;

  constructor() {
    // Use Grafana's plugin resource endpoint
    this.baseUrl = '/api/plugins/consensys-asko11y-app/resources';
  }

  /**
   * List all tools from the backend MCP proxy
   */
  async listTools(): Promise<Tool[]> {
    if (this.cachedTools) {
      return this.cachedTools;
    }

    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<{ tools: Tool[] }>({
          url: `${this.baseUrl}/api/mcp/tools`,
          method: 'GET',
        })
      );

      this.cachedTools = response?.data.tools || [];
      console.log('[BackendMCPClient] Listed tools from backend:', this.cachedTools.length);

      return this.cachedTools;
    } catch (error) {
      console.error('[BackendMCPClient] Failed to list tools:', error);
      return [];
    }
  }

  /**
   * Call a tool via the backend MCP proxy
   * Note: Grafana's getBackendSrv() automatically includes X-Grafana-Org-Id header
   * We pass orgName and scopeOrgId in the request body (not headers) because Grafana's proxy
   * does not forward custom headers to backend plugins.
   *
   * For multi-tenant MCP servers (Mimir, Cortex, Loki):
   * - If scopeOrgId is provided, it's used directly as X-Scope-OrgId
   * - Otherwise, orgName is used as the X-Scope-OrgId value
   */
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    try {
      console.log('[BackendMCPClient] Calling tool via backend:', params.name);

      // Get org name from Grafana config for services that need tenant name (e.g., Alertmanager)
      // This must be passed in the body, not headers, as Grafana's proxy doesn't forward custom headers
      const orgName = config.bootData?.user?.orgName || '';

      const response = await firstValueFrom(
        getBackendSrv().fetch<CallToolResult>({
          url: `${this.baseUrl}/api/mcp/call-tool`,
          method: 'POST',
          data: {
            name: params.name,
            arguments: params.arguments || {},
            orgName: orgName,
            scopeOrgId: params.scopeOrgId || '', // Direct X-Scope-OrgId for multi-tenant systems (priority over orgName)
          },
          showErrorAlert: false,
        })
      );

      if (!response) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[BackendMCPClient] Failed to call tool:', error);

      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool via backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Check if a tool is handled by the backend
   */
  isTool(toolName: string): boolean {
    if (!this.cachedTools) {
      return false;
    }

    return this.cachedTools.some((tool) => tool.name === toolName);
  }

  /**
   * Clear the cached tools
   */
  clearCache(): void {
    this.cachedTools = null;
  }

  /**
   * Get health status from backend
   */
  async getHealth(): Promise<{ status: string; mcpServers: number; message: string }> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<{
          status: string;
          mcpServers: number;
          message: string;
        }>({
          url: `${this.baseUrl}/health`,
          method: 'GET',
        })
      );

      if (!response) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[BackendMCPClient] Failed to get health:', error);
      return {
        status: 'error',
        mcpServers: 0,
        message: 'Failed to connect to backend',
      };
    }
  }
}

// Export singleton instance
export const backendMCPClient = new BackendMCPClient();
