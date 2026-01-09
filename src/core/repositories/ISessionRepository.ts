import { ChatSession, SessionMetadata } from '../models/ChatSession';

/**
 * Repository interface for session persistence
 * Following Repository pattern for clean separation of data access logic
 */
export interface SessionRepository {
  /**
   * Get all session metadata for an organization
   */
  findAll(orgId: string): SessionMetadata[];

  /**
   * Find a session by ID
   */
  findById(orgId: string, sessionId: string): ChatSession | null;

  /**
   * Save or update a session
   */
  save(orgId: string, session: ChatSession): void;

  /**
   * Delete a session
   */
  delete(orgId: string, sessionId: string): void;

  /**
   * Delete all sessions for an organization
   */
  deleteAll(orgId: string): void;

  /**
   * Get current active session ID
   */
  getCurrentSessionId(orgId: string): string | null;

  /**
   * Set current active session ID
   */
  setCurrentSessionId(orgId: string, sessionId: string): void;

  /**
   * Clear current session ID
   */
  clearCurrentSessionId(orgId: string): void;

  /**
   * Get storage statistics
   */
  getStorageStats(orgId: string): StorageStats;
}

export interface StorageStats {
  used: number;
  total: number;
  sessionCount: number;
}
