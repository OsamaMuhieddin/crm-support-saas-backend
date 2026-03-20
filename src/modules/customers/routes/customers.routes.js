import { Router } from 'express';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import contactsRouter from './contacts.routes.js';
import organizationsRouter from './organizations.routes.js';

const router = Router();
router.use(requireAuth, requireActiveUser, requireActiveMember);
router.use('/contacts', contactsRouter);
router.use('/organizations', organizationsRouter);

export default router;
