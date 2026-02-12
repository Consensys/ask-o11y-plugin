export interface AgentRunRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  summary?: string;
  maxTotalTokens?: number;
  recentMessageCount?: number;
  orgId?: string;
  orgName?: string;
  scopeOrgId?: string;
  sessionId?: string;
  title?: string;
}

export interface ContentEvent {
  content: string;
}

export interface ReasoningEvent {
  content: string;
}

export interface ToolCallStartEvent {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCallResultEvent {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface DoneEvent {
  totalIterations: number;
}

export interface ErrorEvent {
  message: string;
}

export interface RunStartedEvent {
  runId: string;
  sessionId?: string;
}

export type SSEEvent =
  | { type: 'content'; data: ContentEvent }
  | { type: 'reasoning'; data: ReasoningEvent }
  | { type: 'tool_call_start'; data: ToolCallStartEvent }
  | { type: 'tool_call_result'; data: ToolCallResultEvent }
  | { type: 'done'; data: DoneEvent }
  | { type: 'error'; data: ErrorEvent }
  | { type: 'run_started'; data: RunStartedEvent };

export interface AgentCallbacks {
  onContent: (event: ContentEvent) => void;
  onReasoning: (event: ReasoningEvent) => void;
  onToolCallStart: (event: ToolCallStartEvent) => void;
  onToolCallResult: (event: ToolCallResultEvent) => void;
  onDone: (event: DoneEvent) => void;
  onError: (message: string) => void;
  onRunStarted?: (event: RunStartedEvent) => void;
  onReconnect?: () => void;
}

export interface AgentRunStatus {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  userId: number;
  orgId: number;
  createdAt: string;
  updatedAt: string;
  events: SSEEvent[];
  error?: string;
}

const AGENT_RUN_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/run';
const AGENT_RUNS_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/runs';

function orgIdHeaders(orgId?: string): Record<string, string> {
  if (orgId) {
    return { 'X-Grafana-Org-Id': orgId };
  }
  return {};
}

interface ReadSSEStreamOptions {
  warnOnMalformedJSON?: boolean;
  abortSignal?: AbortSignal;
}

async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AgentCallbacks,
  options: ReadSSEStreamOptions = {}
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedTerminalEvent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
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
          if (options.warnOnMalformedJSON) {
            console.warn('[agentClient] Malformed SSE JSON, skipping:', jsonStr);
          }
          continue;
        }

        if (event.type === 'done' || event.type === 'error') {
          receivedTerminalEvent = true;
        }
        dispatchEvent(event, callbacks);
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return true;
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
    case 'reasoning':
      callbacks.onReasoning(event.data);
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
    default:
      console.warn(`[agentClient] Unknown SSE event type: ${(event as { type: string }).type}`);
      break;
  }
}

export interface DetachedRunResult {
  runId: string;
  sessionId: string;
  status: string;
}

export async function runAgentDetached(request: AgentRunRequest): Promise<DetachedRunResult> {
  const { orgId, ...body } = request;
  const resp = await fetch(AGENT_RUN_URL, {
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
      console.log(`[agentClient] SSE stream dropped, reconnecting (attempt ${attempt})`);
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
      warnOnMalformedJSON: true,
      abortSignal,
    });

    if (completed || abortSignal?.aborted) {
      return;
    }
  }

  callbacks.onError('Agent run did not complete after multiple reconnection attempts');
}
