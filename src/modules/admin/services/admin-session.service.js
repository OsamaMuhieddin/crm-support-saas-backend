import mongoose from 'mongoose';
import { hashValue } from '../../../shared/utils/security.js';
import { createError } from '../../../shared/errors/createError.js';
import { PlatformSession } from '../../platform/models/platform-session.model.js';
import {
  getPlatformTokenExpiryDate,
  signPlatformAccessToken,
  signPlatformRefreshToken,
  verifyPlatformRefreshToken,
} from './admin-token.service.js';

const nowDate = () => new Date();

const listActivePlatformSessionIds = async (query = {}) => {
  const sessions = await PlatformSession.find({
    ...query,
    revokedAt: null,
  })
    .select('_id')
    .lean();

  return sessions.map((session) => String(session._id));
};

const buildPlatformTokenPair = ({
  platformAdminId,
  platformSessionId,
  roleKey,
}) => {
  const refreshToken = signPlatformRefreshToken({
    platformAdminId,
    platformSessionId,
  });
  const accessToken = signPlatformAccessToken({
    platformAdminId,
    platformSessionId,
    roleKey,
  });

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: getPlatformTokenExpiryDate(refreshToken),
  };
};

export const createPlatformSessionWithTokens = async ({
  platformAdminId,
  roleKey,
  ip,
  userAgent,
}) => {
  const platformSessionId = new mongoose.Types.ObjectId();
  const tokens = buildPlatformTokenPair({
    platformAdminId,
    platformSessionId,
    roleKey,
  });

  const session = await PlatformSession.create({
    _id: platformSessionId,
    platformAdminId,
    refreshTokenHash: hashValue(tokens.refreshToken),
    userAgent: userAgent || null,
    ip: ip || null,
    expiresAt: tokens.refreshExpiresAt,
  });

  return {
    session,
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
  };
};

export const validatePlatformRefreshSession = async (refreshToken) => {
  const payload = verifyPlatformRefreshToken(refreshToken);

  if (!payload?.psid || !payload?.sub) {
    throw createError('errors.platformAuth.invalidToken', 401);
  }

  const session = await PlatformSession.findOne({
    _id: payload.psid,
    platformAdminId: payload.sub,
  });

  if (!session) {
    throw createError('errors.platformAuth.sessionRevoked', 401);
  }

  if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw createError('errors.platformAuth.sessionRevoked', 401);
  }

  const incomingHash = hashValue(refreshToken);

  if (incomingHash !== session.refreshTokenHash) {
    if (!session.revokedAt) {
      session.revokedAt = nowDate();
      await session.save();
    }

    throw createError('errors.platformAuth.sessionRevoked', 401);
  }

  return {
    payload,
    session,
  };
};

export const rotatePlatformSessionTokens = async ({
  session,
  platformAdminId,
  roleKey,
}) => {
  const tokens = buildPlatformTokenPair({
    platformAdminId,
    platformSessionId: session._id,
    roleKey,
  });

  session.refreshTokenHash = hashValue(tokens.refreshToken);
  session.expiresAt = tokens.refreshExpiresAt;

  await session.save();

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
};

export const revokePlatformSessionById = async (platformSessionId) => {
  const revokedSessionIds = await listActivePlatformSessionIds({
    _id: platformSessionId,
  });

  if (revokedSessionIds.length === 0) {
    return [];
  }

  await PlatformSession.updateMany(
    {
      _id: {
        $in: revokedSessionIds,
      },
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: nowDate(),
      },
    }
  );

  return revokedSessionIds;
};

export const revokeAllPlatformAdminSessions = async (platformAdminId) => {
  const revokedSessionIds = await listActivePlatformSessionIds({
    platformAdminId,
  });

  if (revokedSessionIds.length === 0) {
    return [];
  }

  await PlatformSession.updateMany(
    {
      _id: {
        $in: revokedSessionIds,
      },
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: nowDate(),
      },
    }
  );

  return revokedSessionIds;
};
