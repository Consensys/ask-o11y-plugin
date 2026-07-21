export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  trusted?: boolean;
  headers?: Record<string, string>;
  toolSelections?: Record<string, boolean>;
  riskOverrides?: Record<string, ToolRiskOverride>;
}

export interface ToolRiskOverride {
  requiresApproval?: boolean;
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  reason?: string;
}

export type AppPluginSettings = {
  mcpServers?: MCPServerConfig[];
  useBuiltInMCP?: boolean;
  builtInMCPToolSelections?: Record<string, boolean>;
  trustedMCPServers?: Record<string, boolean>;
  riskOverrides?: Record<string, ToolRiskOverride>;

  defaultSystemPrompt?: string;
  investigationPrompt?: string;
  performancePrompt?: string;

  maxTotalTokens?: number;
  recentMessageCount?: number;

  kioskModeEnabled?: boolean;
  chatPanelPosition?: 'left' | 'right';

  graphitiScanInterval?: string;
  serviceGraphMaxNodes?: number;
  serviceGraphMaxEdges?: number;

  approvalPolicy?: string;
  maxParallelToolCalls?: number;
  agentEvalCaptureEnabled?: boolean;
};
