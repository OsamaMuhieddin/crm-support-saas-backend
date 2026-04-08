import bcrypt from 'bcryptjs';
import { authConfig } from '../../../config/auth.config.js';
import { createError } from '../../../shared/errors/createError.js';
import { PlatformAdmin } from '../../platform/models/platform-admin.model.js';
import { PlatformSession } from '../../platform/models/platform-session.model.js';
import {
  createPlatformSessionWithTokens,
  revokeAllPlatformAdminSessions,
  revokePlatformSessionById,
  rotatePlatformSessionTokens,
  validatePlatformRefreshSession,
} from './admin-session.service.js';

const buildSafePlatformAdmin = (platformAdmin) => ({
  _id: platformAdmin._id,
  email: platformAdmin.email,
  role: platformAdmin.role,
  status: platformAdmin.status,
  lastLoginAt: platformAdmin.lastLoginAt,
  createdAt: platformAdmin.createdAt,
  updatedAt: platformAdmin.updatedAt,
});

const findPlatformAdminByEmail = async (email) => {
  const normalizedEmail = String(email || '')
    .trim()
    .toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  return PlatformAdmin.findOne({ emailNormalized: normalizedEmail });
};

const assertActivePlatformAdmin = (platformAdmin) => {
  if (!platformAdmin) {
    throw createError('errors.platformAuth.invalidCredentials', 401);
  }

  if (platformAdmin.status !== 'active') {
    throw createError('errors.platformAuth.adminSuspended', 403);
  }
};

export const hashPlatformPassword = async (password) =>
  bcrypt.hash(password, authConfig.bcryptRounds);

export const loginPlatformAdmin = async ({
  email,
  password,
  ip,
  userAgent,
}) => {
  const platformAdmin = await findPlatformAdminByEmail(email);

  assertActivePlatformAdmin(platformAdmin);

  if (!platformAdmin.passwordHash) {
    throw createError('errors.platformAuth.invalidCredentials', 401);
  }

  const isPasswordCorrect = await bcrypt.compare(
    password,
    platformAdmin.passwordHash
  );

  if (!isPasswordCorrect) {
    throw createError('errors.platformAuth.invalidCredentials', 401);
  }

  const { tokens } = await createPlatformSessionWithTokens({
    platformAdminId: platformAdmin._id,
    roleKey: platformAdmin.role,
    ip,
    userAgent,
  });

  platformAdmin.lastLoginAt = new Date();
  await platformAdmin.save();

  return {
    platformAdmin: buildSafePlatformAdmin(platformAdmin),
    tokens,
  };
};

export const refreshPlatformAdmin = async ({ refreshToken }) => {
  const { payload, session } =
    await validatePlatformRefreshSession(refreshToken);

  const platformAdmin = await PlatformAdmin.findById(payload.sub);

  assertActivePlatformAdmin(platformAdmin);

  const tokens = await rotatePlatformSessionTokens({
    session,
    platformAdminId: platformAdmin._id,
    roleKey: platformAdmin.role,
  });

  return { tokens };
};

export const getPlatformAdminMe = async ({
  platformAdminId,
  platformSessionId,
}) => {
  const platformAdmin = await PlatformAdmin.findById(platformAdminId);

  if (!platformAdmin) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  const session = await PlatformSession.findOne({
    _id: platformSessionId,
    platformAdminId,
    revokedAt: null,
  })
    .select('_id expiresAt createdAt updatedAt')
    .lean();

  if (!session) {
    throw createError('errors.platformAuth.sessionRevoked', 401);
  }

  return {
    platformAdmin: buildSafePlatformAdmin(platformAdmin),
    session: {
      _id: String(session._id),
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  };
};

export const logoutPlatformAdmin = async ({ platformSessionId }) => {
  await revokePlatformSessionById(platformSessionId);
  return {};
};

export const logoutPlatformAdminAllSessions = async ({ platformAdminId }) => {
  await revokeAllPlatformAdminSessions(platformAdminId);
  return {};
};
