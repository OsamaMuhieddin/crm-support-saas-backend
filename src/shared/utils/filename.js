import path from 'path';

const invalidCharsRegex = /[^a-zA-Z0-9._ -]/g;
const whitespaceRegex = /\s+/g;
const duplicateDashRegex = /-+/g;
const safeNameRegex = /^[a-z0-9]+$/;

const normalizeExtension = (extension) => {
  const cleaned = String(extension || '')
    .trim()
    .toLowerCase();
  if (!cleaned) {
    return '';
  }

  const normalized = cleaned.startsWith('.') ? cleaned.slice(1) : cleaned;
  if (!safeNameRegex.test(normalized)) {
    return '';
  }

  return `.${normalized}`;
};

export const getFileExtension = (filename) => {
  const parsed = path.parse(String(filename || ''));
  return normalizeExtension(parsed.ext);
};

export const sanitizeFilename = (filename, fallback = 'file') => {
  const parsed = path.parse(String(filename || ''));
  const extension = normalizeExtension(parsed.ext);

  const safeBaseName = String(parsed.name || '')
    .normalize('NFKD')
    .replace(invalidCharsRegex, '')
    .replace(whitespaceRegex, '-')
    .replace(duplicateDashRegex, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  const base = safeBaseName || fallback;
  return `${base}${extension}`;
};

export const buildContentDispositionFilename = (filename) => {
  const safeName = sanitizeFilename(filename, 'download');
  const asciiName = safeName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const encodedName = encodeURIComponent(safeName)
    .replace(
      /['()]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    )
    .replace(/\*/g, '%2A');

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
};
