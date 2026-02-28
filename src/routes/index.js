import { Router } from 'express';

import healthRouter from '../modules/health/index.js';
import workspacesRouter from '../modules/workspaces/index.js';
import usersRouter from '../modules/users/index.js';
import customersRouter from '../modules/customers/index.js';
import ticketsRouter from '../modules/tickets/index.js';

const router = Router();

router.use('/health', healthRouter);

// CRM foundation modules (routers only for now)
router.use('/workspaces', workspacesRouter);
router.use('/users', usersRouter);
router.use('/customers', customersRouter);
router.use('/tickets', ticketsRouter);

export default router;
