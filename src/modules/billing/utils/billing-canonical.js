export const BILLING_PLAN_LIMIT_KEYS = Object.freeze({
  SEATS_INCLUDED: 'seatsIncluded',
  MAILBOXES: 'mailboxes',
  STORAGE_BYTES: 'storageBytes',
  UPLOADS_PER_MONTH: 'uploadsPerMonth',
  TICKETS_PER_MONTH: 'ticketsPerMonth',
});

export const BILLING_PLAN_FEATURE_KEYS = Object.freeze({
  BILLING_ENABLED: 'billingEnabled',
  PORTAL_ENABLED: 'portalEnabled',
  CHECKOUT_ENABLED: 'checkoutEnabled',
  SLA_ENABLED: 'slaEnabled',
});

export const BILLING_ADDON_KEYS = Object.freeze({
  EXTRA_SEAT: 'extra_seat',
  EXTRA_STORAGE: 'extra_storage',
});

export const BILLING_ADDON_EFFECT_KEYS = Object.freeze({
  SEATS: 'seats',
  STORAGE_BYTES: 'storageBytes',
});

const PLAN_LIMIT_DEFAULTS = Object.freeze({
  [BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]: null,
  [BILLING_PLAN_LIMIT_KEYS.MAILBOXES]: null,
  [BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]: null,
  [BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]: null,
  [BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]: null,
});

const PLAN_FEATURE_DEFAULTS = Object.freeze({
  [BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]: true,
  [BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]: true,
  [BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]: true,
  [BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]: false,
});

const ADDON_EFFECT_DEFAULTS = Object.freeze({
  [BILLING_ADDON_EFFECT_KEYS.SEATS]: 0,
  [BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES]: 0,
});

const CURRENT_USAGE_DEFAULTS = Object.freeze({
  seatsUsed: 0,
  activeMailboxes: 0,
  storageBytes: 0,
});

const MONTHLY_USAGE_DEFAULTS = Object.freeze({
  periodKey: null,
  ticketsCreated: 0,
  uploadsCount: 0,
});

const normalizeNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const normalizeLimitValue = (value, fallback = null) => {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }

  return normalizeNonNegativeNumber(value, fallback);
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
};

const normalizeAddonKey = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
};

