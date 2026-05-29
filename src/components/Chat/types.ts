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

export interface AgentPlanStep {
  id: string;
  title: string;
  description?: string;
  status: string;
}

export interface AgentRunPlan {
  objective: string;
  steps: AgentPlanStep[];
}

export interface AgentEvidenceItem {
  id: string;
  stepId?: string;
  title: string;
  summary: string;
  source?: string;
  toolName?: string;
  query?: string;
  datasourceUid?: string;
  timeRange?: string;
}

export interface AgentApprovalItem {
  approvalId: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  risk: string;
  reason: string;
  arguments: string;
  decision?: string;
  comment?: string;
  resolvedAt?: string;
  resolving?: boolean;
  error?: string;
}

export interface AgentFinalReport {
  verdict?: string;
  confidence?: string;
  summary: string;
  evidenceIds?: string[];
  gaps?: string[];
  nextSteps?: string[];
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
  toolCalls?: RenderedToolCall[];
  runPlan?: AgentRunPlan;
  evidence?: AgentEvidenceItem[];
  approvals?: AgentApprovalItem[];
  finalReport?: AgentFinalReport;
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
  currentModelLabel?: string;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  chatContainerRef: React.RefObject<HTMLDivElement> | React.RefCallback<HTMLDivElement>;
  chatInputRef: React.RefObject<{ focus: () => void; clear: () => void }>;
  bottomSpacerRef: React.RefObject<HTMLDivElement>;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  readOnly?: boolean;
  onSuggestionClick?: (message: string) => void;
  queuedMessageCount: number;
  onStopGeneration?: () => void;
  onResolveApproval?: (approval: AgentApprovalItem, decision: 'approved' | 'rejected') => Promise<void>;
}

/** Props for the Grafana page panel */
export interface GrafanaPageProps {
  pageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  kioskModeEnabled?: boolean;
  isVisible?: boolean;
  onRemoveTab?: (index: number) => void;
  onClose?: () => void;
}
