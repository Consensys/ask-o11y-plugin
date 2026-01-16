import { ChatSession, SessionMetadata } from '../models/ChatSession';

/**
 * Repository interface for session persistence
 * Following Repository pattern for clean separation of data access logic
 * All methods are async to support both localStorage and Grafana user storage APIs
 */
export interface SessionRepository {
  /**
   * Get all session metadata for an organization
   */
  findAll(orgId: string): Promise<SessionMetadata[]>;

  /**
   * Find a session by ID
   */
  findById(orgId: string, sessionId: string): Promise<ChatSession | null>;

  /**
   * Save or update a session
   */
  save(orgId: string, session: ChatSession): Promise<void>;

  /**
   * Delete a session
   */
  delete(orgId: string, sessionId: string): Promise<void>;

  /**
   * Delete all sessions for an organization
   */
  deleteAll(orgId: string): Promise<void>;

  /**
   * Get current active session ID
   */
  getCurrentSessionId(orgId: string): Promise<string | null>;

  /**
   * Set current active session ID
   */
  setCurrentSessionId(orgId: string, sessionId: string): Promise<void>;

  /**
   * Clear current session ID
   */
  clearCurrentSessionId(orgId: string): Promise<void>;

  /**
   * Get storage statistics
   */
  getStorageStats(orgId: string): Promise<StorageStats>;
}

export interface StorageStats {
  used: number;
  total: number;
  sessionCount: number;
}
