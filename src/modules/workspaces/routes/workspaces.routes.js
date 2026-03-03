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
  listInvitesController,
  resendInviteController,
  revokeInviteController
} from '../controllers/workspaces.controller.js';
import {
  acceptInviteValidator,
  createInviteValidator,
  inviteByIdValidator,
  listInvitesValidator
} from '../validators/workspaces.validators.js';

const router = Router();

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
