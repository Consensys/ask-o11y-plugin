import { runAgentDetached, reconnectToAgentRun, AgentCallbacks, AgentRunRequest } from '../agentClient';

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

describe('runAgentDetached', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should return runId and sessionId on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ runId: 'run-1', sessionId: 'sess-1', status: 'running' }),
    });

    const result = await runAgentDetached(defaultRequest);

    expect(result.runId).toBe('run-1');
    expect(result.sessionId).toBe('sess-1');
    expect(result.status).toBe('running');
  });

  it('should throw on non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    });

    await expect(runAgentDetached(defaultRequest)).rejects.toThrow('Agent detached request failed (500)');
  });

  it('should send correct request body without orgId', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ runId: 'run-1', sessionId: 'sess-1', status: 'running' }),
    });
    global.fetch = mockFetch;

    const request: AgentRunRequest = {
      messages: [{ role: 'user', content: 'test' }],
      systemPrompt: 'system',
      orgId: '42',
    };

    await runAgentDetached(request);

    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchOptions.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Grafana-Org-Id': '42',
      })
    );
    const body = JSON.parse(fetchOptions.body);
    expect(body.orgId).toBeUndefined();
  });
});

describe('reconnectToAgentRun', () => {
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

    await reconnectToAgentRun('run-1', callbacks);

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

    await reconnectToAgentRun('run-1', callbacks);

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

    await reconnectToAgentRun('run-1', callbacks);

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
      'data: {"type":"done","data":{"totalIterations":1}}',
      '',
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(sseLines),
    });

    await reconnectToAgentRun('run-1', callbacks);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Malformed SSE JSON'), expect.any(String));
    expect(callbacks.onContent).toHaveBeenCalledWith({ content: 'valid' });

    warnSpy.mockRestore();
  });

  it('should set X-Grafana-Org-Id header when orgId is provided', async () => {
    const callbacks = createMockCallbacks();
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createMockBody(['data: {"type":"done","data":{"totalIterations":0}}', '']),
    });
    global.fetch = mockFetch;

    await reconnectToAgentRun('run-1', callbacks, '42');

    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchOptions.headers).toEqual({ 'X-Grafana-Org-Id': '42' });
  });
});
