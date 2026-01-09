import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Home = '',
}

// Token limit configuration for LLM requests
export const MAX_TOTAL_TOKENS = 100000;
export const SYSTEM_MESSAGE_BUFFER = 1000; // Reserve tokens for system message
export const MAX_TOOL_RESPONSE_TOKENS = 8000; // Max tokens per tool response
export const AGGRESSIVE_TOOL_RESPONSE_TOKENS = 500; // Aggressive trimming when needed

// API timeout configuration
export const LLM_API_TIMEOUT_MS = 120000; // 60 seconds timeout for LLM API calls
