import { Router } from 'express';
import multer from 'multer';
import { filesConfig } from '../../../config/files.config.js';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import createRateLimiter from '../../../shared/middlewares/rateLimit.js';
import {
  buildValidationError,
} from '../../../shared/middlewares/validate.js';
import { createError } from '../../../shared/errors/createError.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { uploadFileValidation } from '../../files/validators/files.validators.js';
import {
  activateWidgetController,
  createWidgetController,
  deactivateWidgetController,
  getPublicWidgetBootstrapController,
  getWidgetController,
  listWidgetOptionsController,
  listWidgetsController,
  updateWidgetController,
} from '../controllers/widget.controller.js';
import {
  createPublicWidgetMessageController,
  initializePublicWidgetSessionController,
  uploadPublicWidgetFileController,
} from '../controllers/widget-public.controller.js';
import {
  continueRecoveredWidgetConversationController,
  requestWidgetRecoveryController,
  startNewRecoveredWidgetConversationController,
  verifyWidgetRecoveryController,
} from '../controllers/widget-recovery.controller.js';
import {
  createWidgetValidator,
  listWidgetsValidator,
  publicWidgetBootstrapValidator,
  publicWidgetMessageValidator,
  publicWidgetFileUploadValidator,
  publicWidgetRecoveryContinueValidator,
  publicWidgetRecoveryRequestValidator,
  publicWidgetRecoveryStartNewValidator,
  publicWidgetRecoveryVerifyValidator,
  publicWidgetSessionValidator,
  updateWidgetBodyValidation,
  updateWidgetValidator,
  widgetActionByIdValidator,
  widgetByIdValidator,
  widgetOptionsValidator,
} from '../validators/widget.validators.js';

const router = Router();

const publicWidgetUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: filesConfig.maxFileSizeBytes,
    files: 1,
  },
}).single('file');

const handlePublicWidgetFileUpload = (req, res, next) => {
  publicWidgetUploadMiddleware(req, res, (error) => {
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

const publicWidgetUploadRateLimiter = createRateLimiter({
  windowMs: filesConfig.rateLimit.upload.windowMs,
  max: filesConfig.rateLimit.upload.max,
  enabled: filesConfig.rateLimit.upload.enabled,
  messageKey: 'errors.file.rateLimited',
  statusCode: 429,
});

router.get(
  '/public/:publicKey/bootstrap',
  validate(publicWidgetBootstrapValidator),
  getPublicWidgetBootstrapController
);
router.post(
  '/public/:publicKey/session',
  validate(publicWidgetSessionValidator),
  initializePublicWidgetSessionController
);
router.post(
  '/public/:publicKey/messages',
  validate(publicWidgetMessageValidator),
  createPublicWidgetMessageController
);
router.post(
  '/public/:publicKey/files',
  publicWidgetUploadRateLimiter,
  handlePublicWidgetFileUpload,
  validate([...publicWidgetFileUploadValidator, uploadFileValidation]),
  uploadPublicWidgetFileController
);
router.post(
  '/public/:publicKey/recovery/request',
  validate(publicWidgetRecoveryRequestValidator),
  requestWidgetRecoveryController
);
router.post(
  '/public/:publicKey/recovery/verify',
  validate(publicWidgetRecoveryVerifyValidator),
  verifyWidgetRecoveryController
);
router.post(
  '/public/:publicKey/recovery/continue',
  validate(publicWidgetRecoveryContinueValidator),
  continueRecoveredWidgetConversationController
);
router.post(
  '/public/:publicKey/recovery/start-new',
  validate(publicWidgetRecoveryStartNewValidator),
  startNewRecoveredWidgetConversationController
);

router.use(requireAuth, requireActiveUser, requireActiveMember);

router.get('/', validate(listWidgetsValidator), listWidgetsController);
router.get(
  '/options',
  validate(widgetOptionsValidator),
  listWidgetOptionsController
);
router.get('/:id', validate(widgetByIdValidator), getWidgetController);

router.post(
  '/',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createWidgetValidator),
  createWidgetController
);

router.patch(
  '/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([...updateWidgetValidator, updateWidgetBodyValidation]),
  updateWidgetController
);

router.post(
  '/:id/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(widgetActionByIdValidator),
  activateWidgetController
);

router.post(
  '/:id/deactivate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(widgetActionByIdValidator),
  deactivateWidgetController
);

export default router;
