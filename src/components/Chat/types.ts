export interface ToolCallResponse {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface RenderedToolCall {
  name: string;
  arguments: string;
  running: boolean;
  error?: string;
  response?: ToolCallResponse;
}

export interface GrafanaPageRef {
  type: 'dashboard' | 'explore';
  url: string;
  uid?: string;
  title?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: RenderedToolCall[];
  pageRefs?: GrafanaPageRef[];
  timestamp?: Date;
}
