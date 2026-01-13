export interface RenderedToolCall {
  name: string;
  arguments: string;
  running: boolean;
  error?: string;
  response?: any;
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
}
