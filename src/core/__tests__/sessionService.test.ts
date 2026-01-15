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
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteAll: jest.fn().mockResolvedValue(undefined),
      getCurrentSessionId: jest.fn().mockResolvedValue(null),
      setCurrentSessionId: jest.fn().mockResolvedValue(undefined),
      clearCurrentSessionId: jest.fn().mockResolvedValue(undefined),
      getStorageStats: jest.fn().mockResolvedValue({ used: 0, total: 0, sessionCount: 0 }),
    };
    sessionService = new SessionService(mockRepository);
    jest.clearAllMocks();
  });

  describe('getAllSessions', () => {
    it('should return all sessions from repository', async () => {
      const mockSessions: SessionMetadata[] = [
        { id: 'session-1', title: 'Session 1', createdAt: new Date(), updatedAt: new Date(), messageCount: 0 },
        { id: 'session-2', title: 'Session 2', createdAt: new Date(), updatedAt: new Date(), messageCount: 0 },
      ];
      mockRepository.findAll.mockResolvedValue(mockSessions);

      const result = await sessionService.getAllSessions(testOrgId);

      expect(result).toEqual(mockSessions);
      expect(mockRepository.findAll).toHaveBeenCalledWith(testOrgId);
    });

    it('should return empty array when no sessions exist', async () => {
      mockRepository.findAll.mockResolvedValue([]);

      const result = await sessionService.getAllSessions(testOrgId);

      expect(result).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('should return session by id', async () => {
      const mockSession = {
        id: 'session-1',
        title: 'Test Session',
        messages: [],
      } as unknown as ChatSession;
      mockRepository.findById.mockResolvedValue(mockSession);

      const result = await sessionService.getSession(testOrgId, 'session-1');

      expect(result).toEqual(mockSession);
      expect(mockRepository.findById).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should return null when session not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await sessionService.getSession(testOrgId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getCurrentSession', () => {
    it('should return current active session', async () => {
      const mockSession = {
        id: 'session-1',
        title: 'Current Session',
        messages: [],
      } as unknown as ChatSession;
      mockRepository.getCurrentSessionId.mockResolvedValue('session-1');
      mockRepository.findById.mockResolvedValue(mockSession);

      const result = await sessionService.getCurrentSession(testOrgId);

      expect(result).toEqual(mockSession);
      expect(mockRepository.getCurrentSessionId).toHaveBeenCalledWith(testOrgId);
      expect(mockRepository.findById).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should return null when no current session id', async () => {
      mockRepository.getCurrentSessionId.mockResolvedValue(null);

      const result = await sessionService.getCurrentSession(testOrgId);

      expect(result).toBeNull();
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create and save a new session', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];

      const result = await sessionService.createSession(testOrgId, messages as any, 'Test Title');

      expect(result).toBeDefined();
      expect(result.id).toBe('mock-session-id');
      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalledWith(testOrgId, 'mock-session-id');
    });

    it('should use default title when not provided', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];

      const result = await sessionService.createSession(testOrgId, messages as any);

      expect(result.title).toBe('New Session');
    });
  });

  describe('updateSession', () => {
    it('should update existing session', async () => {
      const mockSession = {
        id: 'session-1',
        updateMessages: jest.fn(),
      };
      mockRepository.findById.mockResolvedValue(mockSession as any);

      const newMessages = [{ role: 'user', content: 'Updated' }];
      await sessionService.updateSession(testOrgId, 'session-1', newMessages as any, 'Summary');

      expect(mockSession.updateMessages).toHaveBeenCalledWith(newMessages, 'Summary');
      expect(mockRepository.save).toHaveBeenCalledWith(testOrgId, mockSession);
    });

    it('should create new session if not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const messages = [{ role: 'user', content: 'New message' }];
      await sessionService.updateSession(testOrgId, 'non-existent', messages as any);

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete session from repository', async () => {
      await sessionService.deleteSession(testOrgId, 'session-1');

      expect(mockRepository.delete).toHaveBeenCalledWith(testOrgId, 'session-1');
    });
  });

  describe('deleteAllSessions', () => {
    it('should delete all sessions from repository', async () => {
      await sessionService.deleteAllSessions(testOrgId);

      expect(mockRepository.deleteAll).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('setActiveSession', () => {
    it('should set active session id', async () => {
      mockRepository.findById.mockResolvedValue({ id: 'session-1' } as any);

      await sessionService.setActiveSession(testOrgId, 'session-1');

      expect(mockRepository.setCurrentSessionId).toHaveBeenCalledWith(testOrgId, 'session-1');
    });

    it('should throw when session not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(sessionService.setActiveSession(testOrgId, 'non-existent')).rejects.toThrow();
    });
  });

  describe('clearActiveSession', () => {
    it('should clear current session id', async () => {
      await sessionService.clearActiveSession(testOrgId);

      expect(mockRepository.clearCurrentSessionId).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('exportSession', () => {
    it('should export session as JSON', async () => {
      const mockSession = {
        id: 'session-1',
        title: 'Test',
        toStorage: jest.fn().mockReturnValue({
          id: 'session-1',
          title: 'Test',
          messages: [],
        }),
      };
      mockRepository.findById.mockResolvedValue(mockSession as any);

      const result = await sessionService.exportSession(testOrgId, 'session-1');

      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed.id).toBe('session-1');
    });

    it('should return null when session not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await sessionService.exportSession(testOrgId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('importSession', () => {
    it('should import session from JSON', async () => {
      const jsonData = JSON.stringify({
        id: 'imported-session',
        title: 'Imported',
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
      });

      const result = await sessionService.importSession(testOrgId, jsonData);

      expect(result).toBeDefined();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should throw on invalid JSON', async () => {
      await expect(sessionService.importSession(testOrgId, 'invalid json')).rejects.toThrow();
    });

    it('should throw on missing required fields', async () => {
      const jsonData = JSON.stringify({ title: 'Missing id and messages' });

      await expect(sessionService.importSession(testOrgId, jsonData)).rejects.toThrow();
    });

    it('should throw on invalid messages format', async () => {
      const jsonData = JSON.stringify({
        id: 'session-1',
        messages: 'not an array',
      });

      await expect(sessionService.importSession(testOrgId, jsonData)).rejects.toThrow();
    });
  });

  describe('getStorageStats', () => {
    it('should return storage stats from repository', async () => {
      const mockStats = { used: 1024, total: 5 * 1024 * 1024, sessionCount: 5 };
      mockRepository.getStorageStats.mockResolvedValue(mockStats);

      const result = await sessionService.getStorageStats(testOrgId);

      expect(result).toEqual(mockStats);
      expect(mockRepository.getStorageStats).toHaveBeenCalledWith(testOrgId);
    });
  });

  describe('autoSave', () => {
    it('should not save when messages are empty', async () => {
      await sessionService.autoSave(testOrgId, 'session-1', []);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should update existing session', async () => {
      const mockSession = {
        id: 'session-1',
        updateMessages: jest.fn(),
      };
      mockRepository.findById.mockResolvedValue(mockSession as any);

      const messages = [{ role: 'user', content: 'Auto saved' }];
      await sessionService.autoSave(testOrgId, 'session-1', messages as any);

      expect(mockSession.updateMessages).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should create new session when no session id', async () => {
      const messages = [{ role: 'user', content: 'New auto save' }];
      await sessionService.autoSave(testOrgId, null, messages as any);

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.setCurrentSessionId).toHaveBeenCalled();
    });
  });
});

