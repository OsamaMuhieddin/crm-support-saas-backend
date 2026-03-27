const parseBoolean = (value, fallback = false) => {
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

const defaultIfEmpty = (value, fallback = null) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const redisConfig = {
  enabled: parseBoolean(
    process.env.REDIS_ENABLED,
    parseBoolean(process.env.REALTIME_REDIS_ENABLED, false)
  ),
  url: defaultIfEmpty(
    process.env.REDIS_URL,
    defaultIfEmpty(process.env.REALTIME_REDIS_URL, null)
  ),
};

