import { firstValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { pluginUrl } from '../utils/subpath';

export interface OAuthStatus {
  configured: boolean;
  connected: boolean;
  expiresAt?: string;
}

/**
 * Returns the OAuth connection status for a given MCP server and the current
 * Grafana user. Safe to call for servers without an OAuth block — the backend
 * responds 404 and this resolves to configured:false.
 */
export async function getOAuthStatus(serverId: string): Promise<OAuthStatus> {
  try {
    const resp = await firstValueFrom(
      getBackendSrv().fetch<OAuthStatus>({
        url: pluginUrl(`/api/oauth/${encodeURIComponent(serverId)}/status`),
        method: 'GET',
        showErrorAlert: false,
      })
    );
    return resp?.data ?? { configured: false, connected: false };
  } catch {
    return { configured: false, connected: false };
  }
}

/**
 * Returns the URL the UI should open in a popup to kick off the
 * authorization-code flow. The backend 302s to the authorization server.
 */
export function startOAuthUrl(serverId: string): string {
  return pluginUrl(`/api/oauth/${encodeURIComponent(serverId)}/start`);
}

/**
 * Opens the OAuth flow in a popup. `noopener,noreferrer` is required by the
 * catalog code rules: it stops the provider page from touching this window
 * through `window.opener`. The handle is therefore always null, and popup
 * blocking cannot be detected — the result arrives through the storage event
 * below instead of a postMessage.
 */
export function openOAuthPopup(serverId: string): void {
  window.open(
    startOAuthUrl(serverId),
    '_blank',
    'noopener,noreferrer,width=600,height=750,menubar=no,toolbar=no'
  );
}

/** Tells the backend to forget the current user's stored token for a server. */
export async function disconnectOAuth(serverId: string): Promise<void> {
  await firstValueFrom(
    getBackendSrv().fetch({
      url: pluginUrl(`/api/oauth/${encodeURIComponent(serverId)}/disconnect`),
      method: 'POST',
    })
  );
}

/** Shape of the postMessage the /callback page dispatches to the opener. */
export interface OAuthCallbackMessage {
  source: 'asko11y-oauth';
  serverID: string;
  success: boolean;
  reason?: string;
}

function isOAuthCallbackMessage(data: unknown): data is OAuthCallbackMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).source === 'asko11y-oauth' &&
    typeof (data as Record<string, unknown>).serverID === 'string' &&
    typeof (data as Record<string, unknown>).success === 'boolean'
  );
}

/**
 * Key the callback page writes its result to. A storage event is the only
 * channel left once `noopener` removes `window.opener`: it fires in every
 * same-origin document except the one that wrote it, which is exactly the
 * popup-to-opener direction.
 */
export const OAUTH_RESULT_KEY = 'asko11y-oauth-result';

/**
 * Subscribes to OAuth popup completion events. The callback page is served by
 * the plugin backend on the Grafana origin, so the storage event carries the
 * same trust boundary as a same-origin message. Returns an unsubscribe
 * function.
 */
export function onOAuthCallback(cb: (msg: OAuthCallbackMessage) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== OAUTH_RESULT_KEY || !e.newValue) {
      return;
    }
    try {
      const payload: unknown = JSON.parse(e.newValue);
      if (isOAuthCallbackMessage(payload)) {
        cb(payload);
      }
    } catch {
      // A malformed value is not ours to repair; drop it.
    } finally {
      window.localStorage.removeItem(OAUTH_RESULT_KEY);
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
