export const STORAGE_ERROR_CODES = Object.freeze({
  CONFIG: 'config',
  NOT_FOUND: 'not_found',
  UNAVAILABLE: 'unavailable',
  UPLOAD_FAILED: 'upload_failed',
  DOWNLOAD_FAILED: 'download_failed',
  DELETE_FAILED: 'delete_failed',
});

export class StorageError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.originalError = originalError;
  }
}
