/**
 * Custom error class for storage-related errors
 */
export class StorageError extends Error {
  constructor(message: string, public readonly code: StorageErrorCode, public readonly cause?: Error) {
    super(message);
    this.name = 'StorageError';
    Object.setPrototypeOf(this, StorageError.prototype);
  }

  static quotaExceeded(cause?: Error): StorageError {
    return new StorageError(
      'Storage quota exceeded. Please free up space or delete old sessions.',
      StorageErrorCode.QUOTA_EXCEEDED,
      cause
    );
  }

  static notFound(itemType: string, itemId: string): StorageError {
    return new StorageError(`${itemType} with ID "${itemId}" not found`, StorageErrorCode.NOT_FOUND);
  }

  static invalidData(message: string, cause?: Error): StorageError {
    return new StorageError(`Invalid data: ${message}`, StorageErrorCode.INVALID_DATA, cause);
  }

  static unavailable(cause?: Error): StorageError {
    return new StorageError('Storage is not available', StorageErrorCode.UNAVAILABLE, cause);
  }
}

export enum StorageErrorCode {
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_DATA = 'INVALID_DATA',
  UNAVAILABLE = 'UNAVAILABLE',
  UNKNOWN = 'UNKNOWN',
}
