import { of, throwError } from 'rxjs';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: { appSubUrl: '/grafana' },
  getBackendSrv: () => ({ fetch: fetchMock }),
}));

import { OAUTH_RESULT_KEY, disconnectOAuth, getOAuthStatus, onOAuthCallback, openOAuthPopup, startOAuthUrl } from '../oauthClient';

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

  describe('openOAuthPopup', () => {
    it('opens the popup without an opener and without a referrer', () => {
      const spy = jest.spyOn(window, 'open').mockImplementation(() => null);

      openOAuthPopup('atlassian');

      expect(spy).toHaveBeenCalledWith(
        '/grafana/api/plugins/consensys-asko11y-app/resources/api/oauth/atlassian/start',
        '_blank',
        expect.stringMatching(/noopener/)
      );
      expect(spy.mock.calls[0][2]).toMatch(/noreferrer/);
      spy.mockRestore();
    });
  });

  describe('onOAuthCallback', () => {
    const valid = { source: 'asko11y-oauth', serverID: 'atlassian', success: true };

    function dispatchResult(value: string | null): void {
      window.dispatchEvent(new StorageEvent('storage', { key: OAUTH_RESULT_KEY, newValue: value }));
    }

    it('invokes the callback for a well-formed result and clears the key', () => {
      const cb = jest.fn();
      const unsubscribe = onOAuthCallback(cb);

      dispatchResult(JSON.stringify(valid));

      expect(cb).toHaveBeenCalledWith(valid);
      expect(window.localStorage.getItem(OAUTH_RESULT_KEY)).toBeNull();
      unsubscribe();
    });

    it('ignores other keys and malformed or wrong-shape values', () => {
      const cb = jest.fn();
      const unsubscribe = onOAuthCallback(cb);

      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: JSON.stringify(valid) }));
      dispatchResult('not json');
      dispatchResult(JSON.stringify({ source: 'other' }));
      dispatchResult(null);

      expect(cb).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('stops delivering after unsubscribe', () => {
      const cb = jest.fn();
      const unsubscribe = onOAuthCallback(cb);
      unsubscribe();

      dispatchResult(JSON.stringify(valid));

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
