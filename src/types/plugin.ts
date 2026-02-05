export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  /** @deprecated Use headerKeys instead */
  headers?: Record<string, string>;
  headerKeys?: string[];
}

export function getSecureHeaderKey(serverId: string, headerKey: string): string {
  return `mcp_${serverId}_header_${headerKey}`;
}

export function parseSecureHeaderKey(secureKey: string): { serverId: string; headerKey: string } | null {
  const match = secureKey.match(/^mcp_(.+)_header_(.+)$/);
  if (!match) {
    return null;
  }
  return { serverId: match[1], headerKey: match[2] };
}

export type SystemPromptMode = 'default' | 'replace' | 'append';

export type AppPluginSettings = {
  maxTotalTokens?: number;
  mcpServers?: MCPServerConfig[];
  systemPromptMode?: SystemPromptMode;
  customSystemPrompt?: string;
  kioskModeEnabled?: boolean;
  chatPanelPosition?: 'left' | 'right';
  useBuiltInMCP?: boolean;
};
