import { of, throwError } from 'rxjs';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: { appSubUrl: '/grafana' },
  getBackendSrv: () => ({ fetch: fetchMock }),
}));

import { disconnectOAuth, getOAuthStatus, onOAuthCallback, startOAuthUrl } from '../oauthClient';

describe('oauthClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('builds subpath-aware start URLs and escapes the server ID', () => {
    expect(startOAuthUrl('my server')).toBe(
      '/grafana/api/plugins/consensys-asko11y-app/resources/api/oauth/my%20server/start'
    );
  });

  it('fetches OAuth status', async () => {
    fetchMock.mockReturnValue(of({ data: { configured: true, connected: true, expiresAt: '2026-01-01T00:00:00Z' } }));
    const status = await getOAuthStatus('atlassian');
    expect(status.connected).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/grafana/api/plugins/consensys-asko11y-app/resources/api/oauth/atlassian/status',
        method: 'GET',
      })
    );
  });

  it('reports not configured when the status call fails', async () => {
    fetchMock.mockReturnValue(throwError(() => new Error('404')));
    const status = await getOAuthStatus('unknown');
    expect(status).toEqual({ configured: false, connected: false });
  });

  it('POSTs disconnect', async () => {
    fetchMock.mockReturnValue(of({}));
    await disconnectOAuth('atlassian');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/grafana/api/plugins/consensys-asko11y-app/resources/api/oauth/atlassian/disconnect',
        method: 'POST',
      })
    );
  });

  describe('onOAuthCallback', () => {
    it('invokes the callback for same-origin oauth messages only', () => {
      const cb = jest.fn();
      const unsubscribe = onOAuthCallback(cb);

      const valid = { source: 'asko11y-oauth', serverID: 'atlassian', success: true };
      window.dispatchEvent(new MessageEvent('message', { data: valid, origin: window.location.origin }));
      expect(cb).toHaveBeenCalledWith(valid);

      cb.mockClear();
      // Wrong origin is ignored.
      window.dispatchEvent(new MessageEvent('message', { data: valid, origin: 'https://evil.example' }));
      // Wrong shape is ignored.
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'other' }, origin: window.location.origin }));
      expect(cb).not.toHaveBeenCalled();

      unsubscribe();
      window.dispatchEvent(new MessageEvent('message', { data: valid, origin: window.location.origin }));
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
