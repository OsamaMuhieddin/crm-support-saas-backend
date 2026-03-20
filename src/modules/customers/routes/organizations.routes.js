import { Router } from 'express';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import validate from '../../../shared/middlewares/validate.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import {
  createOrganizationController,
  getOrganizationController,
  listOrganizationOptionsController,
  listOrganizationsController,
  updateOrganizationController,
} from '../controllers/organizations.controller.js';
import {
  createOrganizationBodyValidation,
  createOrganizationValidator,
  listOrganizationsValidator,
  organizationByIdValidator,
  organizationOptionsValidator,
  updateOrganizationBodyValidation,
  updateOrganizationValidator,
} from '../validators/organizations.validators.js';

const router = Router();

router.get(
  '/',
  validate(listOrganizationsValidator),
  listOrganizationsController
);
router.get(
  '/options',
  validate(organizationOptionsValidator),
  listOrganizationOptionsController
);
router.get(
  '/:id',
  validate(organizationByIdValidator),
  getOrganizationController
);

router.post(
  '/',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([...createOrganizationValidator, createOrganizationBodyValidation]),
  createOrganizationController
);

router.patch(
  '/:id',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([...updateOrganizationValidator, updateOrganizationBodyValidation]),
  updateOrganizationController
);

export default router;
