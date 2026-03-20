import { Router } from 'express';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import validate from '../../../shared/middlewares/validate.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import {
  createContactController,
  getContactController,
  listContactOptionsController,
  listContactsController,
  updateContactController,
} from '../controllers/contacts.controller.js';
import {
  contactByIdValidator,
  contactOptionsValidator,
  createContactBodyValidation,
  createContactValidator,
  listContactsValidator,
  updateContactBodyValidation,
  updateContactValidator,
} from '../validators/contacts.validators.js';
import contactIdentitiesRouter from './contact-identities.routes.js';

const router = Router();

router.get('/', validate(listContactsValidator), listContactsController);
router.get(
  '/options',
  validate(contactOptionsValidator),
  listContactOptionsController
);
router.use('/:id/identities', contactIdentitiesRouter);
router.get('/:id', validate(contactByIdValidator), getContactController);

router.post(
  '/',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([...createContactValidator, createContactBodyValidation]),
  createContactController
);

router.patch(
  '/:id',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([...updateContactValidator, updateContactBodyValidation]),
  updateContactController
);

export default router;
