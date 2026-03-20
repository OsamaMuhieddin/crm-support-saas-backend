import { Router } from 'express';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import validate from '../../../shared/middlewares/validate.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import {
  createContactIdentityController,
  listContactIdentitiesController,
} from '../controllers/contact-identities.controller.js';
import {
  createContactIdentityBodyValidation,
  createContactIdentityValidator,
  listContactIdentitiesValidator,
} from '../validators/contact-identities.validators.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  validate(listContactIdentitiesValidator),
  listContactIdentitiesController
);

router.post(
  '/',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([
    ...createContactIdentityValidator,
    createContactIdentityBodyValidation,
  ]),
  createContactIdentityController
);

export default router;
