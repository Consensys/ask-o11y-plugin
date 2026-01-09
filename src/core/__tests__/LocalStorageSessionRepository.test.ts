import { LocalStorageSessionRepository } from '../repositories/LocalStorageSessionRepository';
import { ChatSession } from '../models/ChatSession';

describe('LocalStorageSessionRepository', () => {
  let repository: LocalStorageSessionRepository;
  const testOrgId = `test-org-${Date.now()}`;

  beforeEach(() => {
    // Use real localStorage with unique org id per test
    localStorage.clear();
    repository = new LocalStorageSessionRepository();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('findAll', () => {
    it('should return empty array when no sessions exist', () => {
      const sessions = repository.findAll(testOrgId);
      expect(sessions).toEqual([]);
    });

    it('should return all session metadata after save', () => {
      const session1 = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Session 1');
      const session2 = ChatSession.create([{ role: 'user', content: 'World' }], 'Session 2');
      
      repository.save(testOrgId, session1);
      repository.save(testOrgId, session2);

      const sessions = repository.findAll(testOrgId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].createdAt).toBeInstanceOf(Date);
      expect(sessions[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('findById', () => {
    it('should return null when session not found', () => {
      const session = repository.findById(testOrgId, 'non-existent');
      expect(session).toBeNull();
    });

    it('should return session when found', () => {
      const originalSession = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test Session');
      repository.save(testOrgId, originalSession);

      const session = repository.findById(testOrgId, originalSession.id);

      expect(session).not.toBeNull();
      expect(session!.id).toBe(originalSession.id);
      expect(session!.title).toBe('Test Session');
    });
  });

  describe('save', () => {
    it('should save session to localStorage', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test');

      repository.save(testOrgId, session);

      const retrieved = repository.findById(testOrgId, session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Test');
    });

    it('should update existing session', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test');
      repository.save(testOrgId, session);

      session.updateMessages([{ role: 'user', content: 'Updated' }]);
      repository.save(testOrgId, session);

      const retrieved = repository.findById(testOrgId, session.id);
      expect(retrieved!.messages[0].content).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should remove session from localStorage', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test');
      repository.save(testOrgId, session);

      repository.delete(testOrgId, session.id);

      expect(repository.findById(testOrgId, session.id)).toBeNull();
    });

    it('should update index when session deleted', () => {
      const session1 = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Session 1');
      const session2 = ChatSession.create([{ role: 'user', content: 'World' }], 'Session 2');
      repository.save(testOrgId, session1);
      repository.save(testOrgId, session2);

      repository.delete(testOrgId, session1.id);

      const sessions = repository.findAll(testOrgId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session2.id);
    });
  });

  describe('deleteAll', () => {
    it('should remove all sessions', () => {
      const session1 = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Session 1');
      const session2 = ChatSession.create([{ role: 'user', content: 'World' }], 'Session 2');
      repository.save(testOrgId, session1);
      repository.save(testOrgId, session2);

      repository.deleteAll(testOrgId);

      expect(repository.findAll(testOrgId)).toEqual([]);
    });
  });

  describe('getCurrentSessionId', () => {
    it('should return null when no current session', () => {
      const result = repository.getCurrentSessionId(testOrgId);
      expect(result).toBeNull();
    });

    it('should return current session id after set', () => {
      repository.setCurrentSessionId(testOrgId, 'session-123');

      const result = repository.getCurrentSessionId(testOrgId);

      expect(result).toBe('session-123');
    });
  });

  describe('setCurrentSessionId', () => {
    it('should set current session id', () => {
      repository.setCurrentSessionId(testOrgId, 'session-456');

      expect(repository.getCurrentSessionId(testOrgId)).toBe('session-456');
    });
  });

  describe('clearCurrentSessionId', () => {
    it('should remove current session id', () => {
      repository.setCurrentSessionId(testOrgId, 'session-789');
      repository.clearCurrentSessionId(testOrgId);

      expect(repository.getCurrentSessionId(testOrgId)).toBeNull();
    });
  });

  describe('getStorageStats', () => {
    it('should return storage statistics', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test');
      repository.save(testOrgId, session);

      const stats = repository.getStorageStats(testOrgId);

      expect(stats).toHaveProperty('used');
      expect(stats).toHaveProperty('total', 5 * 1024 * 1024);
      expect(stats).toHaveProperty('sessionCount', 1);
    });
  });

  describe('delete clears current session if matches', () => {
    it('should clear current session id when deleted session is current', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Test');
      repository.save(testOrgId, session);
      repository.setCurrentSessionId(testOrgId, session.id);

      repository.delete(testOrgId, session.id);

      expect(repository.getCurrentSessionId(testOrgId)).toBeNull();
    });

    it('should not clear current session id when different session deleted', () => {
      const session1 = ChatSession.create([{ role: 'user', content: 'Hello' }], 'Session 1');
      const session2 = ChatSession.create([{ role: 'user', content: 'World' }], 'Session 2');
      repository.save(testOrgId, session1);
      repository.save(testOrgId, session2);
      repository.setCurrentSessionId(testOrgId, session2.id);

      repository.delete(testOrgId, session1.id);

      expect(repository.getCurrentSessionId(testOrgId)).toBe(session2.id);
    });
  });

  describe('session limit and overflow', () => {
    it('should limit sessions to maxSessions', () => {
      // Create 55 sessions to exceed the limit of 50
      for (let i = 0; i < 55; i++) {
        const session = ChatSession.create([{ role: 'user', content: `Message ${i}` }], `Session ${i}`);
        repository.save(testOrgId, session);
      }

      const sessions = repository.findAll(testOrgId);
      expect(sessions.length).toBeLessThanOrEqual(50);
    });
  });
});

