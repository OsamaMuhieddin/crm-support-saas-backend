import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  activateSlaPolicyController,
  createBusinessHoursController,
  createSlaPolicyController,
  deactivateSlaPolicyController,
  getBusinessHoursController,
  getSlaPolicyController,
  getSlaSummaryController,
  listBusinessHoursController,
  listBusinessHoursOptionsController,
  listSlaPoliciesController,
  listSlaPolicyOptionsController,
  setDefaultSlaPolicyController,
  updateBusinessHoursController,
  updateSlaPolicyController,
} from '../controllers/sla.controller.js';
import {
  businessHoursByIdValidator,
  businessHoursOptionsValidator,
  createBusinessHoursValidator,
  createSlaPolicyValidator,
  deactivateSlaPolicyValidator,
  listBusinessHoursValidator,
  listSlaPoliciesValidator,
  slaPolicyActionByIdValidator,
  slaPolicyByIdValidator,
  slaPolicyOptionsValidator,
  updateBusinessHoursBodyValidation,
  updateBusinessHoursValidator,
  updateSlaPolicyBodyValidation,
  updateSlaPolicyValidator,
} from '../validators/sla.validators.js';

const router = Router();

router.use(requireAuth, requireActiveUser, requireActiveMember);

router.get('/summary', getSlaSummaryController);

router.get(
  '/business-hours',
  validate(listBusinessHoursValidator),
  listBusinessHoursController
);
router.get(
  '/business-hours/options',
  validate(businessHoursOptionsValidator),
  listBusinessHoursOptionsController
);
router.get(
  '/business-hours/:id',
  validate(businessHoursByIdValidator),
  getBusinessHoursController
);
router.post(
  '/business-hours',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createBusinessHoursValidator),
  createBusinessHoursController
);
router.patch(
  '/business-hours/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([...updateBusinessHoursValidator, updateBusinessHoursBodyValidation]),
  updateBusinessHoursController
);

router.get(
  '/policies',
  validate(listSlaPoliciesValidator),
  listSlaPoliciesController
);
router.get(
  '/policies/options',
  validate(slaPolicyOptionsValidator),
  listSlaPolicyOptionsController
);
router.get('/policies/:id', validate(slaPolicyByIdValidator), getSlaPolicyController);
router.post(
  '/policies',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createSlaPolicyValidator),
  createSlaPolicyController
);
router.patch(
  '/policies/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([...updateSlaPolicyValidator, updateSlaPolicyBodyValidation]),
  updateSlaPolicyController
);
router.post(
  '/policies/:id/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(slaPolicyActionByIdValidator),
  activateSlaPolicyController
);
router.post(
  '/policies/:id/deactivate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(deactivateSlaPolicyValidator),
  deactivateSlaPolicyController
);
router.post(
  '/policies/:id/set-default',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(slaPolicyActionByIdValidator),
  setDefaultSlaPolicyController
);

export default router;
