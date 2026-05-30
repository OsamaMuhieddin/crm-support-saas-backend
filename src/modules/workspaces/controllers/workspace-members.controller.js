import { assertTenantAccess } from '../services/workspaces.service.js';
import {
  activateWorkspaceMember,
  getWorkspaceMemberByUserId,
  listWorkspaceMemberOptions,
  listWorkspaceMembers,
  removeWorkspaceMember,
  suspendWorkspaceMember,
  updateWorkspaceMemberRole,
} from '../services/workspace-members.service.js';

export const listWorkspaceMembersController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await listWorkspaceMembers({
      workspaceId: req.params.workspaceId,
      actorRoleKey: req.member.roleKey,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      roleKey: req.query.roleKey,
      status: req.query.status,
      assignable: req.query.assignable,
      participantEligible: req.query.participantEligible,
      includeRemoved: req.query.includeRemoved,
      sort: req.query.sort,
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const listWorkspaceMemberOptionsController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await listWorkspaceMemberOptions({
      workspaceId: req.params.workspaceId,
      actorRoleKey: req.member.roleKey,
      q: req.query.q,
      search: req.query.search,
      roleKey: req.query.roleKey,
      status: req.query.status,
      assignable: req.query.assignable,
      participantEligible: req.query.participantEligible,
      includeRemoved: req.query.includeRemoved,
      limit: req.query.limit,
      sort: req.query.sort,
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const getWorkspaceMemberController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await getWorkspaceMemberByUserId({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
      actorRoleKey: req.member.roleKey,
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const updateWorkspaceMemberRoleController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await updateWorkspaceMemberRole({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
      actorUserId: req.auth.userId,
      actorRoleKey: req.member.roleKey,
      roleKey: req.body.roleKey,
    });

    return res.json({
      messageKey: 'success.workspace.memberUpdated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const suspendWorkspaceMemberController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await suspendWorkspaceMember({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
      actorUserId: req.auth.userId,
      actorRoleKey: req.member.roleKey,
    });

    return res.json({
      messageKey: 'success.workspace.memberSuspended',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateWorkspaceMemberController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await activateWorkspaceMember({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
      actorUserId: req.auth.userId,
      actorRoleKey: req.member.roleKey,
    });

    return res.json({
      messageKey: 'success.workspace.memberActivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const removeWorkspaceMemberController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await removeWorkspaceMember({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
      actorUserId: req.auth.userId,
      actorRoleKey: req.member.roleKey,
    });

    return res.json({
      messageKey: 'success.workspace.memberRemoved',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
