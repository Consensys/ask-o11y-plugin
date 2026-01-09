import { SessionRepository } from '../repositories/ISessionRepository';
import { ChatSession, SessionMetadata } from '../models/ChatSession';
import { ChatMessage } from '../../components/Chat/types';
import { StorageError } from '../errors/StorageError';

/**
 * Session Service - Business logic layer for session management
 * Coordinates between repository and application layer
 */
export class SessionService {
  constructor(private readonly repository: SessionRepository) {}

  /**
   * Get all sessions for an organization
   */
  getAllSessions(orgId: string): SessionMetadata[] {
    return this.repository.findAll(orgId);
  }

  /**
   * Get a session by ID
   */
  getSession(orgId: string, sessionId: string): ChatSession | null {
    return this.repository.findById(orgId, sessionId);
  }

  /**
   * Get current active session
   */
  getCurrentSession(orgId: string): ChatSession | null {
    const currentId = this.repository.getCurrentSessionId(orgId);
    if (!currentId) {
      return null;
    }
    return this.repository.findById(orgId, currentId);
  }

  /**
   * Create a new session
   */
  createSession(orgId: string, messages: ChatMessage[], title?: string): ChatSession {
    const session = ChatSession.create(messages, title);
    this.repository.save(orgId, session);
    this.repository.setCurrentSessionId(orgId, session.id);
    return session;
  }

  /**
   * Update an existing session
   */
  updateSession(orgId: string, sessionId: string, messages: ChatMessage[], summary?: string): void {
    const session = this.repository.findById(orgId, sessionId);

    if (!session) {
      // Session not found, create new one
      console.warn(`[SessionService] Session ${sessionId} not found, creating new session`);
      this.createSession(orgId, messages);
      return;
    }

    session.updateMessages(messages, summary);
    this.repository.save(orgId, session);
  }

  /**
   * Delete a session
   */
  deleteSession(orgId: string, sessionId: string): void {
    this.repository.delete(orgId, sessionId);
  }

  /**
   * Delete all sessions for an organization
   */
  deleteAllSessions(orgId: string): void {
    this.repository.deleteAll(orgId);
  }

  /**
   * Set active session
   */
  setActiveSession(orgId: string, sessionId: string): void {
    const session = this.repository.findById(orgId, sessionId);
    if (!session) {
      throw StorageError.notFound('Session', sessionId);
    }
    this.repository.setCurrentSessionId(orgId, sessionId);
  }

  /**
   * Clear active session
   */
  clearActiveSession(orgId: string): void {
    this.repository.clearCurrentSessionId(orgId);
  }

  /**
   * Export session as JSON
   */
  exportSession(orgId: string, sessionId: string): string | null {
    const session = this.repository.findById(orgId, sessionId);
    if (!session) {
      return null;
    }
    return JSON.stringify(session.toStorage(), null, 2);
  }

  /**
   * Import session from JSON
   */
  importSession(orgId: string, jsonData: string): ChatSession {
    try {
      const data = JSON.parse(jsonData);

      // Validate structure
      if (!data.id || !data.messages || !Array.isArray(data.messages)) {
        throw new Error('Invalid session format: missing required fields');
      }

      // Create new session with imported data
      const messages = data.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));

      const session = ChatSession.create(messages, data.title);
      this.repository.save(orgId, session);

      return session;
    } catch (error) {
      throw StorageError.invalidData('Failed to import session', error as Error);
    }
  }

  /**
   * Get storage statistics
   */
  getStorageStats(orgId: string) {
    return this.repository.getStorageStats(orgId);
  }

  /**
   * Auto-save session (debounced externally)
   */
  autoSave(orgId: string, sessionId: string | null, messages: ChatMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    if (sessionId) {
      this.updateSession(orgId, sessionId, messages);
    } else {
      this.createSession(orgId, messages);
    }
  }
}
