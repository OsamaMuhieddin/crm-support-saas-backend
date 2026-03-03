import {
  acceptWorkspaceInvite,
  assertTenantAccess,
  createWorkspaceInvite,
  getWorkspaceInviteById,
  listWorkspaceInvites,
  resendWorkspaceInvite,
  revokeWorkspaceInvite
} from '../services/workspaces.service.js';

export const createInviteController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await createWorkspaceInvite({
      workspaceId: req.params.workspaceId,
      email: req.body.email,
      roleKey: req.body.roleKey,
      invitedByUserId: req.auth.userId
    });

    return res.json({
      messageKey: 'success.invite.created',
      ...data
    });
  } catch (error) {
    return next(error);
  }
};

export const listInvitesController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await listWorkspaceInvites({
      workspaceId: req.params.workspaceId,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const getInviteController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    const data = await getWorkspaceInviteById({
      workspaceId: req.params.workspaceId,
      inviteId: req.params.inviteId
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const resendInviteController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    await resendWorkspaceInvite({
      workspaceId: req.params.workspaceId,
      inviteId: req.params.inviteId
    });

    return res.json({ messageKey: 'success.invite.resent' });
  } catch (error) {
    return next(error);
  }
};

export const revokeInviteController = async (req, res, next) => {
  try {
    assertTenantAccess(req.params.workspaceId, req.auth.workspaceId);

    await revokeWorkspaceInvite({
      workspaceId: req.params.workspaceId,
      inviteId: req.params.inviteId,
      revokedByUserId: req.auth.userId
    });

    return res.json({ messageKey: 'success.invite.revoked' });
  } catch (error) {
    return next(error);
  }
};

export const acceptInviteController = async (req, res, next) => {
  try {
    const data = await acceptWorkspaceInvite(req.body);

    return res.json({
      messageKey: data.accepted
        ? 'success.invite.accepted'
        : 'success.invite.acceptRequiresVerification'
    });
  } catch (error) {
    return next(error);
  }
};
