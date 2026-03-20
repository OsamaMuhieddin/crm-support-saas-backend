import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone
} from '../../../shared/utils/normalize.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
export {
  normalizeObjectId,
  toObjectIdIfValid
} from '../../../shared/utils/object-id.js';

const EMAIL_LIKE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_LIKE_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const buildCustomersValidationError = (field, messageKey) =>
  createError('errors.validation.failed', 422, [
    buildValidationError(field, messageKey)
  ]);

export const isNormalizedEmailLike = (value) =>
  typeof value === 'string' && EMAIL_LIKE_PATTERN.test(value);

export const isNormalizedDomainLike = (value) =>
  typeof value === 'string' && DOMAIN_LIKE_PATTERN.test(value);

export const normalizeNullableString = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeNullableEmail = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeEmail(String(value)) || null;
};

export const normalizeNullableEmailForWriteOrThrow = ({
  value,
  field = 'email'
} = {}) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw buildCustomersValidationError(field, 'errors.validation.invalid');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeEmail(trimmed);
  if (!normalized || !isNormalizedEmailLike(normalized)) {
    throw buildCustomersValidationError(field, 'errors.validation.invalidEmail');
  }

  return normalized;
};

export const normalizeNullablePhone = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizePhone(String(value)) || null;
};

export const normalizeNullablePhoneForWriteOrThrow = ({
  value,
  field = 'phone'
} = {}) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw buildCustomersValidationError(field, 'errors.validation.invalid');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizePhone(trimmed);
  if (!normalized) {
    throw buildCustomersValidationError(field, 'errors.validation.invalidPhone');
  }

  return normalized;
};

export const normalizeNullableDomainForWriteOrThrow = ({
  value,
  field = 'domain'
} = {}) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw buildCustomersValidationError(field, 'errors.validation.invalid');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeDomain(trimmed);
  if (!normalized || !isNormalizedDomainLike(normalized)) {
    throw buildCustomersValidationError(field, 'errors.validation.invalidDomain');
  }

  return normalized;
};

export const normalizeTagLabel = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
};

export const normalizeTagList = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const seen = new Set();
  const tags = [];

  for (const entry of value) {
    const normalized = normalizeTagLabel(entry);

    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    tags.push(normalized);
  }

  return tags;
};

export const isPlainObject = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export const normalizeCustomFields = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = String(key).trim();

    if (!normalizedKey) {
      continue;
    }

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      normalized[normalizedKey] = trimmed.length > 0 ? trimmed : null;
      continue;
    }

    normalized[normalizedKey] = rawValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};
