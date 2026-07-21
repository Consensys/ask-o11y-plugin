import { getBackendSrv, config } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';
import { ChatMessage } from '../components/Chat/types';
import pluginJson from '../plugin.json';

/** Response from creating a share link */
export interface CreateShareResponse {
  shareId: string;
  shareUrl: string;
  expiresAt: string | null;
}

/** Session data retrieved from a share link */
export interface SharedSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isShared: true;
  sharedBy?: string;
}

/** Raw session data from backend response */
interface SharedSessionResponse {
  id?: string;
  title?: string;
  messages?: ChatMessage[];
  createdAt?: string;
  updatedAt?: string;
  sharedBy?: string;
}

/** Error thrown by session share operations */
export class SessionShareError extends Error {
  constructor(
    message: string,
    public readonly code: 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'NOT_FOUND' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'SessionShareError';
  }
}

export class SessionShareService {
  private baseUrl = '/api/plugins/consensys-asko11y-app/resources';

  /**
   * Create a shareable link for a session
   */
  async createShare(
    sessionId: string,
    sessionData: { id: string; title: string; messages: ChatMessage[]; createdAt: string; updatedAt: string; messageCount: number; summary?: string },
    expiresInDays?: number,
    expiresInHours?: number
  ): Promise<CreateShareResponse> {
    const requestData: Record<string, unknown> = {
      sessionId,
      sessionData,
    };

    // Send expiresInHours if provided, otherwise expiresInDays
    if (expiresInHours !== undefined) {
      requestData.expiresInHours = expiresInHours;
    } else if (expiresInDays !== undefined) {
      requestData.expiresInDays = expiresInDays;
    }

    const response = await firstValueFrom(
      getBackendSrv().fetch<CreateShareResponse>({
        url: `${this.baseUrl}/api/sessions/share`,
        method: 'POST',
        data: requestData,
        showErrorAlert: false,
      })
    );

    if (!response?.data) {
      throw new Error('No response from backend');
    }

    return response.data;
  }

  /**
   * Get a shared session by share ID
   */
  async getSharedSession(shareId: string): Promise<SharedSession> {
    const response = await firstValueFrom(
      getBackendSrv().fetch<SharedSessionResponse>({
        url: `${this.baseUrl}/api/sessions/shared/${shareId}`,
        method: 'GET',
        showErrorAlert: false,
      })
    );

    if (!response?.data) {
      throw new SessionShareError('No response from backend', 'NETWORK_ERROR');
    }

    const data = response.data;

    if (!data.messages || !Array.isArray(data.messages)) {
      throw new SessionShareError(
        'Invalid session data: messages array is missing or invalid',
        'INVALID_RESPONSE'
      );
    }

    const sharedSession: SharedSession = {
      id: data.id ?? '',
      title: data.title ?? 'Shared Session',
      messages: data.messages,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      isShared: true,
      sharedBy: data.sharedBy,
    };

    return sharedSession;
  }

  /**
   * Revoke a share link
   */
  async revokeShare(shareId: string): Promise<void> {
    await firstValueFrom(
      getBackendSrv().fetch({
        url: `${this.baseUrl}/api/sessions/share/${shareId}`,
        method: 'DELETE',
        showErrorAlert: false,
      })
    );
  }

  /**
   * Get all shares for a session
   * Returns empty array on error to allow graceful degradation
   */
  async getSessionShares(sessionId: string): Promise<CreateShareResponse[]> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<CreateShareResponse[]>({
          url: `${this.baseUrl}/api/sessions/${sessionId}/shares`,
          method: 'GET',
          showErrorAlert: false,
        })
      );

      return response?.data || [];
    } catch {
      return [];
    }
  }

  /**
   * Build a full share URL from a share ID or full path
   */
  buildShareUrl(shareUrlOrId: string): string {
    // Get current origin and orgId
    const origin = window.location.origin;
    const orgId = String(config.bootData.user.orgId || '1');

    // If it's already a full path from backend (starts with /a/), use it as-is
    // Backend already includes orgId query param
    if (shareUrlOrId.startsWith('/a/')) {
      return `${origin}${shareUrlOrId}`;
    }

    // Fallback for backward compatibility (just shareId)
    return `${origin}/a/${pluginJson.id}/shared/${shareUrlOrId}?orgId=${orgId}`;
  }
}

// Export singleton instance
export const sessionShareService = new SessionShareService();
