import { firstValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';

export interface OAuthStatus {
  configured: boolean;
  connected: boolean;
  expiresAt?: string;
}

const baseUrl = '/api/plugins/consensys-asko11y-app/resources';

/**
 * Returns the OAuth connection status for a given MCP server and the current
 * Grafana user. Safe to call even when the server has no OAuth block — the
 * backend returns configured:false in that case.
 */
export async function getOAuthStatus(serverID: string): Promise<OAuthStatus> {
  try {
    const resp = await firstValueFrom(
      getBackendSrv().fetch<OAuthStatus>({
        url: `${baseUrl}/api/oauth/${encodeURIComponent(serverID)}/status`,
        method: 'GET',
      })
    );
    return resp?.data ?? { configured: false, connected: false };
  } catch {
    return { configured: false, connected: false };
  }
}

/**
 * Returns the absolute URL the UI should open in a popup to kick off the
 * authorization-code flow. The backend 302s to the authorization server.
 */
export function startOAuthURL(serverID: string): string {
  return `${baseUrl}/api/oauth/${encodeURIComponent(serverID)}/start`;
}

/**
 * Opens the OAuth flow in a popup. Returns the handle so the caller can
 * detect popup-blocker scenarios and fall back to a same-tab redirect.
 */
export function openOAuthPopup(serverID: string): Window | null {
  return window.open(startOAuthURL(serverID), '_blank', 'width=600,height=750,menubar=no,toolbar=no');
}

/**
 * Tells the backend to forget the current user's stored token for a server.
 */
export async function disconnectOAuth(serverID: string): Promise<void> {
  await firstValueFrom(
    getBackendSrv().fetch({
      url: `${baseUrl}/api/oauth/${encodeURIComponent(serverID)}/disconnect`,
      method: 'POST',
    })
  );
}

/**
 * Shape of the postMessage the /callback handler dispatches to the opener.
 */
export interface OAuthCallbackMessage {
  source: 'asko11y-oauth';
  serverID: string;
  success: boolean;
  reason?: string;
}

/**
 * Subscribe to OAuth popup-close events. Returns an unsubscribe function.
 */
export function onOAuthCallback(cb: (msg: OAuthCallbackMessage) => void): () => void {
  const handler = (e: MessageEvent) => {
    const data = e.data as OAuthCallbackMessage | null;
    if (!data || data.source !== 'asko11y-oauth') {
      return;
    }
    cb(data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
