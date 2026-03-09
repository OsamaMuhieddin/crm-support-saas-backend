import { env } from './env.js';
import {
  FILE_PROVIDER,
  FILE_PROVIDER_VALUES,
} from '../constants/file-provider.js';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const lowered = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lowered)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lowered)) {
    return false;
  }

  return fallback;
};

const toStringOrNull = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const defaultProvider =
  env.NODE_ENV === 'test' ? FILE_PROVIDER.LOCAL : FILE_PROVIDER.MINIO;

const assertSupportedProvider = (provider) => {
  if (!FILE_PROVIDER_VALUES.includes(provider)) {
    throw new Error(
      `Invalid STORAGE_PROVIDER "${provider}". Expected one of: ${FILE_PROVIDER_VALUES.join(', ')}`
    );
  }
};

export const storageConfig = {
  provider:
    toStringOrNull(process.env.STORAGE_PROVIDER)?.toLowerCase() ||
    defaultProvider,
  minio: {
    endpoint: toStringOrNull(process.env.S3_ENDPOINT),
    port: toInt(process.env.S3_PORT, 9000),
    useSSL: toBool(process.env.S3_USE_SSL, false),
    accessKey: toStringOrNull(process.env.S3_ACCESS_KEY),
    secretKey: toStringOrNull(process.env.S3_SECRET_KEY),
    bucket: toStringOrNull(process.env.S3_BUCKET),
    region: toStringOrNull(process.env.S3_REGION) || 'us-east-1',
    forcePathStyle: toBool(process.env.S3_FORCE_PATH_STYLE, true),
  },
  local: {
    rootDir:
      toStringOrNull(process.env.STORAGE_LOCAL_ROOT) || '.tmp/local-storage',
    bucket: toStringOrNull(process.env.S3_BUCKET) || 'crm-support-files',
  },
};

// Fail fast on startup when provider value is invalid.
assertSupportedProvider(storageConfig.provider);

export const assertStorageConfig = () => {
  assertSupportedProvider(storageConfig.provider);

  if (
    storageConfig.provider === FILE_PROVIDER.MINIO ||
    storageConfig.provider === FILE_PROVIDER.S3
  ) {
    const required = [
      ['S3_ENDPOINT', storageConfig.minio.endpoint],
      ['S3_ACCESS_KEY', storageConfig.minio.accessKey],
      ['S3_SECRET_KEY', storageConfig.minio.secretKey],
      ['S3_BUCKET', storageConfig.minio.bucket],
    ];

    const missing = required.filter(([, value]) => !value).map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(
        `Missing storage env for S3-compatible provider: ${missing.join(', ')}`
      );
    }
  }

  if (storageConfig.provider === FILE_PROVIDER.LOCAL) {
    if (!storageConfig.local.rootDir || !storageConfig.local.bucket) {
      throw new Error(
        'Missing local storage config: STORAGE_LOCAL_ROOT and S3_BUCKET are required.'
      );
    }
  }
};
