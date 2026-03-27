import { loadActiveMemberContext } from '../services/auth-context.service.js';

export const requireActiveMember = async (req, res, next) => {
  try {
    req.member = await loadActiveMemberContext({
      workspaceId: req?.auth?.workspaceId,
      userId: req?.auth?.userId,
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireActiveMember;
