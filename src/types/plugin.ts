export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  /**
   * Header key names for this server.
   * The actual header values are stored securely in secureJsonData with keys:
   * `mcp_{serverId}_header_{headerKey}`
   *
   * @deprecated Use headerKeys instead. This field is kept for backwards compatibility.
   */
  headers?: Record<string, string>;
  /**
   * List of header key names. Values are stored in secureJsonData.
   * Use the helper function `getSecureHeaderKey(serverId, headerKey)` to generate
   * the secureJsonData key for a header value.
   */
  headerKeys?: string[];
}

/**
 * Generates the secureJsonData key for a server header value.
 * Format: `mcp_{serverId}_header_{headerKey}`
 */
export function getSecureHeaderKey(serverId: string, headerKey: string): string {
  return `mcp_${serverId}_header_${headerKey}`;
}

/**
 * Parses a secureJsonData key to extract server ID and header key.
 * Returns null if the key doesn't match the expected format.
 */
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
