import { SessionRepository, StorageStats } from './ISessionRepository';
import { ChatSession, SessionMetadata } from '../models/ChatSession';
import { StorageError } from '../errors/StorageError';
import type { UserStorage } from '@grafana/data';

/**
 * Grafana User Storage implementation of Session Repository
 * Uses Grafana's UserStorage API for persistent per-user storage
 */
export class GrafanaUserStorageRepository implements SessionRepository {
  private readonly storageKeyPrefix = 'grafana-o11y-chat-';
  private readonly maxSessions = 50;

  constructor(private readonly storage: UserStorage) {
    if (!storage) {
      throw new Error('Storage object is required');
    }
  }

  async findAll(orgId: string): Promise<SessionMetadata[]> {
    try {
      const indexKey = this.getSessionsIndexKey(orgId);
      const indexData = await this.storage.getItem(indexKey);

      if (!indexData) {
        return [];
      }

      const sessions = JSON.parse(indexData);
      return sessions.map((meta: any) => ({
        ...meta,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt),
      }));
    } catch (error) {
      console.error('[GrafanaUserStorageRepository] Failed to load sessions index:', error);
      throw StorageError.invalidData('Failed to parse sessions index', error as Error);
    }
  }

  async findById(orgId: string, sessionId: string): Promise<ChatSession | null> {
    try {
      const sessionKey = this.getSessionKey(orgId, sessionId);
      const sessionData = await this.storage.getItem(sessionKey);

      if (!sessionData) {
        return null;
      }

      const data = JSON.parse(sessionData);
      return ChatSession.fromStorage(data);
    } catch (error) {
      console.error(`[GrafanaUserStorageRepository] Failed to load session ${sessionId}:`, error);
      throw StorageError.invalidData(`Failed to parse session ${sessionId}`, error as Error);
    }
  }

  async save(orgId: string, session: ChatSession): Promise<void> {
    try {
      // Update timestamp
      session.updatedAt = new Date();
      session.messageCount = session.messages.length;

      // Save session
      const sessionKey = this.getSessionKey(orgId, session.id);
      const sessionData = JSON.stringify(session.toStorage());
      await this.storage.setItem(sessionKey, sessionData);

      // Update index
      await this.updateSessionIndex(orgId, session);
    } catch (error) {
      console.error('[GrafanaUserStorageRepository] Failed to save session:', error);
      // Check if it's a quota error
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        await this.handleQuotaExceeded(orgId, session);
      } else {
        throw StorageError.unavailable(error as Error);
      }
    }
  }

  async delete(orgId: string, sessionId: string): Promise<void> {
    try {
      // Remove session data (use empty string since there's no removeItem)
      const sessionKey = this.getSessionKey(orgId, sessionId);
      await this.storage.setItem(sessionKey, '');

      // Update index
      const index = await this.findAll(orgId);
      const updatedIndex = index.filter((s) => s.id !== sessionId);
      await this.saveSessionsIndex(orgId, updatedIndex);

      // Clear current session if deleted
      const currentId = await this.getCurrentSessionId(orgId);
      if (currentId === sessionId) {
        await this.clearCurrentSessionId(orgId);
      }
    } catch (error) {
      console.error('[GrafanaUserStorageRepository] Failed to delete session:', error);
      throw StorageError.unavailable(error as Error);
    }
  }

  async deleteAll(orgId: string): Promise<void> {
    try {
      const sessions = await this.findAll(orgId);

      // Remove all session data
      for (const session of sessions) {
        const sessionKey = this.getSessionKey(orgId, session.id);
        await this.storage.setItem(sessionKey, '');
      }

      // Remove index
      const indexKey = this.getSessionsIndexKey(orgId);
      await this.storage.setItem(indexKey, '');

      // Clear current session
      await this.clearCurrentSessionId(orgId);
    } catch (error) {
      console.error('[GrafanaUserStorageRepository] Failed to delete all sessions:', error);
      throw StorageError.unavailable(error as Error);
    }
  }

  async getCurrentSessionId(orgId: string): Promise<string | null> {
    const key = this.getCurrentSessionKey(orgId);
    const value = await this.storage.getItem(key);
    return value || null;
  }

  async setCurrentSessionId(orgId: string, sessionId: string): Promise<void> {
    const key = this.getCurrentSessionKey(orgId);
    await this.storage.setItem(key, sessionId);
  }

  async clearCurrentSessionId(orgId: string): Promise<void> {
    const key = this.getCurrentSessionKey(orgId);
    await this.storage.setItem(key, '');
  }

  async getStorageStats(orgId: string): Promise<StorageStats> {
    const sessions = await this.findAll(orgId);
    
    // Estimate storage usage based on session count
    // Since we can't directly query storage size, we estimate based on average session size
    const avgSessionSize = 5000; // Estimate: ~5KB per session
    const estimatedUsed = sessions.length * avgSessionSize;
    
    // Use a reasonable total limit (Grafana manages actual quota)
    const estimatedTotal = 10 * 1024 * 1024; // 10MB estimate

    return {
      used: estimatedUsed,
      total: estimatedTotal,
      sessionCount: sessions.length,
    };
  }

  // Private helper methods

  private async updateSessionIndex(orgId: string, session: ChatSession): Promise<void> {
    const index = await this.findAll(orgId);
    const existingIndex = index.findIndex((s) => s.id === session.id);

    if (existingIndex >= 0) {
      index[existingIndex] = session.getMetadata();
    } else {
      index.push(session.getMetadata());
    }

    await this.saveSessionsIndex(orgId, index);
  }

  private async saveSessionsIndex(orgId: string, sessions: SessionMetadata[]): Promise<void> {
    // Sort by most recent first
    const sorted = [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Limit to max sessions
    const limited = sorted.slice(0, this.maxSessions);

    // Save index
    const indexKey = this.getSessionsIndexKey(orgId);
    const indexData = JSON.stringify(limited);
    await this.storage.setItem(indexKey, indexData);

    // Clean up overflow
    if (sorted.length > this.maxSessions) {
      const toDelete = sorted.slice(this.maxSessions);
      for (const session of toDelete) {
        const sessionKey = this.getSessionKey(orgId, session.id);
        await this.storage.setItem(sessionKey, '');
      }
    }
  }

  private async handleQuotaExceeded(orgId: string, session: ChatSession): Promise<void> {
    // Delete 10 oldest sessions
    const sessions = await this.findAll(orgId);
    const sortedByOldest = sessions.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

    const toDelete = sortedByOldest.slice(0, 10);
    for (const s of toDelete) {
      await this.delete(orgId, s.id);
    }

    // Retry save
    try {
      const sessionKey = this.getSessionKey(orgId, session.id);
      await this.storage.setItem(sessionKey, JSON.stringify(session.toStorage()));
      await this.updateSessionIndex(orgId, session);
    } catch (retryError) {
      throw StorageError.quotaExceeded(retryError as Error);
    }
  }

  // Key generation methods

  private getSessionsIndexKey(orgId: string): string {
    return `${this.storageKeyPrefix}org-${orgId}-sessions-index`;
  }

  private getCurrentSessionKey(orgId: string): string {
    return `${this.storageKeyPrefix}org-${orgId}-current-session`;
  }

  private getSessionKey(orgId: string, sessionId: string): string {
    return `${this.storageKeyPrefix}org-${orgId}-${sessionId}`;
  }
}
