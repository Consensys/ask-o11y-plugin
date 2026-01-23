import { getBackendSrv } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';
import { OAuth2Config } from '../types/plugin';

/**
 * OAuth metadata response from the server (RFC 8414)
 */
export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
}

/**
 * Client registration response (RFC 7591)
 */
export interface ClientRegistration {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  registration_access_token?: string;
  registration_client_uri?: string;
}

/**
 * OAuth authorization request
 */
export interface OAuthAuthorizeRequest {
  serverId: string;
  config: OAuth2Config;
}

/**
 * OAuth authorization response
 */
export interface OAuthAuthorizeResponse {
  authUrl: string;
}

/**
 * OAuth token status response
 */
export interface OAuthStatusResponse {
  tokenStatus: 'not_configured' | 'authorizing' | 'authorized' | 'expired' | 'error';
  expiresAt?: string;
  lastError?: string;
}

/**
 * OAuth revoke request
 */
export interface OAuthRevokeRequest {
  serverId: string;
}

/**
 * OAuth client registration request
 */
export interface OAuthRegisterRequest {
  registrationEndpoint: string;
  clientName?: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Service for managing OAuth 2.1 flows for MCP servers
 */
export class OAuthService {
  private baseUrl = '/api/plugins/consensys-asko11y-app/resources';

  /**
   * Discover OAuth metadata from an MCP server URL
   * @param serverUrl The MCP server URL to discover OAuth metadata from
   * @returns OAuth metadata including authorization and token endpoints
   */
  async discoverMetadata(serverUrl: string): Promise<OAuthMetadata> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<OAuthMetadata>({
          url: `${this.baseUrl}/api/mcp/oauth/discover`,
          method: 'POST',
          data: { serverUrl },
          showErrorAlert: false,
        })
      );

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[OAuthService] Failed to discover OAuth metadata:', error);
      throw error;
    }
  }

  /**
   * Register a new OAuth client using Dynamic Client Registration (RFC 7591)
   * @param request Client registration request
   * @returns Client credentials
   */
  async registerClient(request: OAuthRegisterRequest): Promise<ClientRegistration> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<ClientRegistration>({
          url: `${this.baseUrl}/api/mcp/oauth/register`,
          method: 'POST',
          data: request,
          showErrorAlert: false,
        })
      );

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[OAuthService] Failed to register OAuth client:', error);
      throw error;
    }
  }

  /**
   * Start the OAuth authorization flow
   * Opens a popup window for the user to authorize with the OAuth provider
   * @param serverId The MCP server ID
   * @param config The OAuth configuration
   * @returns Promise that resolves when authorization is complete
   */
  async startAuthorization(serverId: string, config: OAuth2Config): Promise<void> {
    try {
      // Get the authorization URL from the backend
      const response = await firstValueFrom(
        getBackendSrv().fetch<OAuthAuthorizeResponse>({
          url: `${this.baseUrl}/api/mcp/oauth/authorize`,
          method: 'POST',
          data: { serverId, config },
          showErrorAlert: false,
        })
      );

      if (!response || !response.data || !response.data.authUrl) {
        throw new Error('Failed to generate authorization URL');
      }

      // Open OAuth flow in a popup window
      const authUrl = response.data.authUrl;
      const popup = window.open(
        authUrl,
        'OAuth Authorization',
        'width=600,height=800,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Failed to open popup window. Please allow popups for this site.');
      }

      // Wait for the authorization to complete
      await this.waitForAuthCompletion(popup);
    } catch (error) {
      console.error('[OAuthService] Failed to start authorization:', error);
      throw error;
    }
  }

  /**
   * Get the OAuth token status for a server
   * @param serverId The MCP server ID
   * @returns Token status information
   */
  async getOAuthStatus(serverId: string): Promise<OAuthStatusResponse> {
    try {
      const response = await firstValueFrom(
        getBackendSrv().fetch<OAuthStatusResponse>({
          url: `${this.baseUrl}/api/mcp/oauth/status?serverId=${encodeURIComponent(serverId)}`,
          method: 'GET',
          showErrorAlert: false,
        })
      );

      if (!response || !response.data) {
        throw new Error('No response from backend');
      }

      return response.data;
    } catch (error) {
      console.error('[OAuthService] Failed to get OAuth status:', error);
      throw error;
    }
  }

  /**
   * Revoke OAuth tokens for a server
   * @param serverId The MCP server ID
   */
  async revokeToken(serverId: string): Promise<void> {
    try {
      await firstValueFrom(
        getBackendSrv().fetch({
          url: `${this.baseUrl}/api/mcp/oauth/revoke`,
          method: 'POST',
          data: { serverId },
          showErrorAlert: false,
        })
      );
    } catch (error) {
      console.error('[OAuthService] Failed to revoke OAuth token:', error);
      throw error;
    }
  }

  /**
   * Wait for the OAuth authorization to complete
   * Listens for postMessage events from the popup window
   * @param popup The popup window handle
   * @returns Promise that resolves when authorization completes
   */
  private waitForAuthCompletion(popup: Window): Promise<void> {
    return new Promise((resolve, reject) => {
      // Handle messages from the popup window
      const messageHandler = (event: MessageEvent) => {
        // Verify the message is from our popup
        if (event.source !== popup) {
          return;
        }

        if (event.data.type === 'oauth-complete') {
          window.removeEventListener('message', messageHandler);
          clearInterval(pollTimer);
          popup.close();
          resolve();
        } else if (event.data.type === 'oauth-error') {
          window.removeEventListener('message', messageHandler);
          clearInterval(pollTimer);
          popup.close();
          reject(new Error(event.data.error || 'OAuth authorization failed'));
        }
      };

      window.addEventListener('message', messageHandler);

      // Poll to check if the popup was closed manually
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          window.removeEventListener('message', messageHandler);
          clearInterval(pollTimer);
          reject(new Error('OAuth authorization was cancelled by the user'));
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        clearInterval(pollTimer);
        if (!popup.closed) {
          popup.close();
        }
        reject(new Error('OAuth authorization timed out'));
      }, 300000); // 5 minutes
    });
  }
}

// Export singleton instance
export const oauthService = new OAuthService();
