import { Router } from 'express';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import validate from '../../../shared/middlewares/validate.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  getReportsOverviewController,
  getReportsSlaController,
  getReportsTeamController,
  getReportsTicketsController,
} from '../controllers/reports.controller.js';
import {
  reportsOverviewValidator,
  reportsSlaValidator,
  reportsTeamValidator,
  reportsTicketsValidator,
} from '../validators/reports.validators.js';

const router = Router();

router.use(requireAuth, requireActiveUser, requireActiveMember);

router.get(
  '/overview',
  validate(reportsOverviewValidator),
  getReportsOverviewController
);
router.get(
  '/tickets',
  validate(reportsTicketsValidator),
  getReportsTicketsController
);
router.get('/sla', validate(reportsSlaValidator), getReportsSlaController);
router.get(
  '/team',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(reportsTeamValidator),
  getReportsTeamController
);

export default router;
