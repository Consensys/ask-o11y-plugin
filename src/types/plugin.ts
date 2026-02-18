export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  headers?: Record<string, string>;
}

export type AppPluginSettings = {
  mcpServers?: MCPServerConfig[];
  useBuiltInMCP?: boolean;

  defaultSystemPrompt?: string;
  investigationPrompt?: string;
  performancePrompt?: string;

  maxTotalTokens?: number;
  recentMessageCount?: number;

  kioskModeEnabled?: boolean;
  chatPanelPosition?: 'left' | 'right';
};
