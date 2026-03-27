const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toStringOrFallback = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const parseList = (value, fallback = []) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback;
};

const parseCorsOrigin = (value) => {
  const origins = parseList(value, ['*']);

  if (origins.length === 1 && origins[0] === '*') {
    return '*';
  }

  return origins;
};

export const realtimeConfig = {
  enabled: toBool(process.env.REALTIME_ENABLED, true),
  debugLogging: toBool(process.env.REALTIME_DEBUG_LOGGING, false),
  path: toStringOrFallback(process.env.REALTIME_PATH, '/socket.io'),
  transports: parseList(process.env.REALTIME_TRANSPORTS, [
    'websocket',
    'polling',
  ]),
  pingIntervalMs: toInt(process.env.REALTIME_PING_INTERVAL_MS, 25000),
  pingTimeoutMs: toInt(process.env.REALTIME_PING_TIMEOUT_MS, 20000),
  corsOrigin: parseCorsOrigin(process.env.REALTIME_CORS_ORIGIN),
  collaboration: {
    presenceTtlMs: Math.max(
      1000,
      toInt(process.env.REALTIME_PRESENCE_TTL_MS, 45000)
    ),
    typingTtlMs: Math.max(
      1000,
      toInt(process.env.REALTIME_TYPING_TTL_MS, 8000)
    ),
    softClaimTtlMs: Math.max(
      1000,
      toInt(process.env.REALTIME_SOFT_CLAIM_TTL_MS, 45000)
    ),
    actionThrottleMs: Math.max(
      0,
      toInt(process.env.REALTIME_ACTION_THROTTLE_MS, 75)
    ),
    requiresTicketSubscription: true,
  },
  features: {
    roomSubscriptions: true,
    businessEvents: true,
    presence: true,
    typing: true,
    softClaim: true,
  },
  redis: {
    adapterEnabled: toBool(process.env.REALTIME_REDIS_ADAPTER_ENABLED, false),
  },
};
