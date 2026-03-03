import { User } from '../../modules/users/models/user.model.js';
import { createError } from '../errors/createError.js';

export const requireActiveUser = async (req, res, next) => {
  try {
    const userId = req?.auth?.userId;
    if (!userId) {
      throw createError('errors.auth.invalidToken', 401);
    }

    const user = await User.findOne({
      _id: userId,
      deletedAt: null
    })
      .select('_id status')
      .lean();

    if (!user) {
      throw createError('errors.auth.invalidToken', 401);
    }

    if (user.status !== 'active') {
      throw createError('errors.auth.userSuspended', 403);
    }

    req.currentUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireActiveUser;
