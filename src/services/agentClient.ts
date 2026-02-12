export interface AgentRunRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  summary?: string;
  maxTotalTokens?: number;
  recentMessageCount?: number;
  orgId?: string;
  orgName?: string;
  scopeOrgId?: string;
  mode?: 'stream' | 'detached';
}

export interface ContentEvent {
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
}

export type SSEEvent =
  | { type: 'content'; data: ContentEvent }
  | { type: 'tool_call_start'; data: ToolCallStartEvent }
  | { type: 'tool_call_result'; data: ToolCallResultEvent }
  | { type: 'done'; data: DoneEvent }
  | { type: 'error'; data: ErrorEvent }
  | { type: 'run_started'; data: RunStartedEvent };

export interface AgentCallbacks {
  onContent: (event: ContentEvent) => void;
  onToolCallStart: (event: ToolCallStartEvent) => void;
  onToolCallResult: (event: ToolCallResultEvent) => void;
  onDone: (event: DoneEvent) => void;
  onError: (message: string) => void;
  onRunStarted?: (event: RunStartedEvent) => void;
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
  expectTerminalEvent?: boolean;
  abortSignal?: AbortSignal;
}

async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AgentCallbacks,
  options: ReadSSEStreamOptions = {}
): Promise<void> {
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

    if (options.expectTerminalEvent && !receivedTerminalEvent && !options.abortSignal?.aborted) {
      callbacks.onError('Agent stream ended unexpectedly without a completion event');
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

export async function runAgent(
  request: AgentRunRequest,
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const { orgId, ...body } = request;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...orgIdHeaders(orgId),
  };

  const resp = await fetch(AGENT_RUN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    callbacks.onError(`Agent request failed (${resp.status}): ${text}`);
    return;
  }

  if (!resp.body) {
    callbacks.onError('No response body from agent');
    return;
  }

  await readSSEStream(resp.body, callbacks, {
    warnOnMalformedJSON: true,
    expectTerminalEvent: true,
    abortSignal,
  });
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
    default:
      console.warn(`[agentClient] Unknown SSE event type: ${(event as { type: string }).type}`);
      break;
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

export async function reconnectToAgentRun(
  runId: string,
  callbacks: AgentCallbacks,
  orgId?: string,
  abortSignal?: AbortSignal
): Promise<void> {
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

  await readSSEStream(resp.body, callbacks);
}
