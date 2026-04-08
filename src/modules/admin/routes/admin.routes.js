import { Router } from 'express';
import { PLATFORM_ROLES } from '../../../constants/platform-roles.js';
import requireActivePlatformAdmin from '../../../shared/middlewares/requireActivePlatformAdmin.js';
import requirePlatformAuth from '../../../shared/middlewares/requirePlatformAuth.js';
import requirePlatformRole from '../../../shared/middlewares/requirePlatformRole.js';
import validate from '../../../shared/middlewares/validate.js';
import adminAuthRouter from './admin-auth.routes.js';
import adminWorkspacesRouter from './admin-workspaces.routes.js';
import {
  getAdminBillingOverviewController,
  getAdminMetricsController,
  getAdminOverviewController,
} from '../controllers/admin.controller.js';
import {
  adminBillingOverviewValidator,
  adminMetricsValidator,
  adminOverviewValidator,
} from '../validators/admin-analytics.validators.js';

const router = Router();

router.use('/auth', adminAuthRouter);

router.use(requirePlatformAuth, requireActivePlatformAdmin);
router.use('/workspaces', adminWorkspacesRouter);
router.get(
  '/overview',
  requirePlatformRole(
    PLATFORM_ROLES.SUPER_ADMIN,
    PLATFORM_ROLES.PLATFORM_ADMIN
  ),
  validate(adminOverviewValidator),
  getAdminOverviewController
);
router.get(
  '/metrics',
  requirePlatformRole(
    PLATFORM_ROLES.SUPER_ADMIN,
    PLATFORM_ROLES.PLATFORM_ADMIN
  ),
  validate(adminMetricsValidator),
  getAdminMetricsController
);
router.get(
  '/billing-overview',
  requirePlatformRole(PLATFORM_ROLES.SUPER_ADMIN),
  validate(adminBillingOverviewValidator),
  getAdminBillingOverviewController
);

export default router;
