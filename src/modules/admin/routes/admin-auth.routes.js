import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requirePlatformAuth from '../../../shared/middlewares/requirePlatformAuth.js';
import requireActivePlatformAdmin from '../../../shared/middlewares/requireActivePlatformAdmin.js';
import {
  adminLoginController,
  adminLogoutAllController,
  adminLogoutController,
  adminMeController,
  adminRefreshController,
} from '../controllers/admin-auth.controller.js';
import {
  adminLoginValidator,
  adminRefreshValidator,
} from '../validators/admin-auth.validators.js';

const router = Router();

router.post('/login', validate(adminLoginValidator), adminLoginController);
router.post(
  '/refresh',
  validate(adminRefreshValidator),
  adminRefreshController
);
router.get(
  '/me',
  requirePlatformAuth,
  requireActivePlatformAdmin,
  adminMeController
);
router.post(
  '/logout',
  requirePlatformAuth,
  requireActivePlatformAdmin,
  adminLogoutController
);
router.post(
  '/logout-all',
  requirePlatformAuth,
  requireActivePlatformAdmin,
  adminLogoutAllController
);

export default router;
