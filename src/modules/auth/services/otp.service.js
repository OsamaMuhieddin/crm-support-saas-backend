import { OtpCode } from '../../users/models/otp-code.model.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import { generateOtpCode, hashValue } from '../../../shared/utils/security.js';
import { authConfig } from '../../../config/auth.config.js';

const getCooldownBoundary = (latestOtp) => {
  if (!latestOtp?.lastSentAt) {
    return null;
  }

  return (
    latestOtp.lastSentAt.getTime() + authConfig.otp.resendCooldownSeconds * 1000
  );
};

const normalizeScopeKey = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const assertOtpSendRateLimit = async ({
  emailNormalized,
  purpose,
  scopeKey = null,
  now
}) => {
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const latestOtp = await OtpCode.findOne({
    emailNormalized,
    purpose,
    scopeKey: normalizedScopeKey
  })
    .sort({ createdAt: -1 })
    .select('lastSentAt');

  const cooldownBoundary = getCooldownBoundary(latestOtp);
  if (cooldownBoundary && now.getTime() < cooldownBoundary) {
    throw createError('errors.otp.resendTooSoon', 429);
  }

  const windowStart = new Date(
    now.getTime() - authConfig.otp.rateLimitWindowMinutes * 60 * 1000
  );

  const sentInWindow = await OtpCode.countDocuments({
    emailNormalized,
    purpose,
    scopeKey: normalizedScopeKey,
    createdAt: { $gte: windowStart }
  });

  if (sentInWindow >= authConfig.otp.rateLimitMaxPerWindow) {
    throw createError('errors.otp.rateLimited', 429);
  }
};

export const createOtp = async ({
  email,
  userId = null,
  purpose,
  scopeKey = null
}) => {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    throw createError('errors.validation.failed', 422, [
      buildValidationError('email', 'errors.validation.invalidEmail')
    ]);
  }

  const now = new Date();
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  await assertOtpSendRateLimit({
    emailNormalized,
    purpose,
    scopeKey: normalizedScopeKey,
    now
  });

  const code = generateOtpCode(6);
  const otpCode = await OtpCode.create({
    email,
    emailNormalized,
    userId,
    purpose,
    scopeKey: normalizedScopeKey,
    codeHash: hashValue(code),
    expiresAt: new Date(now.getTime() + authConfig.otp.expiresMinutes * 60 * 1000),
    consumedAt: null,
    attemptCount: 0,
    lastSentAt: now
  });

  return {
    code,
    otpCode
  };
};

export const verifyOtp = async ({ email, purpose, code, scopeKey = null }) => {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    throw createError('errors.validation.failed', 422, [
      buildValidationError('email', 'errors.validation.invalidEmail')
    ]);
  }

  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const otpCode = await OtpCode.findOne({
    emailNormalized,
    purpose,
    scopeKey: normalizedScopeKey,
    consumedAt: null
  }).sort({ createdAt: -1 });

  if (!otpCode) {
    throw createError('errors.validation.failed', 422, [
      buildValidationError('code', 'errors.otp.invalid')
    ]);
  }

  const now = new Date();

  if (otpCode.expiresAt.getTime() <= now.getTime()) {
    throw createError('errors.validation.failed', 422, [
      buildValidationError('code', 'errors.otp.expired')
    ]);
  }

  if (otpCode.attemptCount >= authConfig.otp.maxAttempts) {
    throw createError('errors.otp.tooManyAttempts', 429);
  }

  const incomingHash = hashValue(code);
  if (incomingHash !== otpCode.codeHash) {
    otpCode.attemptCount += 1;
    await otpCode.save();

    if (otpCode.attemptCount >= authConfig.otp.maxAttempts) {
      throw createError('errors.otp.tooManyAttempts', 429);
    }

    throw createError('errors.validation.failed', 422, [
      buildValidationError('code', 'errors.otp.invalid')
    ]);
  }

  otpCode.consumedAt = now;
  await otpCode.save();

  return otpCode;
};
