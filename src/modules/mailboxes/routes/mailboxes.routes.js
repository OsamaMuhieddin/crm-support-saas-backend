import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  activateMailboxController,
  createMailboxController,
  deactivateMailboxController,
  getMailboxController,
  listMailboxOptionsController,
  listMailboxesController,
  setDefaultMailboxController,
  updateMailboxController,
} from '../controllers/mailboxes.controller.js';
import {
  createMailboxValidator,
  listMailboxesValidator,
  mailboxActionByIdValidator,
  mailboxByIdValidator,
  mailboxOptionsValidator,
  updateMailboxBodyValidation,
  updateMailboxValidator,
} from '../validators/mailboxes.validators.js';

const router = Router();

router.use(requireAuth, requireActiveUser, requireActiveMember);

router.get('/', validate(listMailboxesValidator), listMailboxesController);
router.get(
  '/options',
  validate(mailboxOptionsValidator),
  listMailboxOptionsController
);
router.get('/:id', validate(mailboxByIdValidator), getMailboxController);

router.post(
  '/',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createMailboxValidator),
  createMailboxController
);

router.patch(
  '/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([...updateMailboxValidator, updateMailboxBodyValidation]),
  updateMailboxController
);

router.post(
  '/:id/set-default',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(mailboxActionByIdValidator),
  setDefaultMailboxController
);

router.post(
  '/:id/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(mailboxActionByIdValidator),
  activateMailboxController
);

router.post(
  '/:id/deactivate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(mailboxActionByIdValidator),
  deactivateMailboxController
);

export default router;

