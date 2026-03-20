import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

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

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.startsWith('+')
    ? trimmed
    : trimmed.startsWith('00')
      ? `+${trimmed.slice(2)}`
      : `+${trimmed.replace(/\D/g, '')}`;

  const digitsOnly = candidate.replace(/\D/g, '');

  if (!digitsOnly) {
    return undefined;
  }

  const parsed = parsePhoneNumberFromString(candidate, {
    extract: false
  });

  if (!parsed || !parsed.isPossible()) {
    return undefined;
  }

  return parsed.number;
};

export const normalizeDomain = (value) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
};
