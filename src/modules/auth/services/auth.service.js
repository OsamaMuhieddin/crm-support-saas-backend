import bcrypt from 'bcryptjs';
import { OTP_PURPOSE } from '../../../constants/otp-purpose.js';
import { User } from '../../users/models/user.model.js';
import { Session } from '../../users/models/session.model.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import { authConfig } from '../../../config/auth.config.js';
import { sendOtpEmailFireAndForget } from '../../../shared/services/email.service.js';
import { createOtp, verifyOtp } from './otp.service.js';
import {
  createSessionWithTokens,
  revokeAllUserSessions,
  revokeSessionById,
  rotateSessionTokens,
  validateRefreshSession,
} from './session.service.js';
import {
  ensureWorkspaceForVerifiedUser,
  getActiveWorkspaceContext,
} from '../../workspaces/services/workspaces.service.js';
import { disconnectRealtimeSessionSocketsBatch } from '../../../infra/realtime/index.js';

const buildSafeUser = (user) => ({
  _id: user._id,
  email: user.email,
  isEmailVerified: user.isEmailVerified,
  profile: user.profile,
  status: user.status,
  defaultWorkspaceId: user.defaultWorkspaceId,
  lastWorkspaceId: user.lastWorkspaceId,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const hashPassword = async (password) =>
  bcrypt.hash(password, authConfig.bcryptRounds);

const findActiveUserByEmail = async (email) => {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    return null;
  }

  return User.findOne({ emailNormalized, deletedAt: null });
};

const assertActiveNonSuspendedUser = (user) => {
  if (!user || user.deletedAt) {
    throw createError('errors.auth.invalidCredentials', 401);
  }

  if (user.status !== 'active') {
    throw createError('errors.auth.userSuspended', 403);
  }
};

const disconnectRevokedRealtimeSessions = async (sessionIds = []) => {
  await disconnectRealtimeSessionSocketsBatch({
    sessionIds,
  });
};

export const signup = async ({ email, password, name }) => {
  const emailNormalized = normalizeEmail(email);

  let user = await User.findOne({ emailNormalized });

  if (user && user.isEmailVerified) {
    throw createError('errors.auth.emailAlreadyUsed', 409);
  }

  if (!user) {
    user = await User.create({
      email,
      emailNormalized,
      passwordHash: await hashPassword(password),
      profile: {
        name: name || null,
      },
    });
  } else {
    let hasChanges = false;

    if (!user.passwordHash && password) {
      user.passwordHash = await hashPassword(password);
      hasChanges = true;
    }

    if (!user.profile?.name && name) {
      user.profile = {
        ...user.profile,
        name,
      };
      hasChanges = true;
    }

    if (hasChanges) {
      await user.save();
    }
  }

  const otpResult = await createOtp({
    email: user.email,
    userId: user._id,
    purpose: OTP_PURPOSE.VERIFY_EMAIL,
  });

  sendOtpEmailFireAndForget({
    to: user.email,
    purpose: OTP_PURPOSE.VERIFY_EMAIL,
    code: otpResult.code,
  });

  return {};
};

export const resendOtp = async ({ email, purpose }) => {
  const user = await findActiveUserByEmail(email);

  if (purpose === OTP_PURPOSE.RESET_PASSWORD) {
    const isEligible = Boolean(
      user?.isEmailVerified && user?.status === 'active' && !user?.deletedAt
    );

    if (!isEligible) {
      return {};
    }

    const otpResult = await createOtp({
      email: user.email,
      userId: user._id,
      purpose,
    });

    sendOtpEmailFireAndForget({
      to: user.email,
      purpose,
      code: otpResult.code,
    });

    return {};
  }

  if (purpose === OTP_PURPOSE.VERIFY_EMAIL) {
    const isEligible = Boolean(
      user &&
      !user.isEmailVerified &&
      user.status === 'active' &&
      !user.deletedAt
    );

    if (!isEligible) {
      return {};
    }

    const otpResult = await createOtp({
      email: user.email,
      userId: user._id,
      purpose,
    });

    sendOtpEmailFireAndForget({
      to: user.email,
      purpose,
      code: otpResult.code,
    });
  }

  // For unsupported/non-MVP resend purposes, keep silent success to avoid leakage.

  return {};
};

export const verifyEmailAndLogin = async ({
  email,
  code,
  inviteToken,
  ip,
  userAgent,
}) => {
  const otpRecord = await verifyOtp({
    email,
    purpose: OTP_PURPOSE.VERIFY_EMAIL,
    code,
  });

  const emailNormalized = normalizeEmail(email);

  let user =
    (otpRecord.userId && (await User.findById(otpRecord.userId))) ||
    (await User.findOne({ emailNormalized, deletedAt: null }));

  assertActiveNonSuspendedUser(user);

  if (!user.isEmailVerified) {
    user.isEmailVerified = true;
    await user.save();
  }

  const workspaceContext = await ensureWorkspaceForVerifiedUser({
    userId: user._id,
    inviteToken,
  });

  const { tokens } = await createSessionWithTokens({
    userId: user._id,
    workspaceId: workspaceContext.activeWorkspaceId,
    roleKey: workspaceContext.activeRoleKey,
    ip,
    userAgent,
  });

  user = await User.findById(user._id);
  user.lastLoginAt = new Date();
  await user.save();

  return {
    user: buildSafeUser(user),
    tokens,
    workspaceId:
      workspaceContext.inviteWorkspaceId || workspaceContext.activeWorkspaceId,
    activeWorkspaceId: workspaceContext.activeWorkspaceId,
    inviteWorkspaceId: workspaceContext.inviteWorkspaceId,
  };
};

export const login = async ({ email, password, ip, userAgent }) => {
  const user = await findActiveUserByEmail(email);
  assertActiveNonSuspendedUser(user);

  if (!user.passwordHash) {
    throw createError('errors.auth.invalidCredentials', 401);
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordCorrect) {
    throw createError('errors.auth.invalidCredentials', 401);
  }

  if (!user.isEmailVerified) {
    throw createError('errors.auth.emailNotVerified', 403);
  }

  const workspaceContext = await getActiveWorkspaceContext({
    userId: user._id,
  });

  const { tokens } = await createSessionWithTokens({
    userId: user._id,
    workspaceId: workspaceContext.workspaceId,
    roleKey: workspaceContext.roleKey,
    ip,
    userAgent,
  });

  user.lastWorkspaceId = workspaceContext.workspaceId;
  user.lastLoginAt = new Date();
  await user.save();

  return {
    user: buildSafeUser(user),
    tokens,
  };
};

export const refresh = async ({ refreshToken }) => {
  const { payload, session } = await validateRefreshSession(refreshToken);

  const user = await User.findOne({
    _id: payload.sub,
    deletedAt: null,
  });

  assertActiveNonSuspendedUser(user);

  if (!user.isEmailVerified) {
    throw createError('errors.auth.emailNotVerified', 403);
  }

  const workspaceContext = await getActiveWorkspaceContext({
    userId: user._id,
    sessionWorkspaceId: session.workspaceId,
  });

  const tokens = await rotateSessionTokens({
    session,
    userId: user._id,
    workspaceId: workspaceContext.workspaceId,
    roleKey: workspaceContext.roleKey,
  });

  return {
    tokens,
  };
};

export const forgotPassword = async ({ email }) => {
  const user = await findActiveUserByEmail(email);
  const isEligible = Boolean(
    user?.isEmailVerified && !user?.deletedAt && user?.status === 'active'
  );

  if (!isEligible) {
    return {};
  }

  try {
    const otpResult = await createOtp({
      email: user.email,
      userId: user._id,
      purpose: OTP_PURPOSE.RESET_PASSWORD,
    });

    sendOtpEmailFireAndForget({
      to: user.email,
      purpose: OTP_PURPOSE.RESET_PASSWORD,
      code: otpResult.code,
    });
  } catch (error) {
    // Keep response generic to avoid user enumeration.
  }

  return {};
};

export const resetPassword = async ({ email, code, newPassword }) => {
  await verifyOtp({
    email,
    purpose: OTP_PURPOSE.RESET_PASSWORD,
    code,
  });

  const user = await findActiveUserByEmail(email);
  assertActiveNonSuspendedUser(user);

  const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSamePassword) {
    throw createError('errors.validation.failed', 422, [
      buildValidationError('newPassword', 'errors.auth.passwordMustDiffer'),
    ]);
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  const revokedSessionIds = await revokeAllUserSessions(user._id);
  await disconnectRevokedRealtimeSessions(revokedSessionIds);

  return {};
};

export const getMe = async ({ userId, sessionId }) => {
  const user = await User.findOne({
    _id: userId,
    deletedAt: null,
  });

  if (!user) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const session = await Session.findOne({
    _id: sessionId,
    userId: user._id,
    revokedAt: null,
  })
    .select('workspaceId')
    .lean();

  const workspaceContext = await getActiveWorkspaceContext({
    userId: user._id,
    sessionWorkspaceId: session?.workspaceId || null,
  });

  return {
    user: buildSafeUser(user),
    workspace: {
      _id: workspaceContext.workspaceId,
      ...workspaceContext.workspace,
    },
    roleKey: workspaceContext.roleKey,
  };
};

export const logout = async ({ sessionId }) => {
  const revokedSessionIds = await revokeSessionById(sessionId);
  await disconnectRevokedRealtimeSessions(revokedSessionIds);
  return {};
};

export const logoutAll = async ({ userId }) => {
  const revokedSessionIds = await revokeAllUserSessions(userId);
  await disconnectRevokedRealtimeSessions(revokedSessionIds);
  return {};
};

export const changePassword = async ({
  userId,
  currentPassword,
  newPassword,
}) => {
  const user = await User.findOne({
    _id: userId,
    deletedAt: null,
  });

  if (!user) {
    throw createError('errors.auth.invalidToken', 401);
  }

  if (!user.passwordHash) {
    throw createError('errors.auth.invalidCredentials', 401);
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    currentPassword,
    user.passwordHash
  );

  if (!isCurrentPasswordValid) {
    throw createError('errors.auth.invalidCredentials', 401);
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  const revokedSessionIds = await revokeAllUserSessions(user._id);
  await disconnectRevokedRealtimeSessions(revokedSessionIds);

  return {};
};
