export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  headers?: Record<string, string>;
}

export type SystemPromptMode = 'default' | 'replace' | 'append';

export type AppPluginSettings = {
  maxTotalTokens?: number;
  mcpServers?: MCPServerConfig[];
  systemPromptMode?: SystemPromptMode;
  customSystemPrompt?: string;
};
