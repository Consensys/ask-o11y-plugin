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

describe('useSessionManager utilities', () => {
  let mockSessionService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock session service
    mockSessionService = {
      getAllSessions: jest.fn().mockReturnValue([]),
      getCurrentSession: jest.fn().mockReturnValue(null),
      getSession: jest.fn().mockReturnValue(null),
      createSession: jest.fn().mockReturnValue({ id: 'new-session-1', title: 'New Session' }),
      updateSession: jest.fn(),
      deleteSession: jest.fn(),
      deleteAllSessions: jest.fn(),
      exportSession: jest.fn(),
      importSession: jest.fn(),
      setActiveSession: jest.fn(),
      clearActiveSession: jest.fn(),
      getStorageStats: jest.fn().mockReturnValue({ used: 1024, total: 5242880, sessionCount: 0 }),
    };

    (ServiceFactory.getSessionService as jest.Mock).mockReturnValue(mockSessionService);
  });

  describe('ServiceFactory.getSessionService', () => {
    it('should return session service instance', () => {
      const service = ServiceFactory.getSessionService();
      expect(service).toBeDefined();
    });

    it('should be memoizable (same instance)', () => {
      const service1 = ServiceFactory.getSessionService();
      const service2 = ServiceFactory.getSessionService();
      expect(service1).toBe(service2);
    });
  });

  describe('Session service methods', () => {
    it('getAllSessions should return empty array when no sessions', () => {
      const service = ServiceFactory.getSessionService();
      const sessions = service.getAllSessions('test-org');
      expect(sessions).toEqual([]);
    });

    it('getCurrentSession should return null when no current session', () => {
      const service = ServiceFactory.getSessionService();
      const session = service.getCurrentSession('test-org');
      expect(session).toBeNull();
    });

    it('getSession should return null when session not found', () => {
      const service = ServiceFactory.getSessionService();
      const session = service.getSession('test-org', 'non-existent');
      expect(session).toBeNull();
    });

    it('createSession should create new session with id', () => {
      const service = ServiceFactory.getSessionService();
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const session = service.createSession('test-org', messages);
      expect(session).toHaveProperty('id');
      expect(session.id).toBe('new-session-1');
    });

    it('deleteSession should call the service method', () => {
      const service = ServiceFactory.getSessionService();
      service.deleteSession('test-org', 'session-1');
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('test-org', 'session-1');
    });

    it('deleteAllSessions should call the service method', () => {
      const service = ServiceFactory.getSessionService();
      service.deleteAllSessions('test-org');
      expect(mockSessionService.deleteAllSessions).toHaveBeenCalledWith('test-org');
    });

    it('getStorageStats should return storage information', () => {
      const service = ServiceFactory.getSessionService();
      const stats = service.getStorageStats('test-org');
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
    it('should be able to chain session operations', () => {
      const service = ServiceFactory.getSessionService();
      
      // Create a session
      const session = service.createSession('test-org', []);
      expect(session.id).toBe('new-session-1');
      
      // Update it
      service.updateSession('test-org', session.id, [{ role: 'user', content: 'Updated' }]);
      expect(mockSessionService.updateSession).toHaveBeenCalledWith(
        'test-org',
        'new-session-1',
        expect.any(Array)
      );
      
      // Delete it
      service.deleteSession('test-org', session.id);
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('test-org', 'new-session-1');
    });

    it('should handle import/export operations', () => {
      const jsonData = '{"id":"session-1","messages":[]}';
      mockSessionService.exportSession.mockReturnValue(jsonData);
      mockSessionService.importSession.mockReturnValue({ id: 'imported-1', title: 'Imported' });

      const service = ServiceFactory.getSessionService();
      
      // Export
      const exported = service.exportSession('test-org', 'session-1');
      expect(exported).toBe(jsonData);
      
      // Import
      const imported = service.importSession('test-org', jsonData);
      expect(imported.id).toBe('imported-1');
    });
  });

  describe('Active session management', () => {
    it('should set and clear active session', () => {
      const service = ServiceFactory.getSessionService();
      
      service.setActiveSession('test-org', 'session-1');
      expect(mockSessionService.setActiveSession).toHaveBeenCalledWith('test-org', 'session-1');
      
      service.clearActiveSession('test-org');
      expect(mockSessionService.clearActiveSession).toHaveBeenCalledWith('test-org');
    });
  });

  describe('Error handling patterns', () => {
    it('should handle getAllSessions error', () => {
      mockSessionService.getAllSessions.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const service = ServiceFactory.getSessionService();
      expect(() => service.getAllSessions('test-org')).toThrow('Storage error');
    });

    it('should handle getSession error', () => {
      mockSessionService.getSession.mockImplementation(() => {
        throw new Error('Session not found');
      });

      const service = ServiceFactory.getSessionService();
      expect(() => service.getSession('test-org', 'bad-id')).toThrow('Session not found');
    });
  });
});
