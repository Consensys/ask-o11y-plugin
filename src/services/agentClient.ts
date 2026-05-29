export interface AgentRunRequest {
  message: string;
  type?: 'chat' | 'investigation' | 'performance';
  sessionId?: string;
  model?: 'base' | 'large';

  orgId?: string;
  orgName?: string;
  scopeOrgId?: string;
}

export interface ContentEvent {
  content: string;
}

export interface ToolCallStartEvent {
  id: string;
  name: string;
  arguments: string;
}

export type ToolErrorKind = 'transport' | 'tool' | 'protocol' | '';
export type AgentToolErrorKind = ToolErrorKind | 'approval_required' | 'approval_denied';

export interface ToolCallResultEvent {
  id: string;
  name: string;
  content: string;
  isError: boolean;
  /**
   * Classification of a failed tool call. Empty on success. "transport" means
   * the MCP sidecar was unreachable after retries — the UI should render a
   * distinct warning style for those to distinguish them from tool-logic errors.
   */
  errorKind?: AgentToolErrorKind;
}

export interface DoneEvent {
  totalIterations: number;
}

export interface ErrorEvent {
  message: string;
  code?: string;
  statusCode?: number;
  requestId?: string;
  retryable?: boolean;
}

export interface RunStartedEvent {
  runId: string;
  sessionId?: string;
}

export interface MCPUnavailableEvent {
  message: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | string;
}

export interface RunPlanEvent {
  objective: string;
  steps: PlanStep[];
}

export interface StepEvent {
  id: string;
  title?: string;
  status: string;
}

export interface EvidenceEvent {
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

export interface ApprovalRequestEvent {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  risk: string;
  reason: string;
  arguments: string;
}

export interface ApprovalResolvedEvent {
  approvalId: string;
  decision: 'approved' | 'rejected' | string;
  comment?: string;
  resolvedAt?: string;
}

export interface FinalReportEvent {
  verdict?: string;
  confidence?: string;
  summary: string;
  evidenceIds?: string[];
  gaps?: string[];
  nextSteps?: string[];
}

export type SSEEvent =
  | { type: 'content'; data: ContentEvent; sequence: number }
  | { type: 'tool_call_start'; data: ToolCallStartEvent; sequence: number }
  | { type: 'tool_call_result'; data: ToolCallResultEvent; sequence: number }
  | { type: 'done'; data: DoneEvent; sequence: number }
  | { type: 'error'; data: ErrorEvent; sequence: number }
  | { type: 'run_started'; data: RunStartedEvent; sequence: number }
  | { type: 'mcp_unavailable'; data: MCPUnavailableEvent; sequence: number }
  | { type: 'run_plan'; data: RunPlanEvent; sequence: number }
  | { type: 'step_start'; data: StepEvent; sequence: number }
  | { type: 'step_done'; data: StepEvent; sequence: number }
  | { type: 'evidence'; data: EvidenceEvent; sequence: number }
  | { type: 'approval_request'; data: ApprovalRequestEvent; sequence: number }
  | { type: 'approval_resolved'; data: ApprovalResolvedEvent; sequence: number }
  | { type: 'final_report'; data: FinalReportEvent; sequence: number };

export interface AgentCallbacks {
  onContent: (event: ContentEvent) => void;
  onToolCallStart: (event: ToolCallStartEvent) => void;
  onToolCallResult: (event: ToolCallResultEvent) => void;
  onDone: (event: DoneEvent) => void;
  onError: (message: string) => void;
  onRunStarted?: (event: RunStartedEvent) => void;
  onReconnect?: () => void;
  onMCPUnavailable?: (event: MCPUnavailableEvent) => void;
  onRunPlan?: (event: RunPlanEvent) => void;
  onStep?: (event: StepEvent) => void;
  onEvidence?: (event: EvidenceEvent) => void;
  onApprovalRequest?: (event: ApprovalRequestEvent) => void;
  onApprovalResolved?: (event: ApprovalResolvedEvent) => void;
  onFinalReport?: (event: FinalReportEvent) => void;
}

export interface AgentRunStatus {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  userId: number;
  orgId: number;
  createdAt: string;
  updatedAt: string;
  events: SSEEvent[];
  trace?: {
    plan?: PlanStep[];
    evidence?: EvidenceEvent[];
    approvals?: Array<ApprovalRequestEvent & { decision?: string; comment?: string; createdAt?: string; resolvedAt?: string }>;
    finalReport?: FinalReportEvent;
  };
  error?: string;
}

const AGENT_RUN_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/run';
const AGENT_RUNS_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/runs';

export const SSE_IDLE_TIMEOUT_MS = 60_000;

function orgIdHeaders(orgId?: string): Record<string, string> {
  if (orgId) {
    return { 'X-Grafana-Org-Id': orgId };
  }
  return {};
}

interface ReadSSEStreamOptions {
  abortSignal?: AbortSignal;
  lastSeenSequence?: number;
  idleTimeoutMs?: number;
}

class SSEIdleTimeoutError extends Error {
  constructor() {
    super('SSE idle timeout');
    this.name = 'SSEIdleTimeoutError';
  }
}

export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AgentCallbacks,
  options: ReadSSEStreamOptions = {}
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedTerminalEvent = false;
  let lastSeenSequence = options.lastSeenSequence ?? -1;
  const idleTimeout = options.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  let idleTimeoutId: ReturnType<typeof setTimeout>;

