import { SessionRepository } from '../repositories/ISessionRepository';
import { ChatSession, SessionMetadata } from '../models/ChatSession';
import { ChatMessage } from '../../components/Chat/types';
import { StorageError } from '../errors/StorageError';

export class SessionService {
  constructor(private readonly repository: SessionRepository) {}

  async getAllSessions(orgId: string): Promise<SessionMetadata[]> {
    return this.repository.findAll(orgId);
  }

  async getSession(orgId: string, sessionId: string): Promise<ChatSession | null> {
    return this.repository.findById(orgId, sessionId);
  }

  async getCurrentSession(orgId: string): Promise<ChatSession | null> {
    const currentId = await this.repository.getCurrentSessionId(orgId);
    if (!currentId) {
      return null;
    }
    return this.repository.findById(orgId, currentId);
  }

  async createSession(orgId: string, messages: ChatMessage[], title?: string): Promise<ChatSession> {
    const session = ChatSession.create(messages, title);
    await this.repository.save(orgId, session);
    return session;
  }

  async createSessionWithId(
    orgId: string,
    sessionId: string,
    messages: ChatMessage[],
    title?: string
  ): Promise<ChatSession> {
    const session = ChatSession.createWithId(sessionId, messages, title);
    await this.repository.save(orgId, session);
    return session;
  }

  async updateSession(
    orgId: string,
    sessionId: string,
    messages: ChatMessage[],
    summary?: string,
    titleOverride?: string
  ): Promise<void> {
    const session = await this.repository.findById(orgId, sessionId);

    if (!session) {
      // Pass titleOverride when creating new session with provided ID
      await this.createSessionWithId(orgId, sessionId, messages, titleOverride);
      return;
    }

    // Existing sessions keep their original title (immutable after creation)
    session.updateMessages(messages, summary);
    await this.repository.save(orgId, session);
  }

  async deleteSession(orgId: string, sessionId: string): Promise<void> {
    await this.repository.delete(orgId, sessionId);
  }

  async deleteAllSessions(orgId: string): Promise<void> {
    await this.repository.deleteAll(orgId);
  }

  async setActiveSession(orgId: string, sessionId: string): Promise<void> {
    const session = await this.repository.findById(orgId, sessionId);
    if (!session) {
      throw StorageError.notFound('Session', sessionId);
    }
    await this.repository.setCurrentSessionId(orgId, sessionId);
  }

  async clearActiveSession(orgId: string): Promise<void> {
    await this.repository.clearCurrentSessionId(orgId);
  }

  async getStorageStats(orgId: string): Promise<{ used: number; total: number; sessionCount: number }> {
    return this.repository.getStorageStats(orgId);
  }

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
