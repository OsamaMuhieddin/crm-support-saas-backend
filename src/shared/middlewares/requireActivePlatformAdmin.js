import { loadActivePlatformAdminContext } from '../services/platform-auth-context.service.js';

export const requireActivePlatformAdmin = async (req, res, next) => {
  try {
    req.platformAdmin = await loadActivePlatformAdminContext({
      platformAdminId: req?.platformAuth?.platformAdminId,
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireActivePlatformAdmin;
