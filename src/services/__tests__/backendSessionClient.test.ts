import { getSessionStats } from '../backendSessionClient';

jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      user: { orgId: 1 },
    },
  },
}));

describe('getSessionStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetches usage stats for a session', async () => {
    const stats = {
      sessionId: 'abc',
      runCount: 2,
      totalIterations: 5,
      toolCallCount: 3,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:01:00Z',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(stats),
    });

    await expect(getSessionStats('abc')).resolves.toEqual(stats);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions/abc/stats'),
      expect.objectContaining({ headers: { 'X-Grafana-Org-Id': '1' } })
    );
  });

  it('throws when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(getSessionStats('missing')).rejects.toThrow('Failed to get session stats (404)');
  });
});
