export interface AgentRunRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  summary?: string;
  maxTotalTokens?: number;
  recentMessageCount?: number;
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

type SSEEventData = ContentEvent | ToolCallStartEvent | ToolCallResultEvent | DoneEvent | ErrorEvent;

export interface SSEEvent {
  type: 'content' | 'tool_call_start' | 'tool_call_result' | 'done' | 'error';
  data: SSEEventData;
}

export interface AgentCallbacks {
  onContent: (event: ContentEvent) => void;
  onToolCallStart: (event: ToolCallStartEvent) => void;
  onToolCallResult: (event: ToolCallResultEvent) => void;
  onDone: (event: DoneEvent) => void;
  onError: (message: string) => void;
}

const AGENT_RUN_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/run';

export async function runAgent(
  request: AgentRunRequest,
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const resp = await fetch(AGENT_RUN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
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

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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

        try {
          const event: SSEEvent = JSON.parse(jsonStr);
          dispatchEvent(event, callbacks);
        } catch {
          console.warn('[agentClient] Failed to parse SSE event:', jsonStr);
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    throw err;
  }
}

function dispatchEvent(event: SSEEvent, callbacks: AgentCallbacks): void {
  switch (event.type) {
    case 'content':
      callbacks.onContent(event.data as ContentEvent);
      break;
    case 'tool_call_start':
      callbacks.onToolCallStart(event.data as ToolCallStartEvent);
      break;
    case 'tool_call_result':
      callbacks.onToolCallResult(event.data as ToolCallResultEvent);
      break;
    case 'done':
      callbacks.onDone(event.data as DoneEvent);
      break;
    case 'error':
      callbacks.onError((event.data as ErrorEvent).message);
      break;
  }
}
