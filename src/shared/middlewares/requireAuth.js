import jwt from 'jsonwebtoken';
import { authConfig } from '../../config/auth.config.js';
import { createError } from '../errors/createError.js';
import { Session } from '../../modules/users/models/session.model.js';

const bearerPrefix = 'Bearer ';

const parseBearerToken = (authHeader) => {
  if (typeof authHeader !== 'string') {
    return null;
  }

  if (!authHeader.startsWith(bearerPrefix)) {
    return null;
  }

  const token = authHeader.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
};

const verifyAccessToken = (token) =>
  jwt.verify(token, authConfig.jwt.accessSecret, {
    issuer: authConfig.jwt.issuer,
    audience: authConfig.jwt.audience
  });

export const requireAuth = async (req, res, next) => {
  try {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      throw createError('errors.auth.invalidToken', 401);
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      throw createError('errors.auth.invalidToken', 401);
    }

    if (
      !payload ||
      payload.typ !== 'access' ||
      payload.ver !== 1 ||
      !payload.sub ||
      !payload.sid ||
      !payload.wid ||
      !payload.r
    ) {
      throw createError('errors.auth.invalidToken', 401);
    }

    const session = await Session.findById(payload.sid)
      .select('_id userId revokedAt expiresAt')
      .lean();

    const isSessionInvalid =
      !session ||
      String(session.userId) !== String(payload.sub) ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= Date.now();

    if (isSessionInvalid) {
      throw createError('errors.auth.sessionRevoked', 401);
    }

    req.auth = {
      userId: String(payload.sub),
      sessionId: String(payload.sid),
      workspaceId: String(payload.wid),
      roleKey: String(payload.r)
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireAuth;
