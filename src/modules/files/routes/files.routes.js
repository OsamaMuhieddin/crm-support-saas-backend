import { Router } from 'express';
import multer from 'multer';
import validate, {
  buildValidationError,
} from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import createRateLimiter from '../../../shared/middlewares/rateLimit.js';
import { createError } from '../../../shared/errors/createError.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { filesConfig } from '../../../config/files.config.js';
import {
  deleteFileController,
  downloadFileController,
  getFileMetadataController,
  listFilesController,
  uploadFileController,
} from '../controllers/files.controller.js';
import {
  fileByIdValidator,
  listFilesValidator,
  uploadFileBodyValidator,
  uploadFileValidation,
} from '../validators/files.validators.js';

const router = Router();

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: filesConfig.maxFileSizeBytes,
    files: 1,
  },
}).single('file');

const handleSingleFileUpload = (req, res, next) => {
  uploadMiddleware(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          createError('errors.validation.failed', 422, [
            buildValidationError('file', 'errors.file.tooLarge', {
              maxBytes: filesConfig.maxFileSizeBytes,
            }),
          ])
        );
      }

      return next(
        createError('errors.validation.failed', 422, [
          buildValidationError('file', 'errors.file.uploadFailed'),
        ])
      );
    }

    return next(createError('errors.file.uploadFailed', 502));
  });
};

const uploadRateLimiter = createRateLimiter({
  windowMs: filesConfig.rateLimit.upload.windowMs,
  max: filesConfig.rateLimit.upload.max,
  enabled: filesConfig.rateLimit.upload.enabled,
  messageKey: 'errors.file.rateLimited',
  statusCode: 429,
});

const downloadRateLimiter = createRateLimiter({
  windowMs: filesConfig.rateLimit.download.windowMs,
  max: filesConfig.rateLimit.download.max,
  enabled: filesConfig.rateLimit.download.enabled,
  messageKey: 'errors.file.rateLimited',
  statusCode: 429,
});

router.post(
  '/',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  uploadRateLimiter,
  handleSingleFileUpload,
  validate([...uploadFileBodyValidator, uploadFileValidation]),
  uploadFileController
);

router.get(
  '/',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  validate(listFilesValidator),
  listFilesController
);

router.get(
  '/:fileId',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  validate(fileByIdValidator),
  getFileMetadataController
);

router.get(
  '/:fileId/download',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  downloadRateLimiter,
  validate(fileByIdValidator),
  downloadFileController
);

router.delete(
  '/:fileId',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(fileByIdValidator),
  deleteFileController
);

export default router;
