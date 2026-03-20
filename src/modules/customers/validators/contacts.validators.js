import { body, param, query } from 'express-validator';
import { normalizeName } from '../../../shared/utils/normalize.js';
import { isPlainObject, normalizeTagLabel } from '../utils/customer.helpers.js';
import {
  CONTACT_SORT_ALLOWLIST,
  CONTACT_WRITEABLE_FIELDS,
} from '../utils/contact.helpers.js';
import {
  buildAllowedBodyValidation,
  toNormalizedPhoneString,
  validatePlausiblePhone,
  toNullableTrimmedString,
} from './customer-validation.helpers.js';

const CONTACT_QUERY_SEARCH_MAX_LENGTH = 120;
const CONTACT_PHONE_MAX_LENGTH = 40;
const CONTACT_TAG_MAX_ITEMS = 20;
const CONTACT_TAG_MAX_LENGTH = 50;
const CONTACT_CUSTOM_FIELDS_MAX_KEYS = 20;
const CONTACT_CUSTOM_FIELD_KEY_MAX_LENGTH = 60;
const CONTACT_CUSTOM_FIELD_STRING_MAX_LENGTH = 500;

const optionalNullableObjectIdBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId');

const optionalNullableEmailBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength')
    .toLowerCase();

const optionalNullablePhoneBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: CONTACT_PHONE_MAX_LENGTH })
    .withMessage('errors.validation.lengthRange')
    .custom(validatePlausiblePhone)
    .customSanitizer(toNormalizedPhoneString);

const optionalSearchQueryField = (field) =>
  query(field)
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: CONTACT_QUERY_SEARCH_MAX_LENGTH })
    .withMessage('errors.validation.lengthRange');

const optionalObjectIdQueryField = (field) =>
  query(field)
    .optional()
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId');

const optionalEmailQueryField = (field) =>
  query(field)
    .optional()
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength')
    .toLowerCase();

const validateTagsValue = (value) => {
  if (value === null) {
    return true;
  }

  if (!Array.isArray(value)) {
    throw new Error('errors.validation.invalid');
  }

  if (value.length > CONTACT_TAG_MAX_ITEMS) {
    throw new Error('errors.validation.maxLength');
  }

  const seen = new Set();

  for (const entry of value) {
    const normalizedTag = normalizeTagLabel(entry);

    if (!normalizedTag) {
      throw new Error('errors.validation.lengthRange');
    }

    if (normalizedTag.length > CONTACT_TAG_MAX_LENGTH) {
      throw new Error('errors.validation.lengthRange');
    }

    const dedupeKey = normalizeName(normalizedTag);
    if (seen.has(dedupeKey)) {
      throw new Error('errors.validation.duplicateValues');
    }

    seen.add(dedupeKey);
  }

  return true;
};

const validateCustomFieldsValue = (value) => {
  if (value === null) {
    return true;
  }

  if (!isPlainObject(value)) {
    throw new Error('errors.validation.invalid');
  }

  const entries = Object.entries(value);
  if (entries.length > CONTACT_CUSTOM_FIELDS_MAX_KEYS) {
    throw new Error('errors.validation.maxLength');
  }

  for (const [key, fieldValue] of entries) {
    const normalizedKey = String(key).trim();

    if (
      !normalizedKey ||
      normalizedKey.length > CONTACT_CUSTOM_FIELD_KEY_MAX_LENGTH ||
      !/^[A-Za-z0-9_.-]+$/.test(normalizedKey)
    ) {
      throw new Error('errors.validation.invalid');
    }

    if (fieldValue === null) {
      continue;
    }

    if (typeof fieldValue === 'string') {
      if (fieldValue.trim().length > CONTACT_CUSTOM_FIELD_STRING_MAX_LENGTH) {
        throw new Error('errors.validation.maxLength');
      }

      continue;
    }

    if (typeof fieldValue === 'number') {
      if (!Number.isFinite(fieldValue)) {
        throw new Error('errors.validation.invalid');
      }

      continue;
    }

    if (typeof fieldValue === 'boolean') {
      continue;
    }

    throw new Error('errors.validation.invalid');
  }

  return true;
};

const contactIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const createContactValidator = [
  body('fullName')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 180 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableObjectIdBodyField('organizationId'),
  optionalNullableEmailBodyField('email'),
  optionalNullablePhoneBodyField('phone'),
  body('tags').optional({ nullable: true }).custom(validateTagsValue),
  body('customFields')
    .optional({ nullable: true })
    .custom(validateCustomFieldsValue),
];

export const createContactBodyValidation = buildAllowedBodyValidation({
  allowedFields: CONTACT_WRITEABLE_FIELDS,
});

export const listContactsValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  optionalSearchQueryField('q'),
  optionalSearchQueryField('search'),
  optionalObjectIdQueryField('organizationId'),
  optionalEmailQueryField('email'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isIn(CONTACT_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const contactOptionsValidator = [
  optionalSearchQueryField('q'),
  optionalSearchQueryField('search'),
  optionalObjectIdQueryField('organizationId'),
  optionalEmailQueryField('email'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
];

export const contactByIdValidator = [contactIdParam];

export const updateContactValidator = [
  contactIdParam,
  body('fullName')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 180 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableObjectIdBodyField('organizationId'),
  optionalNullableEmailBodyField('email'),
  optionalNullablePhoneBodyField('phone'),
  body('tags').optional({ nullable: true }).custom(validateTagsValue),
  body('customFields')
    .optional({ nullable: true })
    .custom(validateCustomFieldsValue),
];

export const updateContactBodyValidation = buildAllowedBodyValidation({
  allowedFields: CONTACT_WRITEABLE_FIELDS,
  requireAtLeastOne: true,
});
