import { Router } from 'express';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import { getRealtimeBootstrapController } from '../controllers/realtime.controller.js';

const router = Router();

router.get(
  '/bootstrap',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  getRealtimeBootstrapController
);

export default router;
