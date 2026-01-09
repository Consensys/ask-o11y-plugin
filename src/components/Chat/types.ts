export interface RenderedToolCall {
  name: string;
  arguments: string;
  running: boolean;
  error?: string;
  response?: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: RenderedToolCall[];
}
