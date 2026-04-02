import { BILLING_PROVIDER_VALUES } from '../constants/billing-provider.js';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const toTrimmedString = (value, fallback = null) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const billingConfig = Object.freeze({
  enabled: toBool(process.env.BILLING_ENABLED, true),
  trialDays: Math.max(0, toInt(process.env.BILLING_TRIAL_DAYS, 14)),
  devTestCatalogLimitsEnabled: toBool(
    process.env.BILLING_DEV_TEST_CATALOG_LIMITS,
    false
  ),
  provider: toTrimmedString(
    process.env.BILLING_PROVIDER,
    'stripe'
  ).toLowerCase(),
  currency: toTrimmedString(process.env.BILLING_CURRENCY, 'USD').toUpperCase(),
  graceDays: Math.max(0, toInt(process.env.BILLING_GRACE_DAYS, 7)),
  catalogVersion: toTrimmedString(process.env.BILLING_CATALOG_VERSION, 'v1'),
  stripe: {
    secretKey: toTrimmedString(process.env.STRIPE_SECRET_KEY, null),
    webhookSecret: toTrimmedString(process.env.STRIPE_WEBHOOK_SECRET, null),
    checkoutSuccessUrl: toTrimmedString(
      process.env.STRIPE_CHECKOUT_SUCCESS_URL,
      null
    ),
    checkoutCancelUrl: toTrimmedString(
      process.env.STRIPE_CHECKOUT_CANCEL_URL,
      null
    ),
    portalReturnUrl: toTrimmedString(
      process.env.STRIPE_PORTAL_RETURN_URL,
      null
    ),
    prices: {
      starter: toTrimmedString(process.env.STRIPE_PRICE_STARTER_MONTHLY, null),
      growth: toTrimmedString(process.env.STRIPE_PRICE_GROWTH_MONTHLY, null),
      business: toTrimmedString(
        process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
        null
      ),
      extra_seat: toTrimmedString(
        process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY,
        null
      ),
      extra_storage: toTrimmedString(
        process.env.STRIPE_PRICE_EXTRA_STORAGE_MONTHLY,
        null
      ),
    },
  },
});

if (!BILLING_PROVIDER_VALUES.includes(billingConfig.provider)) {
  throw new Error(
    `Invalid BILLING_PROVIDER "${billingConfig.provider}". Expected one of: ${BILLING_PROVIDER_VALUES.join(', ')}`
  );
}
