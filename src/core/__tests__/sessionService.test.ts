import { SessionService } from '../services/SessionService';
import { SessionRepository } from '../repositories/ISessionRepository';
import { ChatSession, SessionMetadata } from '../models/ChatSession';

// Mock the ChatSession class
jest.mock('../models/ChatSession', () => ({
  ChatSession: {
    create: jest.fn((messages, title) => ({
      id: 'mock-session-id',
      title: title || 'New Session',
      messages,
      createdAt: new Date(),
      updatedAt: new Date(),
      updateMessages: jest.fn(),
      toStorage: jest.fn(() => ({
        id: 'mock-session-id',
        title: title || 'New Session',
        messages,
      })),
    })),
  },
}));

describe('SessionService', () => {
  let sessionService: SessionService;
  let mockRepository: jest.Mocked<SessionRepository>;
  const testOrgId = 'org-123';

  beforeEach(() => {
    mockRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      deleteAll: jest.fn(),
      getCurrentSessionId: jest.fn(),
      setCurrentSessionId: jest.fn(),
      clearCurrentSessionId: jest.fn(),
      getStorageStats: jest.fn(),
    };
    sessionService = new SessionService(mockRepository);
    jest.clearAllMocks();
  });

  describe('getAllSessions', () => {
    it('should return all sessions from repository', () => {
      const mockSessions: SessionMetadata[] = [
        { id: 'session-1', title: 'Session 1', createdAt: new Date(), updatedAt: new Date(), messageCount: 0 },
        { id: 'session-2', title: 'Session 2', createdAt: new Date(), updatedAt: new Date(), messageCount: 0 },
      ];
      mockRepository.findAll.mockReturnValue(mockSessions);

      const result = sessionService.getAllSessions(testOrgId);

      expect(result).toEqual(mockSessions);
      expect(mockRepository.findAll).toHaveBeenCalledWith(testOrgId);
    });

    it('should return empty array when no sessions exist', () => {
      mockRepository.findAll.mockReturnValue([]);

      const result = sessionService.getAllSessions(testOrgId);

      expect(result).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('should return session by id', () => {
      const mockSession = {
        id: 'session-1',
        title: 'Test Session',
        messages: [],
      } as unknown as ChatSession;
      mockRepository.findById.mockReturnValue(mockSession);

      const result = sessionService.getSession(testOrgId, 'session-1');

      expect(result).toEqual(mockSession);
      expect(mockRepository.findById).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should return null when session not found', () => {
      mockRepository.findById.mockReturnValue(null);

      const result = sessionService.getSession(testOrgId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getCurrentSession', () => {
    it('should return current active session', () => {
      const mockSession = {
        id: 'session-1',
        title: 'Current Session',
        messages: [],
      } as unknown as ChatSession;
      mockRepository.getCurrentSessionId.mockReturnValue('session-1');
      mockRepository.findById.mockReturnValue(mockSession);

      const result = sessionService.getCurrentSession(testOrgId);

      expect(result).toEqual(mockSession);
      expect(mockRepository.getCurrentSessionId).toHaveBeenCalledWith(testOrgId);
      expect(mockRepository.findById).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should return null when no current session id', () => {
      mockRepository.getCurrentSessionId.mockReturnValue(null);

      const result = sessionService.getCurrentSession(testOrgId);

      expect(result).toBeNull();
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create and save a new session', () => {
      const messages = [{ role: 'user', content: 'Hello' }];

      const result = sessionService.createSession(testOrgId, messages as any, 'Test Title');

      expect(result).toBeDefined();
      expect(result.id).toBe('mock-session-id');
      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalledWith(testOrgId, 'mock-session-id');
    });

    it('should use default title when not provided', () => {
      const messages = [{ role: 'user', content: 'Hello' }];

      const result = sessionService.createSession(testOrgId, messages as any);

      expect(result.title).toBe('New Session');
    });
  });

  describe('updateSession', () => {
    it('should update existing session', () => {
      const mockSession = {
        id: 'session-1',
        updateMessages: jest.fn(),
      };
      mockRepository.findById.mockReturnValue(mockSession as any);

      const newMessages = [{ role: 'user', content: 'Updated' }];
      sessionService.updateSession(testOrgId, 'session-1', newMessages as any, 'Summary');

      expect(mockSession.updateMessages).toHaveBeenCalledWith(newMessages, 'Summary');
      expect(mockRepository.save).toHaveBeenCalledWith(testOrgId, mockSession);
    });

    it('should create new session if not found', () => {
      mockRepository.findById.mockReturnValue(null);

      const messages = [{ role: 'user', content: 'New message' }];
      sessionService.updateSession(testOrgId, 'non-existent', messages as any);

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete session from repository', () => {
      sessionService.deleteSession(testOrgId, 'session-1');

      expect(mockRepository.delete).toHaveBeenCalledWith(testOrgId, 'session-1');
    });
  });

  describe('deleteAllSessions', () => {
    it('should delete all sessions from repository', () => {
      sessionService.deleteAllSessions(testOrgId);

      expect(mockRepository.deleteAll).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('setActiveSession', () => {
    it('should set active session id', () => {
      mockRepository.findById.mockReturnValue({ id: 'session-1' } as any);

      sessionService.setActiveSession(testOrgId, 'session-1');

      expect(mockRepository.setCurrentSessionId).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should throw when session not found', () => {
      mockRepository.findById.mockReturnValue(null);

      expect(() => sessionService.setActiveSession(testOrgId, 'non-existent')).toThrow();
    });
  });

  describe('clearActiveSession', () => {
    it('should clear current session id', () => {
      sessionService.clearActiveSession(testOrgId);

      expect(mockRepository.clearCurrentSessionId).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('exportSession', () => {
    it('should export session as JSON', () => {
      const mockSession = {
        id: 'session-1',
        title: 'Test',
        toStorage: jest.fn().mockReturnValue({
          id: 'session-1',
          title: 'Test',
          messages: [],
        }),
      };
      mockRepository.findById.mockReturnValue(mockSession as any);

      const result = sessionService.exportSession(testOrgId, 'session-1');

      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed.id).toBe('session-1');
    });

    it('should return null when session not found', () => {
      mockRepository.findById.mockReturnValue(null);

      const result = sessionService.exportSession(testOrgId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('importSession', () => {
    it('should import session from JSON', () => {
      const jsonData = JSON.stringify({
        id: 'imported-session',
        title: 'Imported',
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
      });

      const result = sessionService.importSession(testOrgId, jsonData);

      expect(result).toBeDefined();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should throw on invalid JSON', () => {
      expect(() => sessionService.importSession(testOrgId, 'invalid json')).toThrow();
    });

    it('should throw on missing required fields', () => {
      const jsonData = JSON.stringify({ title: 'Missing id and messages' });

      expect(() => sessionService.importSession(testOrgId, jsonData)).toThrow();
    });

    it('should throw on invalid messages format', () => {
      const jsonData = JSON.stringify({
        id: 'session-1',
        messages: 'not an array',
      });

      expect(() => sessionService.importSession(testOrgId, jsonData)).toThrow();
    });
  });

  describe('getStorageStats', () => {
    it('should return storage stats from repository', () => {
      const mockStats = { used: 1024, total: 5 * 1024 * 1024, sessionCount: 5 };
      mockRepository.getStorageStats.mockReturnValue(mockStats);

      const result = sessionService.getStorageStats(testOrgId);

      expect(result).toEqual(mockStats);
      expect(mockRepository.getStorageStats).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('autoSave', () => {
    it('should not save when messages are empty', () => {
      sessionService.autoSave(testOrgId, 'session-1', []);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should update existing session', () => {
      const mockSession = {
        id: 'session-1',
        updateMessages: jest.fn(),
      };
      mockRepository.findById.mockReturnValue(mockSession as any);

      const messages = [{ role: 'user', content: 'Auto saved' }];
      sessionService.autoSave(testOrgId, 'session-1', messages as any);

      expect(mockSession.updateMessages).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should create new session when no session id', () => {
      const messages = [{ role: 'user', content: 'New auto save' }];
      sessionService.autoSave(testOrgId, null, messages as any);

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalled();
    });
  });
});

