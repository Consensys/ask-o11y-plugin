/**
 * Unit tests for OAuthService
 */

import { oauthService, OAuthService } from './oauthService';
import { getBackendSrv } from '@grafana/runtime';
import { of } from 'rxjs';

// Mock Grafana runtime
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

describe('OAuthService', () => {
  let service: OAuthService;

  beforeEach(() => {
    service = new OAuthService();
    jest.clearAllMocks();
  });

  describe('discoverMetadata', () => {
    it('should discover OAuth metadata from server URL', async () => {
      const mockMetadata = {
        issuer: 'https://oauth.example.com',
        authorization_endpoint: 'https://oauth.example.com/authorize',
        token_endpoint: 'https://oauth.example.com/token',
        registration_endpoint: 'https://oauth.example.com/register',
      };

      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(of({ data: mockMetadata })),
      } as any);

      const result = await service.discoverMetadata('https://mcp.example.com');

      expect(result).toEqual(mockMetadata);
      expect(mockBackendSrv().fetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/mcp/oauth/discover',
        method: 'POST',
        data: { serverUrl: 'https://mcp.example.com' },
        showErrorAlert: false,
      });
    });

    it('should throw error when backend returns no data', async () => {
      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(of({ data: null })),
      } as any);

      await expect(service.discoverMetadata('https://mcp.example.com')).rejects.toThrow('No response from backend');
    });
  });

  describe('registerClient', () => {
    it('should register OAuth client', async () => {
      const mockRegistration = {
        client_id: 'client-123',
        client_secret: 'secret-456',
      };

      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(of({ data: mockRegistration })),
      } as any);

      const result = await service.registerClient({
        registrationEndpoint: 'https://oauth.example.com/register',
        clientName: 'Test Client',
        redirectUri: 'https://grafana.example.com/callback',
        scopes: ['mcp:tools', 'mcp:resources'],
      });

      expect(result).toEqual(mockRegistration);
      expect(mockBackendSrv().fetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/mcp/oauth/register',
        method: 'POST',
        data: {
          registrationEndpoint: 'https://oauth.example.com/register',
          clientName: 'Test Client',
          redirectUri: 'https://grafana.example.com/callback',
          scopes: ['mcp:tools', 'mcp:resources'],
        },
        showErrorAlert: false,
      });
    });
  });

  describe('getOAuthStatus', () => {
    it('should get OAuth status for server', async () => {
      const mockStatus = {
        tokenStatus: 'authorized' as const,
        expiresAt: '2026-01-23T10:00:00Z',
        lastError: undefined,
      };

      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(of({ data: mockStatus })),
      } as any);

      const result = await service.getOAuthStatus('server-123');

      expect(result).toEqual(mockStatus);
      expect(mockBackendSrv().fetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/mcp/oauth/status?serverId=server-123',
        method: 'GET',
        showErrorAlert: false,
      });
    });
  });

  describe('revokeToken', () => {
    it('should revoke OAuth token', async () => {
      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(of({ data: {} })),
      } as any);

      await service.revokeToken('server-123');

      expect(mockBackendSrv().fetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/mcp/oauth/revoke',
        method: 'POST',
        data: { serverId: 'server-123' },
        showErrorAlert: false,
      });
    });
  });

  describe('startAuthorization', () => {
    let mockPopup: any;

    beforeEach(() => {
      mockPopup = {
        close: jest.fn(),
        closed: false,
      };
      global.window.open = jest.fn().mockReturnValue(mockPopup);
      global.window.addEventListener = jest.fn();
      global.window.removeEventListener = jest.fn();
    });

    it('should open popup and wait for authorization', async () => {
      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(
          of({
            data: {
              authUrl: 'https://oauth.example.com/authorize?code=xyz',
            },
          })
        ),
      } as any);

      // Simulate successful authorization after a short delay
      setTimeout(() => {
        const messageHandler = (global.window.addEventListener as jest.Mock).mock.calls.find(
          (call) => call[0] === 'message'
        )?.[1];
        if (messageHandler) {
          messageHandler({
            source: mockPopup,
            data: { type: 'oauth-complete' },
          });
        }
      }, 10);

      const config = {
        clientId: 'client-123',
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
      };

      await service.startAuthorization('server-123', config);

      expect(global.window.open).toHaveBeenCalledWith(
        'https://oauth.example.com/authorize?code=xyz',
        'OAuth Authorization',
        'width=600,height=800,scrollbars=yes,resizable=yes'
      );
    });

    it('should throw error if popup is blocked', async () => {
      mockBackendSrv.mockReturnValue({
        fetch: jest.fn().mockReturnValue(
          of({
            data: {
              authUrl: 'https://oauth.example.com/authorize?code=xyz',
            },
          })
        ),
      } as any);

      global.window.open = jest.fn().mockReturnValue(null);

      const config = {
        clientId: 'client-123',
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
      };

      await expect(service.startAuthorization('server-123', config)).rejects.toThrow(
        'Failed to open popup window. Please allow popups for this site.'
      );
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(oauthService).toBeInstanceOf(OAuthService);
    });
  });
});
