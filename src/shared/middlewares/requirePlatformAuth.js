import { resolvePlatformAccessAuthContextFromHeader } from '../services/platform-auth-context.service.js';

export const requirePlatformAuth = async (req, res, next) => {
  try {
    const { platformAuth } = await resolvePlatformAccessAuthContextFromHeader(
      req.headers.authorization
    );

    req.platformAuth = platformAuth;

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requirePlatformAuth;
