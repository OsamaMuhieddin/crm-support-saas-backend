import { resolveAccessAuthContextFromHeader } from '../services/auth-context.service.js';

export const requireAuth = async (req, res, next) => {
  try {
    const { auth } = await resolveAccessAuthContextFromHeader(
      req.headers.authorization
    );

    req.auth = auth;

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireAuth;
