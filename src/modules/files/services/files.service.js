import crypto from 'crypto';
import mongoose from 'mongoose';
import { File } from '../models/file.model.js';
import { FileLink } from '../models/file-link.model.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { hashBuffer } from '../../../shared/utils/security.js';
import {
  buildContentDispositionFilename,
  getFileExtension,
  sanitizeFilename,
} from '../../../shared/utils/filename.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import {
  getStorageProvider,
  StorageError,
  STORAGE_ERROR_CODES,
} from '../../../infra/storage/index.js';
import { storageConfig } from '../../../config/storage.config.js';
import { softDeleteLinksForFile } from './file-links.service.js';
import { assertWorkspaceUploadAllowed } from '../../billing/services/billing-enforcement.service.js';
import {
  incrementWorkspaceUploadsCount,
  refreshWorkspaceBillingUsageSnapshot,
} from '../../billing/services/billing-foundation.service.js';

const SORT_ALLOWLIST = Object.freeze({
  createdAt: { createdAt: 1 },
  '-createdAt': { createdAt: -1 },
  sizeBytes: { sizeBytes: 1 },
  '-sizeBytes': { sizeBytes: -1 },
  originalName: { originalNameNormalized: 1 },
  '-originalName': { originalNameNormalized: -1 },
  downloadCount: { downloadCount: 1 },
  '-downloadCount': { downloadCount: -1 },
  lastAccessedAt: { lastAccessedAt: 1 },
  '-lastAccessedAt': { lastAccessedAt: -1 },
});

const defaultSort = SORT_ALLOWLIST['-createdAt'];

const resolveBucketName = () => {
  if (storageConfig.provider === 'minio' || storageConfig.provider === 's3') {
    return storageConfig.minio.bucket;
  }

  return storageConfig.local.bucket;
};

const normalizeObjectId = (value) => String(value || '');
const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

const buildFileView = (file, options = {}) => ({
  _id: normalizeObjectId(file._id),
  workspaceId: normalizeObjectId(file.workspaceId),
  uploadedByUserId: normalizeObjectId(file.uploadedByUserId),
  url: file.url,
  sizeBytes: file.sizeBytes,
  mimeType: file.mimeType,
  originalName: file.originalName,
  extension: file.extension,
  checksum: file.checksum,
  storageStatus: file.storageStatus,
  isPrivate: file.isPrivate,
  kind: file.kind,
  source: file.source,
  metadata: file.metadata,
  lastAccessedAt: file.lastAccessedAt,
  downloadCount: file.downloadCount || 0,
  isLinked: Boolean(options.isLinked),
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const parseNullableBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const lowered = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(lowered)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(lowered)) {
    return false;
  }

  return null;
};

const buildSort = (sortKey) => SORT_ALLOWLIST[sortKey] || defaultSort;

const mapStorageErrorToApiError = (error, operation) => {
  if (!(error instanceof StorageError)) {
    throw createError('errors.file.storageUnavailable', 503);
  }

  if (error.code === STORAGE_ERROR_CODES.CONFIG) {
    throw createError('errors.file.storageUnavailable', 503);
  }

  if (error.code === STORAGE_ERROR_CODES.UNAVAILABLE) {
    throw createError('errors.file.storageUnavailable', 503);
  }

  if (
    operation === 'download' &&
    error.code === STORAGE_ERROR_CODES.NOT_FOUND
  ) {
    throw createError('errors.file.notFound', 404);
  }

  if (operation === 'upload') {
    throw createError('errors.file.uploadFailed', 502);
  }

  if (operation === 'delete') {
    throw createError('errors.file.deleteFailed', 502);
  }

  throw createError('errors.file.storageUnavailable', 503);
};

const buildStorageObjectKey = ({ workspaceId, filename }) => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const uuid = crypto.randomUUID();

  return `workspaces/${workspaceId}/files/${yyyy}/${mm}/${dd}/${uuid}-${filename}`;
};

const buildMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(normalized).length >= 20) {
      break;
    }

    const safeKey = String(key || '')
      .trim()
      .slice(0, 64);
    if (!safeKey) {
      continue;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      normalized[safeKey] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const getStorageProviderOrThrow = () => {
  try {
    return getStorageProvider();
  } catch (error) {
    throw createError('errors.file.storageUnavailable', 503);
  }
};

const findFileRecordById = async ({
  workspaceId,
  fileId,
  includeDeleted = false,
}) => {
  const query = {
    _id: fileId,
    workspaceId,
  };

  if (!includeDeleted) {
    query.deletedAt = null;
  }

  return File.findOne(query);
};

export const uploadFile = async ({
  workspaceId,
  uploadedByUserId,
  file,
  kind = null,
  source = 'direct',
  metadata = null,
}) => {
  await assertWorkspaceUploadAllowed({
    workspaceId,
    incomingSizeBytes: file?.size || 0,
  });

  const storage = getStorageProviderOrThrow();
  const bucket = resolveBucketName();

  const sanitizedOriginalName = sanitizeFilename(file.originalname, 'file');
  const extension = getFileExtension(sanitizedOriginalName);
  const checksum = hashBuffer(file.buffer);
  const objectKey = buildStorageObjectKey({
    workspaceId: normalizeObjectId(workspaceId),
    filename: sanitizedOriginalName,
  });

  const normalizedMetadata = buildMetadata(metadata);

  let uploadResult = null;
  try {
    uploadResult = await storage.uploadObject({
      bucket,
      objectKey,
      body: file.buffer,
      size: file.size,
      mimeType: file.mimetype,
      metadata: {
        'x-amz-meta-checksum': checksum,
      },
    });
  } catch (error) {
    mapStorageErrorToApiError(error, 'upload');
  }

  const fileId = new mongoose.Types.ObjectId();
  const canonicalUrl = `/api/files/${fileId}/download`;

  try {
    const created = await File.create({
      _id: fileId,
      workspaceId,
      uploadedByUserId,
      provider: storageConfig.provider,
      bucket,
      objectKey,
      url: canonicalUrl,
      sizeBytes: file.size,
      mimeType: String(file.mimetype || '').toLowerCase(),
      originalName: sanitizedOriginalName,
      extension,
      checksum,
      storageStatus: 'ready',
      etag: uploadResult?.etag || null,
      isPrivate: true,
      kind: kind || null,
      source: source || 'direct',
      metadata: normalizedMetadata,
    });

    try {
      await incrementWorkspaceUploadsCount({
        workspaceId,
      });
      await refreshWorkspaceBillingUsageSnapshot({
        workspaceId,
      });
    } catch (usageError) {
      console.error('BILLING FILE USAGE UPDATE ERROR:', usageError);
    }

    return {
      file: buildFileView(created, { isLinked: false }),
    };
  } catch (error) {
    try {
      await storage.deleteObject({
        bucket,
        objectKey,
      });
    } catch (cleanupError) {
      // best-effort compensation cleanup
    }

    throw createError('errors.file.uploadFailed', 502);
  }
};

export const listFiles = async ({
  workspaceId,
  page = 1,
  limit = 20,
  search = null,
  mimeType = null,
  extension = null,
  uploadedByUserId = null,
  kind = null,
  isLinked = null,
  entityType = null,
  entityId = null,
  createdFrom = null,
  createdTo = null,
  sort = '-createdAt',
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const normalizedWorkspaceId = toObjectIdIfValid(workspaceId);
  const normalizedEntityType = entityType
    ? String(entityType).trim().toLowerCase()
    : null;
  const normalizedEntityId = entityId ? toObjectIdIfValid(entityId) : null;

  const baseMatch = {
    workspaceId: normalizedWorkspaceId,
    deletedAt: null,
  };

  if (mimeType) {
    baseMatch.mimeType = String(mimeType).trim().toLowerCase();
  }

  if (extension) {
    const normalizedExtension = String(extension).trim().toLowerCase();
    baseMatch.extension = normalizedExtension.startsWith('.')
      ? normalizedExtension
      : `.${normalizedExtension}`;
  }

  if (uploadedByUserId) {
    baseMatch.uploadedByUserId = toObjectIdIfValid(uploadedByUserId);
  }

  if (kind) {
    baseMatch.kind = String(kind).trim();
  }

  if (search) {
    const normalizedSearch = String(search).trim().toLowerCase();
    if (normalizedSearch) {
      baseMatch.originalNameNormalized = {
        $regex: escapeRegex(normalizedSearch),
      };
    }
  }

  if (createdFrom || createdTo) {
    baseMatch.createdAt = {};

    if (createdFrom) {
      baseMatch.createdAt.$gte = new Date(createdFrom);
    }

    if (createdTo) {
      baseMatch.createdAt.$lte = new Date(createdTo);
    }
  }

  const fileLinksCollectionName = FileLink.collection.name;
  const buildLinkLookupPipeline = ({ scopedToEntity = false }) => {
    const linkLookupMatch = {
      workspaceId: normalizedWorkspaceId,
      deletedAt: null,
    };

    if (scopedToEntity && normalizedEntityType) {
      linkLookupMatch.entityType = normalizedEntityType;
      if (normalizedEntityId) {
        linkLookupMatch.entityId = normalizedEntityId;
      }
    }

    return [
      {
        $match: {
          ...linkLookupMatch,
          $expr: { $eq: ['$fileId', '$$fileId'] },
        },
      },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ];
  };

  const pipeline = [{ $match: baseMatch }];
  const parsedIsLinked = parseNullableBoolean(isLinked);
  if (parsedIsLinked !== null || normalizedEntityType) {
    pipeline.push({
      $lookup: {
        from: fileLinksCollectionName,
        let: { fileId: '$_id' },
        pipeline: buildLinkLookupPipeline({ scopedToEntity: true }),
        as: '__entityLinks',
      },
    });

    if (
      parsedIsLinked === true ||
      (normalizedEntityType && parsedIsLinked === null)
    ) {
      pipeline.push({ $match: { '__entityLinks.0': { $exists: true } } });
    } else if (parsedIsLinked === false) {
      pipeline.push({ $match: { '__entityLinks.0': { $exists: false } } });
    }
  }

  pipeline.push({
    $lookup: {
      from: fileLinksCollectionName,
      let: { fileId: '$_id' },
      pipeline: buildLinkLookupPipeline({ scopedToEntity: false }),
      as: '__activeLinks',
    },
  });
  pipeline.push({
    $addFields: {
      __isLinked: { $gt: [{ $size: '$__activeLinks' }, 0] },
    },
  });
  pipeline.push({
    $project: {
      __entityLinks: 0,
      __activeLinks: 0,
    },
  });

  const sortQuery = buildSort(String(sort || '').trim());
  pipeline.push({
    $facet: {
      files: [{ $sort: sortQuery }, { $skip: skip }, { $limit: safeLimit }],
      meta: [{ $count: 'total' }],
    },
  });

  const [aggregateResult] = await File.aggregate(pipeline);
  const files = aggregateResult?.files || [];
  const total = aggregateResult?.meta?.[0]?.total || 0;

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: files.length,
    }),
    files: files.map((file) =>
      buildFileView(file, {
        isLinked: file.__isLinked,
      })
    ),
  };
};

