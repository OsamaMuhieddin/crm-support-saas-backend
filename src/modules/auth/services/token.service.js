import jwt from 'jsonwebtoken';
import { createError } from '../../../shared/errors/createError.js';
import { authConfig } from '../../../config/auth.config.js';

const jwtSignOptions = {
  issuer: authConfig.jwt.issuer,
  audience: authConfig.jwt.audience
};

export const signAccessToken = ({ userId, sessionId, workspaceId, roleKey }) =>
  jwt.sign(
    {
      sub: String(userId),
      sid: String(sessionId),
      wid: String(workspaceId),
      r: String(roleKey),
      typ: 'access',
      ver: 1
    },
    authConfig.jwt.accessSecret,
    {
      ...jwtSignOptions,
      expiresIn: authConfig.jwt.accessExpiresIn
    }
  );

export const signRefreshToken = ({ userId, sessionId }) =>
  jwt.sign(
    {
      sub: String(userId),
      sid: String(sessionId),
      typ: 'refresh',
      ver: 1
    },
    authConfig.jwt.refreshSecret,
    {
      ...jwtSignOptions,
      expiresIn: authConfig.jwt.refreshExpiresIn
    }
  );

export const verifyRefreshToken = (refreshToken) => {
  try {
    const payload = jwt.verify(refreshToken, authConfig.jwt.refreshSecret, {
      issuer: authConfig.jwt.issuer,
      audience: authConfig.jwt.audience
    });

    if (!payload || payload.typ !== 'refresh' || payload.ver !== 1) {
      throw new Error('Invalid refresh token payload');
    }

    return payload;
  } catch (error) {
    throw createError('errors.auth.invalidToken', 401);
  }
};

export const getTokenExpiryDate = (token) => {
  const decoded = jwt.decode(token);

  if (!decoded || typeof decoded.exp !== 'number') {
    throw createError('errors.auth.invalidToken', 401);
  }

  return new Date(decoded.exp * 1000);
};
