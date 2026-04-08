import jwt from 'jsonwebtoken';
import { authConfig } from '../../config/auth.config.js';
import { PlatformSession } from '../../modules/platform/models/platform-session.model.js';
import { PlatformAdmin } from '../../modules/platform/models/platform-admin.model.js';
import { createError } from '../errors/createError.js';

const bearerPrefix = 'Bearer ';
const platformJwtAudience = `${authConfig.jwt.audience}:platform-admin`;

export const parsePlatformBearerToken = (authHeader) => {
  if (typeof authHeader !== 'string' || !authHeader.startsWith(bearerPrefix)) {
    return null;
  }

  const token = authHeader.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
};

export const verifyPlatformAccessToken = (token) =>
  jwt.verify(token, authConfig.jwt.accessSecret, {
    issuer: authConfig.jwt.issuer,
    audience: platformJwtAudience,
  });

export const assertPlatformAccessTokenPayload = (payload) => {
  if (
    !payload ||
    payload.typ !== 'platform_access' ||
    payload.ver !== 1 ||
    !payload.sub ||
    !payload.psid ||
    !payload.r
  ) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  return payload;
};

export const resolvePlatformAccessAuthContext = async (token) => {
  if (!token || typeof token !== 'string') {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  let payload = null;

  try {
    payload = verifyPlatformAccessToken(token);
  } catch (error) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  assertPlatformAccessTokenPayload(payload);

  const session = await PlatformSession.findById(payload.psid)
    .select('_id platformAdminId revokedAt expiresAt')
    .lean();

  const isSessionInvalid =
    !session ||
    String(session.platformAdminId) !== String(payload.sub) ||
    session.revokedAt ||
    new Date(session.expiresAt).getTime() <= Date.now();

  if (isSessionInvalid) {
    throw createError('errors.platformAuth.sessionRevoked', 401);
  }

  return {
    payload,
    session,
    platformAuth: {
      platformAdminId: String(payload.sub),
      platformSessionId: String(payload.psid),
      roleKey: String(payload.r),
    },
  };
};

export const resolvePlatformAccessAuthContextFromHeader = async (
  authorizationHeader
) => {
  const token = parsePlatformBearerToken(authorizationHeader);

  if (!token) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  return resolvePlatformAccessAuthContext(token);
};

export const loadActivePlatformAdminContext = async ({ platformAdminId }) => {
  if (!platformAdminId) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  const platformAdmin = await PlatformAdmin.findById(platformAdminId)
    .select('_id email role status lastLoginAt createdAt updatedAt')
    .lean();

  if (!platformAdmin) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  if (platformAdmin.status !== 'active') {
    throw createError('errors.platformAuth.adminSuspended', 403);
  }

  return platformAdmin;
};
