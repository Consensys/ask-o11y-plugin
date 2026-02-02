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
  async getAllSessions(orgId: string): Promise<SessionMetadata[]> {
    return this.repository.findAll(orgId);
  }

  /**
   * Get a session by ID
   */
  async getSession(orgId: string, sessionId: string): Promise<ChatSession | null> {
    return this.repository.findById(orgId, sessionId);
  }

  /**
   * Get current active session
   */
  async getCurrentSession(orgId: string): Promise<ChatSession | null> {
    const currentId = await this.repository.getCurrentSessionId(orgId);
    if (!currentId) {
      return null;
    }
    return this.repository.findById(orgId, currentId);
  }

  /**
   * Create a new session
   */
  async createSession(orgId: string, messages: ChatMessage[], title?: string): Promise<ChatSession> {
    const session = ChatSession.create(messages, title);
    await this.repository.save(orgId, session);
    await this.repository.setCurrentSessionId(orgId, session.id);
    return session;
  }

  /**
   * Update an existing session
   */
  async updateSession(orgId: string, sessionId: string, messages: ChatMessage[], summary?: string): Promise<void> {
    const session = await this.repository.findById(orgId, sessionId);

    if (!session) {
      // Session not found, create new one
      await this.createSession(orgId, messages);
      return;
    }

    session.updateMessages(messages, summary);
    await this.repository.save(orgId, session);
  }

  /**
   * Delete a session
   */
  async deleteSession(orgId: string, sessionId: string): Promise<void> {
    await this.repository.delete(orgId, sessionId);
  }

  /**
   * Delete all sessions for an organization
   */
  async deleteAllSessions(orgId: string): Promise<void> {
    await this.repository.deleteAll(orgId);
  }

  /**
   * Set active session
   */
  async setActiveSession(orgId: string, sessionId: string): Promise<void> {
    const session = await this.repository.findById(orgId, sessionId);
    if (!session) {
      throw StorageError.notFound('Session', sessionId);
    }
    await this.repository.setCurrentSessionId(orgId, sessionId);
  }

  /**
   * Clear active session
   */
  async clearActiveSession(orgId: string): Promise<void> {
    await this.repository.clearCurrentSessionId(orgId);
  }


  /**
   * Get storage statistics
   */
  async getStorageStats(orgId: string) {
    return this.repository.getStorageStats(orgId);
  }

  /**
   * Auto-save session (debounced externally)
   */
  async autoSave(orgId: string, sessionId: string | null, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    if (sessionId) {
      await this.updateSession(orgId, sessionId, messages);
    } else {
      await this.createSession(orgId, messages);
    }
  }
}
