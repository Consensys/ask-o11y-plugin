import { SessionService } from './SessionService';
import { LocalStorageSessionRepository } from '../repositories/LocalStorageSessionRepository';

/**
 * Service Factory - Simple dependency injection container
 * Creates and manages service instances with their dependencies
 */
export class ServiceFactory {
  private static sessionService: SessionService | null = null;

  /**
   * Get or create SessionService instance (Singleton)
   */
  static getSessionService(): SessionService {
    if (!this.sessionService) {
      const repository = new LocalStorageSessionRepository();
      this.sessionService = new SessionService(repository);
    }
    return this.sessionService;
  }

  /**
   * Reset all services (useful for testing)
   */
  static reset(): void {
    this.sessionService = null;
  }
}