  function readWithTimeout(): Promise<ReadableStreamReadResult<Uint8Array>> {
    return Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        idleTimeoutId = setTimeout(() => reject(new SSEIdleTimeoutError()), idleTimeout);
      }),
    ]);
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout();
      clearTimeout(idleTimeoutId!);
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) {
          continue;
        }

        const jsonStr = trimmed.slice(6);
        if (!jsonStr) {
          continue;
        }

        let event: SSEEvent;
        try {
          event = JSON.parse(jsonStr);
        } catch {
            continue;
        }

        if (event.sequence <= lastSeenSequence) {
          continue;
        }
        lastSeenSequence = event.sequence;

        if (event.type === 'done' || event.type === 'error') {
          receivedTerminalEvent = true;
        }
        dispatchEvent(event, callbacks);
      }
    }
  } catch (err) {
    clearTimeout(idleTimeoutId!);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return true;
    }
    if (err instanceof SSEIdleTimeoutError) {
      try { await reader.cancel(); } catch { /* best-effort */ }
      return false;
    }
    throw err;
  } finally {
    reader.releaseLock();
  }

  return receivedTerminalEvent;
}

function dispatchEvent(event: SSEEvent, callbacks: AgentCallbacks): void {
  switch (event.type) {
    case 'content':
      callbacks.onContent(event.data);
      break;
    case 'tool_call_start':
      callbacks.onToolCallStart(event.data);
      break;
    case 'tool_call_result':
      callbacks.onToolCallResult(event.data);
      break;
    case 'done':
      callbacks.onDone(event.data);
      break;
    case 'error':
      callbacks.onError(event.data.message);
      break;
    case 'run_started':
      callbacks.onRunStarted?.(event.data);
      break;
    case 'mcp_unavailable':
      callbacks.onMCPUnavailable?.(event.data);
      break;
    case 'run_plan':
      callbacks.onRunPlan?.(event.data);
      break;
    case 'step_start':
    case 'step_done':
      callbacks.onStep?.(event.data);
      break;
    case 'evidence':
      callbacks.onEvidence?.(event.data);
      break;
    case 'approval_request':
      callbacks.onApprovalRequest?.(event.data);
      break;
    case 'approval_resolved':
      callbacks.onApprovalResolved?.(event.data);
      break;
    case 'final_report':
      callbacks.onFinalReport?.(event.data);
      break;
    default:
      break;
  }
}

export async function resolveAgentApproval(
  runId: string,
  approvalId: string,
  decision: 'approved' | 'rejected',
  comment?: string,
  orgId?: string
): Promise<ApprovalResolvedEvent> {
  const resp = await fetch(`${AGENT_RUNS_URL}/${runId}/approvals/${approvalId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...orgIdHeaders(orgId),
    },
    body: JSON.stringify({ decision, comment }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to resolve approval (${resp.status}): ${text}`);
  }

  return resp.json();
}

export interface DetachedRunResult {
  runId: string;
  sessionId: string;
  status: string;
  model?: 'base' | 'large';
  modelSource?: 'auto' | 'request' | 'session' | string;
}

export async function runAgentDetached(request: AgentRunRequest): Promise<DetachedRunResult> {
  const { orgId, model, ...body } = request;
  const url = new URL(AGENT_RUN_URL, window.location.origin);
  if (model) {
    url.searchParams.set('model', model);
  }

  const resp = await fetch(url.pathname + url.search, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...orgIdHeaders(orgId),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent detached request failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

export async function cancelAgentRun(runId: string, orgId?: string): Promise<void> {
  const resp = await fetch(`${AGENT_RUNS_URL}/${runId}/cancel`, {
    method: 'POST',
    headers: orgIdHeaders(orgId),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to cancel run (${resp.status}): ${text}`);
  }
}

export async function getAgentRunStatus(runId: string, orgId?: string): Promise<AgentRunStatus> {
  const resp = await fetch(`${AGENT_RUNS_URL}/${runId}`, {
    headers: orgIdHeaders(orgId),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get run status (${resp.status}): ${text}`);
  }

  return resp.json();
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 1000;

export async function reconnectToAgentRun(
  runId: string,
  callbacks: AgentCallbacks,
  orgId?: string,
  abortSignal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) {
      return;
    }

    if (attempt > 0) {
      callbacks.onReconnect?.();
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }

    const resp = await fetch(`${AGENT_RUNS_URL}/${runId}/events`, {
      headers: orgIdHeaders(orgId),
      signal: abortSignal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      callbacks.onError(`Failed to reconnect to run (${resp.status}): ${text}`);
      return;
    }

    if (!resp.body) {
      callbacks.onError('No response body from agent run events');
      return;
    }

    const completed = await readSSEStream(resp.body, callbacks, {
      abortSignal,
    });

    if (completed || abortSignal?.aborted) {
      return;
    }
  }

  callbacks.onError('Agent run did not complete after multiple reconnection attempts');
}
