import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessionUrl } from '../useSessionUrl';

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(() => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  })),
  config: {
    bootData: {
      user: { orgId: 1 },
    },
  },
}));

const mockGetSession = jest.fn();

jest.mock('../../core/services/ServiceFactory', () => ({
  ServiceFactory: {
    getSessionService: jest.fn(() => ({
      getSession: mockGetSession,
    })),
  },
}));

const mockReplaceState = jest.fn();

const setWindowLocation = (search: string, href: string) => {
  Object.defineProperty(window, 'location', {
    value: { search, href },
    writable: true,
  });
};

describe('useSessionUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockReset();
    window.history.replaceState = mockReplaceState;
  });

  describe('when no sessionId in URL', () => {
    it('should return null sessionIdFromUrl and validate immediately', async () => {
      setWindowLocation('', 'http://localhost/a/consensys-asko11y-app');

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });

  describe('when valid sessionId in URL', () => {
    it('should validate and keep sessionId when session exists', async () => {
      setWindowLocation(
        '?sessionId=session-123-abc',
        'http://localhost/a/consensys-asko11y-app?sessionId=session-123-abc'
      );
      mockGetSession.mockResolvedValue({ id: 'session-123-abc', messages: [] });

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBe('session-123-abc');
      expect(mockGetSession).toHaveBeenCalledWith('1', 'session-123-abc');
    });

    it('should clean URL when session does not exist', async () => {
      setWindowLocation(
        '?sessionId=nonexistent-session',
        'http://localhost/a/consensys-asko11y-app?sessionId=nonexistent-session'
      );
      mockGetSession.mockResolvedValue(null);

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockReplaceState).toHaveBeenCalled();
    });

    it('should clean URL when session lookup fails', async () => {
      setWindowLocation(
        '?sessionId=error-session',
        'http://localhost/a/consensys-asko11y-app?sessionId=error-session'
      );
      mockGetSession.mockRejectedValue(new Error('Storage error'));

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockReplaceState).toHaveBeenCalled();
    });
  });

  describe('when invalid sessionId format in URL', () => {
    it('should reject sessionId with special characters', async () => {
      setWindowLocation(
        '?sessionId=<script>alert(1)</script>',
        'http://localhost/a/consensys-asko11y-app?sessionId=<script>alert(1)</script>'
      );

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(mockReplaceState).toHaveBeenCalled();
    });

    it('should reject sessionId that is too long', async () => {
      const longId = 'a'.repeat(150);
      setWindowLocation(
        `?sessionId=${longId}`,
        `http://localhost/a/consensys-asko11y-app?sessionId=${longId}`
      );

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it('should reject sessionId with spaces', async () => {
      setWindowLocation(
        '?sessionId=session with spaces',
        'http://localhost/a/consensys-asko11y-app?sessionId=session%20with%20spaces'
      );

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it('should allow valid sessionId with hyphens and underscores', async () => {
      setWindowLocation(
        '?sessionId=session-123_abc',
        'http://localhost/a/consensys-asko11y-app?sessionId=session-123_abc'
      );
      mockGetSession.mockResolvedValue({ id: 'session-123_abc', messages: [] });

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBe('session-123_abc');
    });
  });

  describe('updateUrlWithSession', () => {
    it('should update URL and state with new sessionId', async () => {
      setWindowLocation('', 'http://localhost/a/consensys-asko11y-app');

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      act(() => {
        result.current.updateUrlWithSession('new-session-456');
      });

      expect(result.current.sessionIdFromUrl).toBe('new-session-456');
      expect(mockReplaceState).toHaveBeenCalled();
    });

    it('should reject invalid sessionId formats', async () => {
      setWindowLocation('', 'http://localhost/a/consensys-asko11y-app');

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      mockReplaceState.mockClear();

      act(() => {
        result.current.updateUrlWithSession('<script>alert(1)</script>');
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockReplaceState).not.toHaveBeenCalled();
    });

    it('should reject sessionId that is too long', async () => {
      setWindowLocation('', 'http://localhost/a/consensys-asko11y-app');

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      mockReplaceState.mockClear();
      const longId = 'a'.repeat(150);

      act(() => {
        result.current.updateUrlWithSession(longId);
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockReplaceState).not.toHaveBeenCalled();
    });
  });

  describe('clearUrlSession', () => {
    it('should clear sessionId from URL and state', async () => {
      setWindowLocation(
        '?sessionId=session-123',
        'http://localhost/a/consensys-asko11y-app?sessionId=session-123'
      );
      mockGetSession.mockResolvedValue({ id: 'session-123', messages: [] });

      const { result } = renderHook(() => useSessionUrl());

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });

      expect(result.current.sessionIdFromUrl).toBe('session-123');

      act(() => {
        result.current.clearUrlSession();
      });

      expect(result.current.sessionIdFromUrl).toBeNull();
      expect(mockReplaceState).toHaveBeenCalled();
    });
  });
});
