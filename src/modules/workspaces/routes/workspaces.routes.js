import { Router } from 'express';
import { getWorkspaces } from '../controllers/workspaces.controller.js';

const router = Router();
router.get('/', getWorkspaces);

export default router;
