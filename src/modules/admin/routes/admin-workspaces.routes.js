import { Router } from 'express';
import { PLATFORM_ROLES } from '../../../constants/platform-roles.js';
import requirePlatformRole from '../../../shared/middlewares/requirePlatformRole.js';
import validate from '../../../shared/middlewares/validate.js';
import {
  extendAdminWorkspaceTrialController,
  getAdminWorkspaceByIdController,
  listAdminWorkspacesController,
  reactivateAdminWorkspaceController,
  suspendAdminWorkspaceController,
} from '../controllers/admin-workspaces.controller.js';
import {
  adminWorkspaceByIdValidator,
  extendTrialAdminWorkspaceValidator,
  listAdminWorkspacesValidator,
  reactivateAdminWorkspaceValidator,
  suspendAdminWorkspaceValidator,
} from '../validators/admin-workspaces.validators.js';

const router = Router();

router.get(
  '/',
  requirePlatformRole(
    PLATFORM_ROLES.SUPER_ADMIN,
    PLATFORM_ROLES.PLATFORM_ADMIN,
    PLATFORM_ROLES.PLATFORM_SUPPORT
  ),
  validate(listAdminWorkspacesValidator),
  listAdminWorkspacesController
);
router.get(
  '/:id',
  requirePlatformRole(
    PLATFORM_ROLES.SUPER_ADMIN,
    PLATFORM_ROLES.PLATFORM_ADMIN,
    PLATFORM_ROLES.PLATFORM_SUPPORT
  ),
  validate(adminWorkspaceByIdValidator),
  getAdminWorkspaceByIdController
);
router.post(
  '/:id/suspend',
  requirePlatformRole(PLATFORM_ROLES.SUPER_ADMIN),
  validate(suspendAdminWorkspaceValidator),
  suspendAdminWorkspaceController
);
router.post(
  '/:id/reactivate',
  requirePlatformRole(PLATFORM_ROLES.SUPER_ADMIN),
  validate(reactivateAdminWorkspaceValidator),
  reactivateAdminWorkspaceController
);
router.post(
  '/:id/extend-trial',
  requirePlatformRole(PLATFORM_ROLES.SUPER_ADMIN),
  validate(extendTrialAdminWorkspaceValidator),
  extendAdminWorkspaceTrialController
);

export default router;
