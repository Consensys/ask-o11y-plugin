export type AuthType = 'none' | 'headers' | 'oauth2.1';

export interface OAuth2Config {
  // Client credentials (manual or from DCR)
  clientId?: string;
  clientSecret?: string; // Cleared after saving to backend

  // Discovery and endpoints
  discoveryUrl?: string; // e.g., /.well-known/oauth-authorization-server
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;

  // OAuth parameters
  scopes?: string[]; // e.g., ["mcp:tools", "mcp:resources"]
  resource?: string; // RFC 8707 - defaults to server URL

  // Token state (read-only from backend)
  tokenStatus?: 'not_configured' | 'authorizing' | 'authorized' | 'expired' | 'error';
  tokenExpiresAt?: string; // ISO timestamp
  lastError?: string;

  // Dynamic Client Registration
  useDynamicRegistration?: boolean;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';

  // Authentication (mutually exclusive)
  authType?: AuthType; // Defaults to 'headers' for backward compatibility
  headers?: Record<string, string>; // EXISTING - no changes needed
  oauth?: OAuth2Config; // NEW - OAuth 2.1 configuration
}

export type SystemPromptMode = 'default' | 'replace' | 'append';

export type AppPluginSettings = {
  maxTotalTokens?: number;
  mcpServers?: MCPServerConfig[];
  systemPromptMode?: SystemPromptMode;
  customSystemPrompt?: string;
};
