import { getBackendSrv } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';
import { ChatSession } from '../core/models/ChatSession';
import { ChatMessage } from '../components/Chat/types';
import pluginJson from '../plugin.json';

export interface CreateShareRequest {
  sessionId: string;
  sessionData: ChatSession;
  expiresInDays?: number;
}

export interface CreateShareResponse {
  shareId: string;
  shareUrl: string;
  expiresAt: string | null;
}

export interface SharedSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isShared: true;
  sharedBy?: string;
}

export class SessionShareService {
  private baseUrl = '/api/plugins/consensys-asko11y-app/resources';

  /**
   * Create a shareable link for a session
   */
  async createShare(
    sessionId: string,
    sessionData: ChatSession,
    expiresInDays?: number,
    expiresInHours?: number
  ): Promise<CreateShareResponse> {
    try {
      const requestData: any = {
        sessionId,
        sessionData: sessionData.toStorage(),
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

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[SessionShareService] Failed to create share:', error);
      throw error;
    }
  }

  /**
   * Get a shared session by share ID
   */
  async getSharedSession(shareId: string): Promise<SharedSession> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<SharedSession>({
          url: `${this.baseUrl}/api/sessions/shared/${shareId}`,
          method: 'GET',
          showErrorAlert: false,
        })
      );

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[SessionShareService] Failed to get shared session:', error);
      throw error;
    }
  }

  /**
   * Revoke a share link
   */
  async revokeShare(shareId: string): Promise<void> {
    try {
      await firstValueFrom(
        getBackendSrv().fetch({
          url: `${this.baseUrl}/api/sessions/share/${shareId}`,
          method: 'DELETE',
          showErrorAlert: false,
        })
      );
    } catch (error) {
      console.error('[SessionShareService] Failed to revoke share:', error);
      throw error;
    }
  }

  /**
   * Get all shares for a session
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

      if (!response || !response.data) {
        return [];
      }

      return response.data;
    } catch (error) {
      console.error('[SessionShareService] Failed to get session shares:', error);
      return [];
    }
  }

  /**
   * Build a full share URL from a share ID
   */
  buildShareUrl(shareId: string): string {
    // Get current origin
    const origin = window.location.origin;
    return `${origin}/a/${pluginJson.id}/shared/${shareId}`;
  }
}

// Export singleton instance
export const sessionShareService = new SessionShareService();
