import { Router } from 'express';

import healthRouter from '../modules/health/index.js';
import workspacesRouter from '../modules/workspaces/index.js';
import usersRouter from '../modules/users/index.js';
import customersRouter from '../modules/customers/index.js';
import ticketsRouter from '../modules/tickets/index.js';
import authRouter from '../modules/auth/index.js';
import inboxRouter from '../modules/inbox/index.js';
import slaRouter from '../modules/sla/index.js';
import integrationsRouter from '../modules/integrations/index.js';
import plansRouter from '../modules/plans/index.js';
import adminRouter from '../modules/admin/index.js';
import filesRouter from '../modules/files/index.js';

const router = Router();

router.use('/health', healthRouter);

// CRM foundation modules (routers only for now)
router.use('/workspaces', workspacesRouter);
router.use('/users', usersRouter);
router.use('/customers', customersRouter);
router.use('/tickets', ticketsRouter);
router.use('/auth', authRouter);
router.use('/inbox', inboxRouter);
router.use('/sla', slaRouter);
router.use('/integrations', integrationsRouter);
router.use('/plans', plansRouter);
router.use('/admin', adminRouter);
router.use('/files', filesRouter);

export default router;