export const getFileMetadata = async ({ workspaceId, fileId }) => {
  const file = await findFileRecordById({
    workspaceId,
    fileId,
  });

  if (!file) {
    throw createError('errors.file.notFound', 404);
  }

  const linkedCount = await FileLink.countDocuments({
    workspaceId,
    fileId: file._id,
    deletedAt: null,
  });

  return {
    file: buildFileView(file, { isLinked: linkedCount > 0 }),
  };
};

export const getFileDownloadPayload = async ({ workspaceId, fileId }) => {
  const file = await findFileRecordById({
    workspaceId,
    fileId,
  });

  if (!file) {
    throw createError('errors.file.notFound', 404);
  }

  const storage = getStorageProviderOrThrow();

  let stat = null;
  try {
    stat = await storage.statObject({
      bucket: file.bucket,
      objectKey: file.objectKey,
    });
  } catch (error) {
    if (
      error instanceof StorageError &&
      error.code === STORAGE_ERROR_CODES.NOT_FOUND
    ) {
      throw createError('errors.file.notFound', 404);
    }

    mapStorageErrorToApiError(error, 'download');
  }

  let stream = null;
  try {
    stream = await storage.getObjectStream({
      bucket: file.bucket,
      objectKey: file.objectKey,
    });
  } catch (error) {
    mapStorageErrorToApiError(error, 'download');
  }

  File.updateOne(
    { _id: file._id, workspaceId },
    {
      $set: { lastAccessedAt: new Date() },
      $inc: { downloadCount: 1 },
    }
  ).catch(() => {});

  return {
    stream,
    contentType: file.mimeType || 'application/octet-stream',
    contentLength: stat?.size || file.sizeBytes || null,
    contentDisposition: buildContentDispositionFilename(file.originalName),
    file: buildFileView(file, { isLinked: false }),
  };
};

export const deleteFileById = async ({
  workspaceId,
  fileId,
  deletedByUserId,
}) => {
  const file = await findFileRecordById({
    workspaceId,
    fileId,
    includeDeleted: true,
  });

  if (!file) {
    throw createError('errors.file.notFound', 404);
  }

  if (file.deletedAt) {
    return {
      file: buildFileView(file, { isLinked: false }),
      alreadyDeleted: true,
    };
  }

  const storage = getStorageProviderOrThrow();

  try {
    await storage.deleteObject({
      bucket: file.bucket,
      objectKey: file.objectKey,
    });
  } catch (error) {
    if (
      error instanceof StorageError &&
      error.code === STORAGE_ERROR_CODES.NOT_FOUND
    ) {
      // allow idempotent cleanup when object was already removed from storage
    } else {
      mapStorageErrorToApiError(error, 'delete');
    }
  }

  file.deletedAt = new Date();
  file.deletedByUserId = deletedByUserId;
  file.storageStatus = 'deleted';
  await file.save();

  // Keep relation history but hide active links once storage deletion is explicit.
  await softDeleteLinksForFile({
    workspaceId,
    fileId: file._id,
    deletedByUserId,
  });

  try {
    await refreshWorkspaceBillingUsageSnapshot({
      workspaceId,
    });
  } catch (usageError) {
    console.error('BILLING FILE USAGE REFRESH ERROR:', usageError);
  }

  return {
    file: buildFileView(file, { isLinked: false }),
    alreadyDeleted: false,
  };
};
