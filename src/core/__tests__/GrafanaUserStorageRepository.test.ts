import { GrafanaUserStorageRepository } from '../repositories/GrafanaUserStorageRepository';
import type { UserStorage } from '@grafana/data';

describe('GrafanaUserStorageRepository', () => {
  let repository: GrafanaUserStorageRepository;
  let mockStorage: jest.Mocked<UserStorage>;
  const testOrgId = `test-org-${Date.now()}`;

  beforeEach(() => {
    mockStorage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UserStorage>;
    repository = new GrafanaUserStorageRepository(mockStorage);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await repository.findAll(testOrgId);
      expect(sessions).toEqual([]);
    });
  });

  describe('constructor', () => {
    it('should throw error when storage is not provided', () => {
      expect(() => {
        new GrafanaUserStorageRepository(null as any);
      }).toThrow('Storage object is required');
    });
  });
});
