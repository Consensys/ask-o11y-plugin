/**
 * MCP Server Status Service
 * Fetches server health status and tools from the backend
 */

import { firstValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';

export interface MCPServerStatus {
  serverId: string;
  name: string;
  url: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disconnected' | 'connecting';
  lastCheck: string;
  responseTime: number;
  successRate: number;
  errorCount: number;
  consecutiveFailures: number;
  lastError?: string;
  tools: MCPTool[];
  toolCount: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface SystemHealth {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  healthy: number;
  degraded: number;
  unhealthy: number;
  disconnected: number;
  total: number;
}

export interface MCPServersResponse {
  servers: MCPServerStatus[];
  systemHealth: SystemHealth;
}

export class MCPServerStatusService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = '/api/plugins/consensys-asko11y-app/resources';
  }

  /**
   * Fetch all MCP server statuses from the backend
   */
  async fetchServerStatuses(): Promise<MCPServersResponse> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<MCPServersResponse>({
          url: `${this.baseUrl}/api/mcp/servers`,
          method: 'GET',
        })
      );

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[MCPServerStatusService] Failed to fetch server statuses:', error);
      return {
        servers: [],
        systemHealth: {
          overallStatus: 'unhealthy',
          healthy: 0,
          degraded: 0,
          unhealthy: 0,
          disconnected: 0,
          total: 0,
        },
      };
    }
  }

  /**
   * Fetch status for a specific server
   */
  async fetchServerStatus(serverId: string): Promise<MCPServerStatus | null> {
    const response = await this.fetchServerStatuses();
    return response.servers.find((s) => s.serverId === serverId) || null;
  }
}

// Export singleton instance
export const mcpServerStatusService = new MCPServerStatusService();
