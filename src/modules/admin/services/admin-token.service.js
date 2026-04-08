import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { authConfig } from '../../../config/auth.config.js';
import { createError } from '../../../shared/errors/createError.js';

const platformJwtSignOptions = {
  issuer: authConfig.jwt.issuer,
  audience: `${authConfig.jwt.audience}:platform-admin`,
};

export const signPlatformAccessToken = ({
  platformAdminId,
  platformSessionId,
  roleKey,
}) =>
  jwt.sign(
    {
      sub: String(platformAdminId),
      psid: String(platformSessionId),
      r: String(roleKey),
      typ: 'platform_access',
      ver: 1,
    },
    authConfig.jwt.accessSecret,
    {
      ...platformJwtSignOptions,
      expiresIn: authConfig.jwt.accessExpiresIn,
    }
  );

export const signPlatformRefreshToken = ({
  platformAdminId,
  platformSessionId,
}) =>
  jwt.sign(
    {
      sub: String(platformAdminId),
      psid: String(platformSessionId),
      jti: randomUUID(),
      typ: 'platform_refresh',
      ver: 1,
    },
    authConfig.jwt.refreshSecret,
    {
      ...platformJwtSignOptions,
      expiresIn: authConfig.jwt.refreshExpiresIn,
    }
  );

export const verifyPlatformRefreshToken = (refreshToken) => {
  try {
    const payload = jwt.verify(refreshToken, authConfig.jwt.refreshSecret, {
      issuer: authConfig.jwt.issuer,
      audience: `${authConfig.jwt.audience}:platform-admin`,
    });

    if (!payload || payload.typ !== 'platform_refresh' || payload.ver !== 1) {
      throw new Error('Invalid platform refresh token payload');
    }

    return payload;
  } catch (error) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }
};

export const getPlatformTokenExpiryDate = (token) => {
  const decoded = jwt.decode(token);

  if (!decoded || typeof decoded.exp !== 'number') {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  return new Date(decoded.exp * 1000);
};
