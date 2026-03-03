import { MEMBER_STATUS } from '../../constants/member-status.js';
import { WorkspaceMember } from '../../modules/workspaces/models/workspace-member.model.js';
import { createError } from '../errors/createError.js';

export const requireActiveMember = async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.workspaceId || !auth?.userId) {
      throw createError('errors.auth.invalidToken', 401);
    }

    const member = await WorkspaceMember.findOne({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      status: MEMBER_STATUS.ACTIVE,
      deletedAt: null
    })
      .select('_id workspaceId userId roleKey status')
      .lean();

    if (!member) {
      throw createError('errors.auth.forbiddenTenant', 403);
    }

    req.member = {
      _id: String(member._id),
      workspaceId: String(member.workspaceId),
      userId: String(member.userId),
      roleKey: member.roleKey,
      status: member.status
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireActiveMember;