export const buildBillingPeriodKey = (date = new Date()) => {
  const resolved = date instanceof Date ? date : new Date(date);
  const year = resolved.getUTCFullYear();
  const month = String(resolved.getUTCMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
};

export const normalizePlanLimits = (input = {}) => ({
  [BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]: normalizeLimitValue(
    input?.[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED],
    PLAN_LIMIT_DEFAULTS[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]
  ),
  [BILLING_PLAN_LIMIT_KEYS.MAILBOXES]: normalizeLimitValue(
    input?.[BILLING_PLAN_LIMIT_KEYS.MAILBOXES],
    PLAN_LIMIT_DEFAULTS[BILLING_PLAN_LIMIT_KEYS.MAILBOXES]
  ),
  [BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]: normalizeLimitValue(
    input?.[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES],
    PLAN_LIMIT_DEFAULTS[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]
  ),
  [BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]: normalizeLimitValue(
    input?.[BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH],
    PLAN_LIMIT_DEFAULTS[BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]
  ),
  [BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]: normalizeLimitValue(
    input?.[BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH],
    PLAN_LIMIT_DEFAULTS[BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]
  ),
});

export const normalizePlanFeatures = (input = {}) => ({
  [BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]: normalizeBoolean(
    input?.[BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED],
    PLAN_FEATURE_DEFAULTS[BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]
  ),
  [BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]: normalizeBoolean(
    input?.[BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED],
    PLAN_FEATURE_DEFAULTS[BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]
  ),
  [BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]: normalizeBoolean(
    input?.[BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED],
    PLAN_FEATURE_DEFAULTS[BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]
  ),
  [BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]: normalizeBoolean(
    input?.[BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED],
    PLAN_FEATURE_DEFAULTS[BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]
  ),
});

export const normalizeAddonEffects = (input = {}) => ({
  [BILLING_ADDON_EFFECT_KEYS.SEATS]: normalizeNonNegativeNumber(
    input?.[BILLING_ADDON_EFFECT_KEYS.SEATS],
    ADDON_EFFECT_DEFAULTS[BILLING_ADDON_EFFECT_KEYS.SEATS]
  ),
  [BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES]: normalizeNonNegativeNumber(
    input?.[BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES],
    ADDON_EFFECT_DEFAULTS[BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES]
  ),
});

export const normalizeSubscriptionAddonItems = (items = []) =>
  Array.isArray(items)
    ? items
        .map((item) => ({
          addonId: item?.addonId ? String(item.addonId) : null,
          addonKey: normalizeAddonKey(item?.addonKey),
          quantity: Math.max(
            1,
            Math.trunc(normalizeNonNegativeNumber(item?.quantity, 1))
          ),
        }))
        .filter((item) => item.addonId || item.addonKey)
    : [];

export const normalizeUsageSnapshot = (input = {}) => ({
  current: {
    seatsUsed: normalizeNonNegativeNumber(
      input?.current?.seatsUsed,
      CURRENT_USAGE_DEFAULTS.seatsUsed
    ),
    activeMailboxes: normalizeNonNegativeNumber(
      input?.current?.activeMailboxes,
      CURRENT_USAGE_DEFAULTS.activeMailboxes
    ),
    storageBytes: normalizeNonNegativeNumber(
      input?.current?.storageBytes,
      CURRENT_USAGE_DEFAULTS.storageBytes
    ),
  },
  monthly: {
    periodKey:
      typeof input?.monthly?.periodKey === 'string' &&
      input.monthly.periodKey.trim()
        ? input.monthly.periodKey.trim()
        : MONTHLY_USAGE_DEFAULTS.periodKey,
    ticketsCreated: normalizeNonNegativeNumber(
      input?.monthly?.ticketsCreated,
      MONTHLY_USAGE_DEFAULTS.ticketsCreated
    ),
    uploadsCount: normalizeNonNegativeNumber(
      input?.monthly?.uploadsCount,
      MONTHLY_USAGE_DEFAULTS.uploadsCount
    ),
  },
});

export const isBillingLimitEnforced = (value) => {
  if (value === null || typeof value === 'undefined') {
    return false;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
};

export const isBillingLimitExceeded = ({ limit, usage }) =>
  isBillingLimitEnforced(limit) &&
  normalizeNonNegativeNumber(usage, 0) > Number(limit);

export const buildOverLimitFlags = ({ limits = {}, usage = {} } = {}) => {
  const normalizedLimits = normalizePlanLimits(limits);
  const normalizedUsage = normalizeUsageSnapshot(usage);

  const flags = {
    seats: isBillingLimitExceeded({
      limit: normalizedLimits[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED],
      usage: normalizedUsage.current.seatsUsed,
    }),
    mailboxes: isBillingLimitExceeded({
      limit: normalizedLimits[BILLING_PLAN_LIMIT_KEYS.MAILBOXES],
      usage: normalizedUsage.current.activeMailboxes,
    }),
    storageBytes: isBillingLimitExceeded({
      limit: normalizedLimits[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES],
      usage: normalizedUsage.current.storageBytes,
    }),
    uploadsPerMonth: isBillingLimitExceeded({
      limit: normalizedLimits[BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH],
      usage: normalizedUsage.monthly.uploadsCount,
    }),
    ticketsPerMonth: isBillingLimitExceeded({
      limit: normalizedLimits[BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH],
      usage: normalizedUsage.monthly.ticketsCreated,
    }),
  };

  return {
    ...flags,
    any: Object.values(flags).some(Boolean),
  };
};

export const applyAddonEffectsToLimits = ({
  limits = {},
  addons = [],
} = {}) => {
  const normalizedLimits = normalizePlanLimits(limits);
  const resolvedAddons = Array.isArray(addons) ? addons : [];

  for (const addon of resolvedAddons) {
    const quantity = Math.max(
      1,
      Math.trunc(normalizeNonNegativeNumber(addon?.quantity, 1))
    );
    const effects = normalizeAddonEffects(addon?.effects);

    if (normalizedLimits[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED] !== null) {
      normalizedLimits[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED] +=
        effects[BILLING_ADDON_EFFECT_KEYS.SEATS] * quantity;
    }

    if (normalizedLimits[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES] !== null) {
      normalizedLimits[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES] +=
        effects[BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES] * quantity;
    }
  }

  return normalizedLimits;
};

export const normalizeEntitlementSnapshot = (input = {}) => {
  const limits = normalizePlanLimits(input?.limits);
  const features = normalizePlanFeatures(input?.features);
  const usage = normalizeUsageSnapshot(input?.usage);
  const overLimit = buildOverLimitFlags({ limits, usage });

  return {
    limits,
    features,
    usage,
    computedAt: input?.computedAt ? new Date(input.computedAt) : null,
    sourceSnapshot:
      input?.sourceSnapshot && typeof input.sourceSnapshot === 'object'
        ? input.sourceSnapshot
        : null,
    overLimit,
  };
};
