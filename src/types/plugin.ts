export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  headers?: Record<string, string>;
  toolSelections?: Record<string, boolean>;
}

export type AppPluginSettings = {
  mcpServers?: MCPServerConfig[];
  useBuiltInMCP?: boolean;
  builtInMCPToolSelections?: Record<string, boolean>;

  defaultSystemPrompt?: string;
  investigationPrompt?: string;
  performancePrompt?: string;

  maxTotalTokens?: number;
  recentMessageCount?: number;

  kioskModeEnabled?: boolean;
  chatPanelPosition?: 'left' | 'right';

  graphitiScanInterval?: string;
};
