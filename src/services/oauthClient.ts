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
 * Opens the OAuth flow in a popup. Returns the handle so the caller can
 * detect popup-blocker scenarios and fall back to a same-tab redirect.
 */
export function openOAuthPopup(serverId: string): Window | null {
  return window.open(startOAuthUrl(serverId), '_blank', 'width=600,height=750,menubar=no,toolbar=no');
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
 * Subscribes to OAuth popup completion events. Only messages from this
 * window's own origin are accepted (the callback page is served by the
 * plugin backend on the Grafana origin). Returns an unsubscribe function.
 */
export function onOAuthCallback(cb: (msg: OAuthCallbackMessage) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || !isOAuthCallbackMessage(e.data)) {
      return;
    }
    cb(e.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
