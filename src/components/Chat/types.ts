import type { Query } from './utils/promqlParser';

/** Content item from MCP tool response */
export interface ToolResponseContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Response from an MCP tool call */
export interface ToolCallResponse {
  content: ToolResponseContent[];
  isError?: boolean;
}

/** Rendered tool call with status and response */
export interface RenderedToolCall {
  name: string;
  arguments: string;
  running: boolean;
  error?: string;
  response?: ToolCallResponse;
}

/** Reference to a Grafana page (dashboard or explore) */
export interface GrafanaPageRef {
  type: 'dashboard' | 'explore';
  url: string;
  uid?: string;
  title?: string;
}

/** Chat message from user or assistant */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: RenderedToolCall[];
  pageRefs?: GrafanaPageRef[];
  timestamp?: Date;
}

/** Content section returned by splitContentByPromQL */
export interface ContentSection {
  type: 'text' | 'promql' | 'logql' | 'traceql';
  content: string;
  query?: Query;
}

/** Props for the chat interface state */
export interface ChatInterfaceProps {
  chatHistory: ChatMessage[];
  currentInput: string;
  isGenerating: boolean;
  currentSessionTitle?: string;
  isSummarizing: boolean;
  hasSummary: boolean;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  chatInputRef: React.RefObject<{ focus: () => void; clear: () => void }>;
  bottomSpacerRef: React.RefObject<HTMLDivElement>;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  readOnly?: boolean;
  onSuggestionClick?: (message: string) => void;
  queuedMessageCount: number;
  onStopGeneration?: () => void;
}

/** Props for the Grafana page panel */
export interface GrafanaPageProps {
  pageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  kioskModeEnabled?: boolean;
  isVisible?: boolean;
  onRemoveTab?: (index: number) => void;
  onClose?: () => void;
}
