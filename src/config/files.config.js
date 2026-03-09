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

  const lowered = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lowered)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lowered)) {
    return false;
  }

  return fallback;
};

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const normalizeExtension = (extension) => {
  const cleaned = String(extension || '')
    .trim()
    .toLowerCase();
  if (!cleaned) {
    return '';
  }

  return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
};

const parsedMimeTypes = parseList(process.env.FILES_ALLOWED_MIME_TYPES);
const parsedExtensions = parseList(process.env.FILES_ALLOWED_EXTENSIONS).map(
  normalizeExtension
);

export const filesConfig = {
  maxFileSizeBytes: toInt(process.env.MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
  allowedMimeTypes: parsedMimeTypes.length
    ? parsedMimeTypes
    : [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'text/plain',
        'application/zip',
      ],
  allowedExtensions: parsedExtensions.length
    ? parsedExtensions
    : ['.pdf', '.jpg', '.jpeg', '.png', '.txt', '.zip'],
  rateLimit: {
    upload: {
      enabled: toBool(process.env.FILES_UPLOAD_RATE_LIMIT_ENABLED, true),
      windowMs:
        toInt(process.env.FILES_UPLOAD_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
      max: toInt(process.env.FILES_UPLOAD_RATE_LIMIT_MAX, 20),
    },
    download: {
      enabled: toBool(process.env.FILES_DOWNLOAD_RATE_LIMIT_ENABLED, true),
      windowMs:
        toInt(process.env.FILES_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
      max: toInt(process.env.FILES_DOWNLOAD_RATE_LIMIT_MAX, 120),
    },
  },
};
