import { runAgent, AgentCallbacks, AgentRunRequest } from '../agentClient';

function createMockBody(lines: string[]) {
  const encoder = new TextEncoder();
  const data = encoder.encode(lines.join('\n') + '\n');
  let read = false;
  return {
    getReader: () => ({
      read: async () => {
        if (!read) {
          read = true;
          return { done: false, value: data };
        }
        return { done: true, value: undefined };
      },
      releaseLock: () => {},
    }),
  };
}

function createMockCallbacks(): jest.Mocked<AgentCallbacks> {
  return {
    onContent: jest.fn(),
    onToolCallStart: jest.fn(),
    onToolCallResult: jest.fn(),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
}

const defaultRequest: AgentRunRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
  systemPrompt: 'You are helpful',
};

describe('agentClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should parse content events from SSE stream', async () => {
    const callbacks = createMockCallbacks();
    const sseLines = [
      'data: {"type":"content","data":{"content":"Hello world"}}',
      '',
      'data: {"type":"done","data":{"totalIterations":1}}',
      '',
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(sseLines),
    });

    await runAgent(defaultRequest, callbacks);

    expect(callbacks.onContent).toHaveBeenCalledWith({ content: 'Hello world' });
    expect(callbacks.onDone).toHaveBeenCalledWith({ totalIterations: 1 });
  });

  it('should parse tool call events from SSE stream', async () => {
    const callbacks = createMockCallbacks();
    const sseLines = [
      'data: {"type":"tool_call_start","data":{"id":"call_1","name":"query_prometheus","arguments":"{}"}}',
      '',
      'data: {"type":"tool_call_result","data":{"id":"call_1","name":"query_prometheus","content":"result","isError":false}}',
      '',
      'data: {"type":"content","data":{"content":"Based on the results..."}}',
      '',
      'data: {"type":"done","data":{"totalIterations":2}}',
      '',
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(sseLines),
    });

    await runAgent(defaultRequest, callbacks);

    expect(callbacks.onToolCallStart).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'query_prometheus',
      arguments: '{}',
    });
    expect(callbacks.onToolCallResult).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'query_prometheus',
      content: 'result',
      isError: false,
    });
    expect(callbacks.onContent).toHaveBeenCalledWith({ content: 'Based on the results...' });
    expect(callbacks.onDone).toHaveBeenCalledWith({ totalIterations: 2 });
  });

  it('should call onError for non-OK response', async () => {
    const callbacks = createMockCallbacks();

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    });

    await runAgent(defaultRequest, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith('Agent request failed (500): Internal Server Error');
  });

  it('should call onError when response body is null', async () => {
    const callbacks = createMockCallbacks();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    await runAgent(defaultRequest, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith('No response body from agent');
  });

  it('should handle SSE error events', async () => {
    const callbacks = createMockCallbacks();
    const sseLines = [
      'data: {"type":"error","data":{"message":"LLM request failed"}}',
      '',
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(sseLines),
    });

    await runAgent(defaultRequest, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith('LLM request failed');
  });

  it('should skip malformed SSE lines without crashing', async () => {
    const callbacks = createMockCallbacks();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const sseLines = [
      'data: not-valid-json',
      '',
      'data: {"type":"content","data":{"content":"valid"}}',
      '',
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(sseLines),
    });

    await runAgent(defaultRequest, callbacks);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Malformed SSE JSON'), expect.any(String));
    expect(callbacks.onContent).toHaveBeenCalledWith({ content: 'valid' });

    warnSpy.mockRestore();
  });

  it('should send correct request body', async () => {
    const callbacks = createMockCallbacks();
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(['data: {"type":"done","data":{"totalIterations":0}}', '']),
    });
    global.fetch = mockFetch;

    const request: AgentRunRequest = {
      messages: [{ role: 'user', content: 'test' }],
      systemPrompt: 'system',
      summary: 'prev summary',
      maxTotalTokens: 50000,
      recentMessageCount: 10,
    };

    await runAgent(request, callbacks);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/plugins/consensys-asko11y-app/resources/api/agent/run',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
    );
  });
});
