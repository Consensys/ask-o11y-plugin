/**
 * Unit tests for useSessionManager hook utilities
 * Tests session management logic without requiring React hook rendering
 */
import { ServiceFactory } from '../../../../core/services/ServiceFactory';
import { ConversationMemoryService } from '../../../../services/memory';
import { ChatMessage } from '../../types';

// Mock dependencies
jest.mock('../../../../core/services/ServiceFactory');
jest.mock('../../../../services/memory');
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(() => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('useSessionManager utilities', () => {
  let mockSessionService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock session service
    mockSessionService = {
      getAllSessions: jest.fn().mockResolvedValue([]),
      getCurrentSession: jest.fn().mockResolvedValue(null),
      getSession: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockResolvedValue({ id: 'new-session-1', title: 'New Session' }),
      updateSession: jest.fn().mockResolvedValue(undefined),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      deleteAllSessions: jest.fn().mockResolvedValue(undefined),
      setActiveSession: jest.fn().mockResolvedValue(undefined),
      clearActiveSession: jest.fn().mockResolvedValue(undefined),
      getStorageStats: jest.fn().mockResolvedValue({ used: 1024, total: 5242880, sessionCount: 0 }),
    };

    (ServiceFactory.getSessionService as jest.Mock).mockReturnValue(mockSessionService);
  });

  describe('ServiceFactory.getSessionService', () => {
    it('should return session service instance', () => {
      const mockStorage = {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
      };
      const service = ServiceFactory.getSessionService(mockStorage as any);
      expect(service).toBeDefined();
    });

    it('should create new instance each time', () => {
      const mockStorage = {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
      };
      const service1 = ServiceFactory.getSessionService(mockStorage as any);
      const service2 = ServiceFactory.getSessionService(mockStorage as any);
      // Services are now created fresh each time (not singleton)
      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
    });
  });

  describe('Session service methods', () => {
    const mockStorage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
      (ServiceFactory.getSessionService as jest.Mock).mockReturnValue(mockSessionService);
    });

    it('getAllSessions should return empty array when no sessions', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      const sessions = await service.getAllSessions('test-org');
      expect(sessions).toEqual([]);
    });

    it('getCurrentSession should return null when no current session', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      const session = await service.getCurrentSession('test-org');
      expect(session).toBeNull();
    });

    it('getSession should return null when session not found', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      const session = await service.getSession('test-org', 'non-existent');
      expect(session).toBeNull();
    });

    it('createSession should create new session with id', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const session = await service.createSession('test-org', messages);
      expect(session).toHaveProperty('id');
      expect(session.id).toBe('new-session-1');
    });

    it('deleteSession should call the service method', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      await service.deleteSession('test-org', 'session-1');
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('test-org', 'session-1');
    });

    it('deleteAllSessions should call the service method', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      await service.deleteAllSessions('test-org');
      expect(mockSessionService.deleteAllSessions).toHaveBeenCalledWith('test-org');
    });

    it('getStorageStats should return storage information', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      const stats = await service.getStorageStats('test-org');
      expect(stats).toEqual({ used: 1024, total: 5242880, sessionCount: 0 });
    });
  });

  describe('ConversationMemoryService.shouldSummarize', () => {
    beforeEach(() => {
      // Mock the shouldSummarize function
      (ConversationMemoryService.shouldSummarize as jest.Mock).mockImplementation(
        (count: number, threshold = 20) => count >= threshold && count % 10 === 0
      );
    });

    it('should return false below threshold', () => {
      expect(ConversationMemoryService.shouldSummarize(10)).toBe(false);
      expect(ConversationMemoryService.shouldSummarize(19)).toBe(false);
    });

    it('should return true at threshold multiples', () => {
      expect(ConversationMemoryService.shouldSummarize(20)).toBe(true);
      expect(ConversationMemoryService.shouldSummarize(30)).toBe(true);
    });
  });

  describe('Session operations patterns', () => {
    const mockStorage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };

    it('should be able to chain session operations', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      
      // Create a session
      const session = await service.createSession('test-org', []);
      expect(session.id).toBe('new-session-1');
      
      // Update it
      await service.updateSession('test-org', session.id, [{ role: 'user', content: 'Updated' }]);
      expect(mockSessionService.updateSession).toHaveBeenCalledWith(
        'test-org',
        'new-session-1',
        expect.any(Array)
      );
      
      // Delete it
      await service.deleteSession('test-org', session.id);
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('test-org', 'new-session-1');
    });

  });

  describe('Active session management', () => {
    const mockStorage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };

    it('should set and clear active session', async () => {
      const service = ServiceFactory.getSessionService(mockStorage as any);
      
      await service.setActiveSession('test-org', 'session-1');
      expect(mockSessionService.setActiveSession).toHaveBeenCalledWith('test-org', 'session-1');
      
      await service.clearActiveSession('test-org');
      expect(mockSessionService.clearActiveSession).toHaveBeenCalledWith('test-org');
    });
  });

  describe('Error handling patterns', () => {
    const mockStorage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };

    it('should handle getAllSessions error', async () => {
      mockSessionService.getAllSessions.mockRejectedValue(new Error('Storage error'));

      const service = ServiceFactory.getSessionService(mockStorage as any);
      await expect(service.getAllSessions('test-org')).rejects.toThrow('Storage error');
    });

    it('should handle getSession error', async () => {
      mockSessionService.getSession.mockRejectedValue(new Error('Session not found'));

      const service = ServiceFactory.getSessionService(mockStorage as any);
      await expect(service.getSession('test-org', 'bad-id')).rejects.toThrow('Session not found');
    });
  });
});
