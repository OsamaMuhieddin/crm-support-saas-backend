import {
  extendAdminWorkspaceTrial,
  getAdminWorkspaceById,
  listAdminWorkspaces,
  reactivateAdminWorkspace,
  suspendAdminWorkspace,
} from '../services/admin-workspaces.service.js';

export const listAdminWorkspacesController = async (req, res, next) => {
  try {
    const data = await listAdminWorkspaces({
      platformAdmin: req.platformAdmin,
      query: req.query,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminWorkspaceByIdController = async (req, res, next) => {
  try {
    const data = await getAdminWorkspaceById({
      platformAdmin: req.platformAdmin,
      workspaceId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const suspendAdminWorkspaceController = async (req, res, next) => {
  try {
    const data = await suspendAdminWorkspace({
      platformAdmin: req.platformAdmin,
      workspaceId: req.params.id,
    });

    return res.json({
      messageKey: 'success.admin.workspaceSuspended',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const reactivateAdminWorkspaceController = async (req, res, next) => {
  try {
    const data = await reactivateAdminWorkspace({
      platformAdmin: req.platformAdmin,
      workspaceId: req.params.id,
    });

    return res.json({
      messageKey: 'success.admin.workspaceReactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const extendAdminWorkspaceTrialController = async (req, res, next) => {
  try {
    const data = await extendAdminWorkspaceTrial({
      platformAdmin: req.platformAdmin,
      workspaceId: req.params.id,
      days: req.body.days,
    });

    return res.json({
      messageKey: 'success.admin.workspaceTrialExtended',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
