import { createError } from '../../../shared/errors/createError.js';
import {
  deleteFileById,
  getFileDownloadPayload,
  getFileMetadata,
  listFiles,
  uploadFile,
} from '../services/files.service.js';

export const uploadFileController = async (req, res, next) => {
  try {
    const data = await uploadFile({
      workspaceId: req.auth.workspaceId,
      uploadedByUserId: req.auth.userId,
      file: req.file,
      kind: req.body.kind || null,
      source: req.body.source || 'direct',
      metadata: null,
    });

    return res.json({
      messageKey: 'success.file.uploaded',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listFilesController = async (req, res, next) => {
  try {
    const data = await listFiles({
      workspaceId: req.auth.workspaceId,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      mimeType: req.query.mimeType,
      extension: req.query.extension,
      uploadedByUserId: req.query.uploadedByUserId,
      kind: req.query.kind,
      isLinked: req.query.isLinked,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      createdFrom: req.query.createdFrom,
      createdTo: req.query.createdTo,
      sort: req.query.sort,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getFileMetadataController = async (req, res, next) => {
  try {
    const data = await getFileMetadata({
      workspaceId: req.auth.workspaceId,
      fileId: req.params.fileId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const downloadFileController = async (req, res, next) => {
  try {
    const payload = await getFileDownloadPayload({
      workspaceId: req.auth.workspaceId,
      fileId: req.params.fileId,
    });

    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Disposition', payload.contentDisposition);
    if (payload.contentLength !== null && payload.contentLength !== undefined) {
      res.setHeader('Content-Length', String(payload.contentLength));
    }

    payload.stream.on('error', () => {
      if (!res.headersSent) {
        return next(createError('errors.file.downloadFailed', 502));
      }

      res.destroy();
      return undefined;
    });

    payload.stream.pipe(res);
    return undefined;
  } catch (error) {
    return next(error);
  }
};

export const deleteFileController = async (req, res, next) => {
  try {
    const data = await deleteFileById({
      workspaceId: req.auth.workspaceId,
      fileId: req.params.fileId,
      deletedByUserId: req.auth.userId,
    });

    return res.json({
      messageKey: 'success.file.deleted',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
