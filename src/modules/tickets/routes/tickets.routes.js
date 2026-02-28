import { Router } from 'express';
import { getTickets } from '../controllers/tickets.controller.js';

const router = Router();
router.get('/', getTickets);

export default router;
