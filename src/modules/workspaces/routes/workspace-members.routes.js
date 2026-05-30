import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  activateWorkspaceMemberController,
  getWorkspaceMemberController,
  listWorkspaceMemberOptionsController,
  listWorkspaceMembersController,
  removeWorkspaceMemberController,
  suspendWorkspaceMemberController,
  updateWorkspaceMemberRoleController,
} from '../controllers/workspace-members.controller.js';
import {
  listWorkspaceMembersValidator,
  updateWorkspaceMemberRoleValidator,
  workspaceMemberByUserIdValidator,
  workspaceMemberOptionsValidator,
} from '../validators/workspace-members.validators.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  validate(listWorkspaceMembersValidator),
  listWorkspaceMembersController
);

router.get(
  '/options',
  validate(workspaceMemberOptionsValidator),
  listWorkspaceMemberOptionsController
);

router.get(
  '/:userId',
  validate(workspaceMemberByUserIdValidator),
  getWorkspaceMemberController
);

router.patch(
  '/:userId',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(updateWorkspaceMemberRoleValidator),
  updateWorkspaceMemberRoleController
);

router.post(
  '/:userId/suspend',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(workspaceMemberByUserIdValidator),
  suspendWorkspaceMemberController
);

router.post(
  '/:userId/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(workspaceMemberByUserIdValidator),
  activateWorkspaceMemberController
);

router.post(
  '/:userId/remove',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(workspaceMemberByUserIdValidator),
  removeWorkspaceMemberController
);

export default router;
