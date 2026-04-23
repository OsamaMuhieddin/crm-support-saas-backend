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

const defaultOrigins = ['http://localhost:5173'];

const allowedOrigins = parseList(
  process.env.CORS_ALLOWED_ORIGINS,
  defaultOrigins
);

export const httpConfig = {
  cors: {
    allowedOrigins,
    allowAll: allowedOrigins.length === 1 && allowedOrigins[0] === '*',
  },
};

export const isCorsOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  if (httpConfig.cors.allowAll) {
    return true;
  }

  return httpConfig.cors.allowedOrigins.includes(origin);
};
