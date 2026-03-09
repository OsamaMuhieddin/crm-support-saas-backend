import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { pipeline } from 'stream/promises';
import { hashValue } from '../../shared/utils/security.js';
import { StorageError, STORAGE_ERROR_CODES } from './storage.error.js';

const toStorageError = (errorCode, message, error) =>
  new StorageError(errorCode, message, error);

const isNotFoundError = (error) => error?.code === 'ENOENT';

export class LocalStorageAdapter {
  constructor(options) {
    this.rootDir = path.resolve(options.rootDir);
    this.bucket = options.bucket;
  }

  resolveObjectPath(bucket, objectKey) {
    const safeBucket = String(bucket || '').trim();
    const bucketDir = path.resolve(this.rootDir, safeBucket);
    const resolvedPath = path.resolve(bucketDir, String(objectKey || ''));

    if (!resolvedPath.startsWith(bucketDir)) {
      throw toStorageError(
        STORAGE_ERROR_CODES.CONFIG,
        'Invalid object key path.',
        null
      );
    }

    return {
      bucketDir,
      resolvedPath
    };
  }

  async ensureBucket(bucket = this.bucket) {
    const { bucketDir } = this.resolveObjectPath(bucket, 'noop');
    await fsPromises.mkdir(bucketDir, { recursive: true });
  }

  async uploadObject({
    bucket = this.bucket,
    objectKey,
    body,
    mimeType = 'application/octet-stream'
  }) {
    try {
      await this.ensureBucket(bucket);
      const { resolvedPath } = this.resolveObjectPath(bucket, objectKey);
      await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true });

      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        await fsPromises.writeFile(resolvedPath, body);
      } else if (typeof body === 'string') {
        await fsPromises.writeFile(resolvedPath, body, 'utf8');
      } else if (body && typeof body.pipe === 'function') {
        await pipeline(body, fs.createWriteStream(resolvedPath));
      } else {
        throw toStorageError(
          STORAGE_ERROR_CODES.UPLOAD_FAILED,
          'Unsupported upload body type.',
          null
        );
      }

      const etag = hashValue(`${bucket}:${objectKey}`);
      return {
        bucket,
        objectKey,
        etag,
        mimeType
      };
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.UPLOAD_FAILED,
        'Failed to upload object to local storage.',
        error
      );
    }
  }

  async getObjectStream({ bucket = this.bucket, objectKey }) {
    try {
      const { resolvedPath } = this.resolveObjectPath(bucket, objectKey);
      await fsPromises.access(resolvedPath);
      return fs.createReadStream(resolvedPath);
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      if (isNotFoundError(error)) {
        throw toStorageError(
          STORAGE_ERROR_CODES.NOT_FOUND,
          'Storage object not found.',
          error
        );
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.DOWNLOAD_FAILED,
        'Failed to read object from local storage.',
        error
      );
    }
  }

  async deleteObject({ bucket = this.bucket, objectKey }) {
    try {
      const { resolvedPath } = this.resolveObjectPath(bucket, objectKey);
      await fsPromises.rm(resolvedPath, { force: true });
      return { deleted: true };
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      if (isNotFoundError(error)) {
        throw toStorageError(
          STORAGE_ERROR_CODES.NOT_FOUND,
          'Storage object not found.',
          error
        );
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.DELETE_FAILED,
        'Failed to delete object from local storage.',
        error
      );
    }
  }

  async statObject({ bucket = this.bucket, objectKey }) {
    try {
      const { resolvedPath } = this.resolveObjectPath(bucket, objectKey);
      const stats = await fsPromises.stat(resolvedPath);

      return {
        size: stats.size,
        etag: null,
        lastModified: stats.mtime
      };
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      if (isNotFoundError(error)) {
        throw toStorageError(
          STORAGE_ERROR_CODES.NOT_FOUND,
          'Storage object not found.',
          error
        );
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.UNAVAILABLE,
        'Failed to stat object in local storage.',
        error
      );
    }
  }

  async getPresignedDownloadUrl() {
    return null;
  }
}

export default LocalStorageAdapter;
