export const normalizeEmail = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

export const normalizeName = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return normalized || undefined;
};

export const normalizeSubject = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return normalized || undefined;
};

export const normalizePhone = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return normalized || undefined;
};

