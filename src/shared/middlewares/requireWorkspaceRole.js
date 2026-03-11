import { createError } from '../errors/createError.js';

export const requireWorkspaceRole = (...allowedRoles) => {
  const allowedSet = new Set(
    allowedRoles
      .filter((role) => typeof role === 'string' && role.trim())
      .map((role) => role.trim().toLowerCase())
  );

  return (req, res, next) => {
    try {
      const roleKey = req?.member?.roleKey;
      if (!roleKey || !allowedSet.has(String(roleKey).toLowerCase())) {
        throw createError('errors.auth.forbiddenRole', 403);
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export default requireWorkspaceRole;
