import { StorageError, StorageErrorCode } from '../StorageError';

describe('StorageError', () => {
  describe('constructor', () => {
    it('should create an error with message and code', () => {
      const error = new StorageError('Test error', StorageErrorCode.UNKNOWN);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(StorageErrorCode.UNKNOWN);
      expect(error.name).toBe('StorageError');
    });

    it('should create an error with cause', () => {
      const cause = new Error('Original error');
      const error = new StorageError('Wrapped error', StorageErrorCode.UNKNOWN, cause);
      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(cause);
    });

    it('should be an instance of Error', () => {
      const error = new StorageError('Test error', StorageErrorCode.UNKNOWN);
      expect(error).toBeInstanceOf(Error);
    });

    it('should be an instance of StorageError', () => {
      const error = new StorageError('Test error', StorageErrorCode.UNKNOWN);
      expect(error).toBeInstanceOf(StorageError);
    });
  });

  describe('quotaExceeded', () => {
    it('should create a quota exceeded error', () => {
      const error = StorageError.quotaExceeded();
      expect(error.code).toBe(StorageErrorCode.QUOTA_EXCEEDED);
      expect(error.message).toContain('Storage quota exceeded');
    });

    it('should include cause when provided', () => {
      const cause = new Error('DOMException: QuotaExceededError');
      const error = StorageError.quotaExceeded(cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('notFound', () => {
    it('should create a not found error', () => {
      const error = StorageError.notFound('Session', 'session-123');
      expect(error.code).toBe(StorageErrorCode.NOT_FOUND);
      expect(error.message).toBe('Session with ID "session-123" not found');
    });

    it('should work with different item types', () => {
      const error = StorageError.notFound('Config', 'config-456');
      expect(error.message).toBe('Config with ID "config-456" not found');
    });
  });

  describe('invalidData', () => {
    it('should create an invalid data error', () => {
      const error = StorageError.invalidData('Corrupted JSON');
      expect(error.code).toBe(StorageErrorCode.INVALID_DATA);
      expect(error.message).toBe('Invalid data: Corrupted JSON');
    });

    it('should include cause when provided', () => {
      const cause = new SyntaxError('Unexpected token');
      const error = StorageError.invalidData('Failed to parse', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('unavailable', () => {
    it('should create an unavailable error', () => {
      const error = StorageError.unavailable();
      expect(error.code).toBe(StorageErrorCode.UNAVAILABLE);
      expect(error.message).toBe('Storage is not available');
    });

    it('should include cause when provided', () => {
      const cause = new Error('localStorage is disabled');
      const error = StorageError.unavailable(cause);
      expect(error.cause).toBe(cause);
    });
  });
});

describe('StorageErrorCode', () => {
  it('should have QUOTA_EXCEEDED code', () => {
    expect(StorageErrorCode.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
  });

  it('should have NOT_FOUND code', () => {
    expect(StorageErrorCode.NOT_FOUND).toBe('NOT_FOUND');
  });

  it('should have INVALID_DATA code', () => {
    expect(StorageErrorCode.INVALID_DATA).toBe('INVALID_DATA');
  });

  it('should have UNAVAILABLE code', () => {
    expect(StorageErrorCode.UNAVAILABLE).toBe('UNAVAILABLE');
  });

  it('should have UNKNOWN code', () => {
    expect(StorageErrorCode.UNKNOWN).toBe('UNKNOWN');
  });
});

