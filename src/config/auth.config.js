import { env } from './env.js';

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const defaultIfEmpty = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const authConfig = {
  jwt: {
    accessSecret: defaultIfEmpty(
      process.env.JWT_ACCESS_SECRET,
      'dev-access-secret-change-me'
    ),
    refreshSecret: defaultIfEmpty(
      process.env.JWT_REFRESH_SECRET,
      'dev-refresh-secret-change-me'
    ),
    accessExpiresIn: defaultIfEmpty(process.env.JWT_ACCESS_EXPIRES_IN, '15m'),
    refreshExpiresIn: defaultIfEmpty(process.env.JWT_REFRESH_EXPIRES_IN, '30d'),
    issuer: defaultIfEmpty(process.env.JWT_ISSUER, 'crm-support-saas-backend'),
    audience: defaultIfEmpty(process.env.JWT_AUDIENCE, 'crm-support-saas')
  },
  bcryptRounds: parseInteger(process.env.AUTH_BCRYPT_ROUNDS, 12),
  otp: {
    expiresMinutes: parseInteger(process.env.OTP_EXPIRES_MINUTES, 10),
    resendCooldownSeconds: parseInteger(
      process.env.OTP_RESEND_COOLDOWN_SECONDS,
      60
    ),
    maxAttempts: parseInteger(process.env.OTP_MAX_ATTEMPTS, 5),
    rateLimitWindowMinutes: parseInteger(
      process.env.OTP_RATE_LIMIT_WINDOW_MINUTES,
      15
    ),
    rateLimitMaxPerWindow: parseInteger(
      process.env.OTP_RATE_LIMIT_MAX_PER_WINDOW,
      5
    )
  },
  invites: {
    expiresDays: parseInteger(process.env.INVITE_EXPIRES_DAYS, 7)
  },
  email: {
    sendgridApiKey: defaultIfEmpty(process.env.SENDGRID_API_KEY, null),
    from: defaultIfEmpty(process.env.EMAIL_FROM, null),
    smtp: {
      host: defaultIfEmpty(process.env.NODEMAILER_HOST, null),
      port: parseInteger(process.env.NODEMAILER_PORT, 587),
      user: defaultIfEmpty(process.env.NODEMAILER_USER, null),
      pass: defaultIfEmpty(process.env.NODEMAILER_PASS, null)
    }
  },
  appBaseUrl: defaultIfEmpty(process.env.APP_BASE_URL, 'http://localhost:5000'),
  frontendBaseUrl: defaultIfEmpty(
    process.env.FRONTEND_BASE_URL,
    'http://localhost:5173'
  ),
  environment: env.NODE_ENV
};
