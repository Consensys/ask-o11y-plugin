import { SessionRepository, StorageStats } from './ISessionRepository';
import { ChatSession, SessionMetadata } from '../models/ChatSession';
import { StorageError } from '../errors/StorageError';

/**
 * LocalStorage implementation of Session Repository
 * Encapsulates all localStorage operations with proper error handling
 */
export class LocalStorageSessionRepository implements SessionRepository {
  private readonly storageKeyPrefix = 'grafana-o11y-chat-';
  private readonly maxSessions = 50;

  constructor() {
    this.validateStorageAvailability();
  }

  findAll(orgId: string): SessionMetadata[] {
    try {
      const indexKey = this.getSessionsIndexKey(orgId);
      const indexData = localStorage.getItem(indexKey);

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
      console.error('[SessionRepository] Failed to load sessions index:', error);
      throw StorageError.invalidData('Failed to parse sessions index', error as Error);
    }
  }

  findById(orgId: string, sessionId: string): ChatSession | null {
    try {
      const sessionKey = this.getSessionKey(orgId, sessionId);
      const sessionData = localStorage.getItem(sessionKey);

      if (!sessionData) {
        return null;
      }

      const data = JSON.parse(sessionData);
      return ChatSession.fromStorage(data);
    } catch (error) {
      console.error(`[SessionRepository] Failed to load session ${sessionId}:`, error);
      throw StorageError.invalidData(`Failed to parse session ${sessionId}`, error as Error);
    }
  }

  save(orgId: string, session: ChatSession): void {
    try {
      // Update timestamp
      session.updatedAt = new Date();
      session.messageCount = session.messages.length;

      // Save session
      const sessionKey = this.getSessionKey(orgId, session.id);
      localStorage.setItem(sessionKey, JSON.stringify(session.toStorage()));

      // Update index
      this.updateSessionIndex(orgId, session);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.handleQuotaExceeded(orgId, session);
      } else {
        throw StorageError.unavailable(error as Error);
      }
    }
  }

  delete(orgId: string, sessionId: string): void {
    try {
      // Remove session data
      const sessionKey = this.getSessionKey(orgId, sessionId);
      localStorage.removeItem(sessionKey);

      // Update index
      const index = this.findAll(orgId);
      const updatedIndex = index.filter((s) => s.id !== sessionId);
      this.saveSessionsIndex(orgId, updatedIndex);

      // Clear current session if deleted
      const currentId = this.getCurrentSessionId(orgId);
      if (currentId === sessionId) {
        this.clearCurrentSessionId(orgId);
      }
    } catch (error) {
      console.error('[SessionRepository] Failed to delete session:', error);
      throw StorageError.unavailable(error as Error);
    }
  }

  deleteAll(orgId: string): void {
    try {
      const sessions = this.findAll(orgId);

      // Remove all session data
      sessions.forEach((session) => {
        const sessionKey = this.getSessionKey(orgId, session.id);
        localStorage.removeItem(sessionKey);
      });

      // Remove index
      const indexKey = this.getSessionsIndexKey(orgId);
      localStorage.removeItem(indexKey);

      // Clear current session
      this.clearCurrentSessionId(orgId);
    } catch (error) {
      console.error('[SessionRepository] Failed to delete all sessions:', error);
      throw StorageError.unavailable(error as Error);
    }
  }

  getCurrentSessionId(orgId: string): string | null {
    return localStorage.getItem(this.getCurrentSessionKey(orgId));
  }

  setCurrentSessionId(orgId: string, sessionId: string): void {
    localStorage.setItem(this.getCurrentSessionKey(orgId), sessionId);
  }

  clearCurrentSessionId(orgId: string): void {
    localStorage.removeItem(this.getCurrentSessionKey(orgId));
  }

  getStorageStats(orgId: string): StorageStats {
    const sessions = this.findAll(orgId);
    let used = 0;

    const orgPrefix = `${this.storageKeyPrefix}org-${orgId}-`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(orgPrefix)) {
        const value = localStorage.getItem(key);
        if (value) {
          used += key.length + value.length;
        }
      }
    }

    return {
      used,
      total: 5 * 1024 * 1024, // 5MB
      sessionCount: sessions.length,
    };
  }

  // Private helper methods

  private updateSessionIndex(orgId: string, session: ChatSession): void {
    const index = this.findAll(orgId);
    const existingIndex = index.findIndex((s) => s.id === session.id);

    if (existingIndex >= 0) {
      index[existingIndex] = session.getMetadata();
    } else {
      index.push(session.getMetadata());
    }

    this.saveSessionsIndex(orgId, index);
  }

  private saveSessionsIndex(orgId: string, sessions: SessionMetadata[]): void {
    // Sort by most recent first
    const sorted = [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Limit to max sessions
    const limited = sorted.slice(0, this.maxSessions);

    // Save index
    const indexKey = this.getSessionsIndexKey(orgId);
    localStorage.setItem(indexKey, JSON.stringify(limited));

    // Clean up overflow
    if (sorted.length > this.maxSessions) {
      sorted.slice(this.maxSessions).forEach((session) => {
        const sessionKey = this.getSessionKey(orgId, session.id);
        localStorage.removeItem(sessionKey);
      });
    }
  }

  private handleQuotaExceeded(orgId: string, session: ChatSession): void {
    console.warn('[SessionRepository] Storage quota exceeded, cleaning up old sessions');

    // Delete 10 oldest sessions
    const sessions = this.findAll(orgId);
    const sortedByOldest = sessions.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

    const toDelete = sortedByOldest.slice(0, 10);
    toDelete.forEach((s) => this.delete(orgId, s.id));

    // Retry save
    try {
      const sessionKey = this.getSessionKey(orgId, session.id);
      localStorage.setItem(sessionKey, JSON.stringify(session.toStorage()));
      this.updateSessionIndex(orgId, session);
    } catch (retryError) {
      throw StorageError.quotaExceeded(retryError as Error);
    }
  }

  private validateStorageAvailability(): void {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
    } catch (error) {
      throw StorageError.unavailable(error as Error);
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
