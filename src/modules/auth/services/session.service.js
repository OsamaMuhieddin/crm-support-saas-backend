import mongoose from 'mongoose';
import { Session } from '../../users/models/session.model.js';
import { hashValue } from '../../../shared/utils/security.js';
import { createError } from '../../../shared/errors/createError.js';
import {
  getTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from './token.service.js';

const nowDate = () => new Date();

const listActiveSessionIds = async (query = {}) => {
  const sessions = await Session.find({
    ...query,
    revokedAt: null,
  })
    .select('_id')
    .lean();

  return sessions.map((session) => String(session._id));
};

const buildTokenPair = ({ userId, sessionId, workspaceId, roleKey }) => {
  const refreshToken = signRefreshToken({ userId, sessionId });
  const accessToken = signAccessToken({ userId, sessionId, workspaceId, roleKey });

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: getTokenExpiryDate(refreshToken)
  };
};

export const createSessionWithTokens = async ({
  userId,
  workspaceId,
  roleKey,
  ip,
  userAgent
}) => {
  const sessionId = new mongoose.Types.ObjectId();
  const tokens = buildTokenPair({ userId, sessionId, workspaceId, roleKey });

  const session = await Session.create({
    _id: sessionId,
    userId,
    workspaceId,
    refreshTokenHash: hashValue(tokens.refreshToken),
    userAgent: userAgent || null,
    ip: ip || null,
    expiresAt: tokens.refreshExpiresAt
  });

  return {
    session,
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }
  };
};

export const mintAccessTokenForSession = async ({
  sessionId,
  userId,
  workspaceId,
  roleKey
}) => {
  const session = await Session.findOne({
    _id: sessionId,
    userId,
    revokedAt: null,
    expiresAt: { $gt: nowDate() }
  })
    .select('_id')
    .lean();

  if (!session) {
    throw createError('errors.auth.sessionRevoked', 401);
  }

  return signAccessToken({
    userId,
    sessionId,
    workspaceId,
    roleKey
  });
};

export const validateRefreshSession = async (refreshToken) => {
  const payload = verifyRefreshToken(refreshToken);

  if (!payload?.sid || !payload?.sub) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const session = await Session.findOne({
    _id: payload.sid,
    userId: payload.sub
  });
  if (!session) {
    throw createError('errors.auth.sessionRevoked', 401);
  }

  if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw createError('errors.auth.sessionRevoked', 401);
  }

  const incomingHash = hashValue(refreshToken);
  if (incomingHash !== session.refreshTokenHash) {
    if (!session.revokedAt) {
      session.revokedAt = nowDate();
      await session.save();
    }

    throw createError('errors.auth.sessionRevoked', 401);
  }

  return {
    payload,
    session
  };
};

export const rotateSessionTokens = async ({
  session,
  userId,
  workspaceId,
  roleKey
}) => {
  const sessionId = session._id;
  const tokens = buildTokenPair({ userId, sessionId, workspaceId, roleKey });

  session.refreshTokenHash = hashValue(tokens.refreshToken);
  session.expiresAt = tokens.refreshExpiresAt;
  session.workspaceId = workspaceId;

  await session.save();

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
};

export const revokeSessionById = async (sessionId) => {
  const revokedSessionIds = await listActiveSessionIds({
    _id: sessionId,
  });

  if (revokedSessionIds.length === 0) {
    return [];
  }

  await Session.updateMany(
    {
      _id: {
        $in: revokedSessionIds,
      },
      revokedAt: null
    },
    {
      $set: {
        revokedAt: nowDate()
      }
    }
  );

  return revokedSessionIds;
};

export const revokeAllUserSessions = async (userId) => {
  const revokedSessionIds = await listActiveSessionIds({
    userId,
  });

  if (revokedSessionIds.length === 0) {
    return [];
  }

  await Session.updateMany(
    {
      _id: {
        $in: revokedSessionIds,
      },
      revokedAt: null
    },
    {
      $set: {
        revokedAt: nowDate()
      }
    }
  );

  return revokedSessionIds;
};
