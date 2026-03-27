import { loadActiveUserContext } from '../services/auth-context.service.js';

export const requireActiveUser = async (req, res, next) => {
  try {
    req.currentUser = await loadActiveUserContext({
      userId: req?.auth?.userId,
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireActiveUser;
