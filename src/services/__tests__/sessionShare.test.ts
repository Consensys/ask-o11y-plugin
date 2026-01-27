import { of, throwError } from 'rxjs';
import { sessionShareService } from '../sessionShare';
import { ChatSession } from '../../core/models/ChatSession';
import { ChatMessage } from '../../components/Chat/types';

// Mock @grafana/runtime
const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: mockFetch,
  }),
  config: {
    bootData: {
      user: {
        orgId: 1,
      },
    },
  },
}));

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    origin: 'http://localhost:3000',
  },
  writable: true,
});

describe('SessionShareService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createShare', () => {
    it('should create a share successfully', async () => {
      const session = ChatSession.create(
        [{ role: 'user', content: 'test message' }] as ChatMessage[],
        'Test Session'
      );

      const mockResponse = {
        shareId: 'test-share-id',
        shareUrl: '/a/consensys-asko11y-app/shared/test-share-id',
        expiresAt: '2024-12-31T23:59:59Z',
      };

      mockFetch.mockReturnValue(
        of({
          data: mockResponse,
        })
      );

      const result = await sessionShareService.createShare(session.id, session, 7);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/sessions/share',
        method: 'POST',
        data: {
          sessionId: session.id,
          sessionData: session.toStorage(),
          expiresInDays: 7,
        },
        showErrorAlert: false,
      });
    });

    it('should create a share with hours expiration', async () => {
      const session = ChatSession.create(
        [{ role: 'user', content: 'test message' }] as ChatMessage[],
        'Test Session'
      );

      const mockResponse = {
        shareId: 'test-share-id',
        shareUrl: '/a/consensys-asko11y-app/shared/test-share-id',
        expiresAt: '2024-12-31T23:59:59Z',
      };

      mockFetch.mockReturnValue(
        of({
          data: mockResponse,
        })
      );

      const result = await sessionShareService.createShare(session.id, session, undefined, 1);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/sessions/share',
        method: 'POST',
        data: {
          sessionId: session.id,
          sessionData: session.toStorage(),
          expiresInHours: 1,
        },
        showErrorAlert: false,
      });
    });

    it('should handle errors', async () => {
      const session = ChatSession.create(
        [{ role: 'user', content: 'test message' }] as ChatMessage[],
        'Test Session'
      );

      mockFetch.mockReturnValue(throwError(() => new Error('Network error')));

      await expect(sessionShareService.createShare(session.id, session)).rejects.toThrow('Network error');
    });
  });

  describe('getSharedSession', () => {
    it('should get a shared session successfully', async () => {
      const mockResponse = {
        id: 'session-123',
        title: 'Shared Session',
        messages: [{ role: 'user', content: 'test' }],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        isShared: true,
      };

      mockFetch.mockReturnValue(
        of({
          data: mockResponse,
        })
      );

      const result = await sessionShareService.getSharedSession('test-share-id');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/sessions/shared/test-share-id',
        method: 'GET',
        showErrorAlert: false,
      });
    });

    it('should handle errors', async () => {
      mockFetch.mockReturnValue(throwError(() => new Error('Not found')));

      await expect(sessionShareService.getSharedSession('invalid-id')).rejects.toThrow('Not found');
    });
  });

  describe('revokeShare', () => {
    it('should revoke a share successfully', async () => {
      mockFetch.mockReturnValue(of({}));

      await sessionShareService.revokeShare('test-share-id');

      expect(mockFetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/sessions/share/test-share-id',
        method: 'DELETE',
        showErrorAlert: false,
      });
    });

    it('should handle errors', async () => {
      mockFetch.mockReturnValue(throwError(() => new Error('Failed to revoke')));

      await expect(sessionShareService.revokeShare('test-share-id')).rejects.toThrow('Failed to revoke');
    });
  });

  describe('getSessionShares', () => {
    it('should get all shares for a session', async () => {
      const mockResponse = [
        {
          shareId: 'share-1',
          shareUrl: '/a/consensys-asko11y-app/shared/share-1',
          expiresAt: null,
        },
        {
          shareId: 'share-2',
          shareUrl: '/a/consensys-asko11y-app/shared/share-2',
          expiresAt: '2024-12-31T23:59:59Z',
        },
      ];

      mockFetch.mockReturnValue(
        of({
          data: mockResponse,
        })
      );

      const result = await sessionShareService.getSessionShares('session-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith({
        url: '/api/plugins/consensys-asko11y-app/resources/api/sessions/session-123/shares',
        method: 'GET',
        showErrorAlert: false,
      });
    });

    it('should return empty array on error', async () => {
      mockFetch.mockReturnValue(throwError(() => new Error('Not found')));

      const result = await sessionShareService.getSessionShares('invalid-session');

      expect(result).toEqual([]);
    });
  });

  describe('buildShareUrl', () => {
    it('should build a full share URL with orgId', () => {
      const url = sessionShareService.buildShareUrl('test-share-id');
      expect(url).toBe('http://localhost:3000/a/consensys-asko11y-app/shared/test-share-id?orgId=1');
    });

    it('should build a full share URL from backend path with orgId', () => {
      const url = sessionShareService.buildShareUrl('/a/consensys-asko11y-app/shared/test-share-id');
      expect(url).toBe('http://localhost:3000/a/consensys-asko11y-app/shared/test-share-id?orgId=1');
    });
  });
});
