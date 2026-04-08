import { createError } from '../errors/createError.js';

export const requirePlatformRole = (...allowedRoles) => {
  const allowedSet = new Set(
    allowedRoles
      .filter((role) => typeof role === 'string' && role.trim())
      .map((role) => role.trim().toLowerCase())
  );

  return (req, res, next) => {
    try {
      const roleKey = req?.platformAdmin?.role || req?.platformAuth?.roleKey;

      if (!roleKey || !allowedSet.has(String(roleKey).toLowerCase())) {
        throw createError('errors.platformAuth.forbiddenRole', 403);
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export default requirePlatformRole;
