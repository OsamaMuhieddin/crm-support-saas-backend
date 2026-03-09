import { Client as MinioClient } from 'minio';
import { StorageError, STORAGE_ERROR_CODES } from './storage.error.js';

const isNotFoundError = (error) =>
  error?.code === 'NoSuchKey' ||
  error?.code === 'NoSuchBucket' ||
  error?.code === 'NotFound';

const toStorageError = (errorCode, message, error) =>
  new StorageError(errorCode, message, error);

export class MinioStorageAdapter {
  constructor(options) {
    this.bucket = options.bucket;
    this.region = options.region;

    this.client = new MinioClient({
      endPoint: options.endpoint,
      port: options.port,
      useSSL: options.useSSL,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
      pathStyle: options.forcePathStyle,
    });

    this.bucketReady = false;
  }

  async ensureBucket(bucketName = this.bucket) {
    if (this.bucketReady) {
      return;
    }

    try {
      const exists = await this.client.bucketExists(bucketName);
      if (!exists) {
        await this.client.makeBucket(bucketName, this.region);
      }

      this.bucketReady = true;
    } catch (error) {
      throw toStorageError(
        STORAGE_ERROR_CODES.UNAVAILABLE,
        'Failed to initialize storage bucket.',
        error
      );
    }
  }

  async uploadObject({
    bucket = this.bucket,
    objectKey,
    body,
    size = null,
    mimeType = 'application/octet-stream',
    metadata = {},
  }) {
    try {
      await this.ensureBucket(bucket);

      const headers = {
        'Content-Type': mimeType,
        ...metadata,
      };

      const etag = await this.client.putObject(
        bucket,
        objectKey,
        body,
        size || undefined,
        headers
      );

      return {
        bucket,
        objectKey,
        etag: typeof etag === 'string' ? etag.replace(/"/g, '') : null,
      };
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.UPLOAD_FAILED,
        'Failed to upload object to storage.',
        error
      );
    }
  }

  async getObjectStream({ bucket = this.bucket, objectKey }) {
    try {
      await this.ensureBucket(bucket);
      return await this.client.getObject(bucket, objectKey);
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
        'Failed to retrieve object stream from storage.',
        error
      );
    }
  }

  async deleteObject({ bucket = this.bucket, objectKey }) {
    try {
      await this.ensureBucket(bucket);
      await this.client.removeObject(bucket, objectKey);
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
        'Failed to delete object from storage.',
        error
      );
    }
  }

  async statObject({ bucket = this.bucket, objectKey }) {
    try {
      await this.ensureBucket(bucket);
      const stats = await this.client.statObject(bucket, objectKey);

      return {
        size: stats?.size || null,
        etag: stats?.etag || null,
        lastModified: stats?.lastModified || null,
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
        'Failed to stat object in storage.',
        error
      );
    }
  }

  async getPresignedDownloadUrl({
    bucket = this.bucket,
    objectKey,
    expiresIn = 60,
  }) {
    try {
      await this.ensureBucket(bucket);
      return await this.client.presignedGetObject(bucket, objectKey, expiresIn);
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      throw toStorageError(
        STORAGE_ERROR_CODES.UNAVAILABLE,
        'Failed to generate presigned download URL.',
        error
      );
    }
  }
}

export default MinioStorageAdapter;
