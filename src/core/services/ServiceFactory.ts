import { SessionService } from './SessionService';
import { GrafanaUserStorageRepository } from '../repositories/GrafanaUserStorageRepository';
import type { UserStorage } from '@grafana/data';

/**
 * Service Factory - Simple dependency injection container
 * Creates and manages service instances with their dependencies
 */
export class ServiceFactory {
  /**
   * Create a new SessionService instance with the provided storage
   * Note: We create a new instance each time since storage can change
   * (e.g., when user signs in/out, the storage object reference changes)
   * @param storage - UserStorage object from usePluginUserStorage() hook
   */
  static getSessionService(storage: UserStorage): SessionService {
    const repository = new GrafanaUserStorageRepository(storage);
    return new SessionService(repository);
  }

  /**
   * Reset all services (useful for testing)
   * Note: This is a no-op now since we don't use singletons
   */
  static reset(): void {
    // No-op: services are created fresh each time
  }
}
