import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  acceptInviteController,
  createInviteController,
  getInviteController,
  listMineController,
  listInvitesController,
  resendInviteController,
  revokeInviteController,
  switchWorkspaceController
} from '../controllers/workspaces.controller.js';
import {
  acceptInviteValidator,
  createInviteValidator,
  inviteByIdValidator,
  listInvitesValidator,
  switchWorkspaceValidator
} from '../validators/workspaces.validators.js';

const router = Router();

router.get('/mine', requireAuth, requireActiveUser, listMineController);

router.post(
  '/switch',
  requireAuth,
  requireActiveUser,
  validate(switchWorkspaceValidator),
  switchWorkspaceController
);

router.post(
  '/:workspaceId/invites',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createInviteValidator),
  createInviteController
);

router.get(
  '/:workspaceId/invites',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(listInvitesValidator),
  listInvitesController
);

router.get(
  '/:workspaceId/invites/:inviteId',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(inviteByIdValidator),
  getInviteController
);

router.post(
  '/:workspaceId/invites/:inviteId/resend',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(inviteByIdValidator),
  resendInviteController
);

router.post(
  '/:workspaceId/invites/:inviteId/revoke',
  requireAuth,
  requireActiveUser,
  requireActiveMember,
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(inviteByIdValidator),
  revokeInviteController
);

router.post('/invites/accept', validate(acceptInviteValidator), acceptInviteController);

export default router;
