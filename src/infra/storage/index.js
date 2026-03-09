import { FILE_PROVIDER } from '../../constants/file-provider.js';
import {
  storageConfig,
  assertStorageConfig,
} from '../../config/storage.config.js';
import { MinioStorageAdapter } from './s3.minio.storage.js';
import { LocalStorageAdapter } from './local.storage.js';
import { StorageError, STORAGE_ERROR_CODES } from './storage.error.js';

let storageProvider = null;

const createStorageProvider = () => {
  assertStorageConfig();

  if (
    storageConfig.provider === FILE_PROVIDER.MINIO ||
    storageConfig.provider === FILE_PROVIDER.S3
  ) {
    return new MinioStorageAdapter({
      endpoint: storageConfig.minio.endpoint,
      port: storageConfig.minio.port,
      useSSL: storageConfig.minio.useSSL,
      accessKey: storageConfig.minio.accessKey,
      secretKey: storageConfig.minio.secretKey,
      bucket: storageConfig.minio.bucket,
      region: storageConfig.minio.region,
      forcePathStyle: storageConfig.minio.forcePathStyle,
    });
  }

  if (storageConfig.provider === FILE_PROVIDER.LOCAL) {
    return new LocalStorageAdapter({
      rootDir: storageConfig.local.rootDir,
      bucket: storageConfig.local.bucket,
    });
  }

  throw new StorageError(
    STORAGE_ERROR_CODES.CONFIG,
    `Unsupported storage provider: ${storageConfig.provider}`
  );
};

export const getStorageProvider = () => {
  if (!storageProvider) {
    storageProvider = createStorageProvider();
  }

  return storageProvider;
};

export const resetStorageProviderForTests = () => {
  storageProvider = null;
};

export { StorageError, STORAGE_ERROR_CODES } from './storage.error.js';
