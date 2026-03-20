import { body, param, query } from 'express-validator';
import {
  ORGANIZATION_SORT_ALLOWLIST,
  ORGANIZATION_WRITEABLE_FIELDS,
} from '../utils/organization.helpers.js';
import {
  buildAllowedBodyValidation,
  toNullableTrimmedString,
} from './customer-validation.helpers.js';

const ORGANIZATION_QUERY_SEARCH_MAX_LENGTH = 120;

const sanitizeNullableDomain = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const optionalNullableTrimmedField = (field, maxLength) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableTrimmedString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.lengthRange');

const optionalNullableDomainBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(sanitizeNullableDomain)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: 253 })
    .withMessage('errors.validation.lengthRange')
    .isFQDN({
      require_tld: true,
      allow_wildcard: false,
      allow_trailing_dot: false,
      allow_underscores: false,
    })
    .withMessage('errors.validation.invalidDomain');

const optionalSearchQueryField = (field) =>
  query(field)
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: ORGANIZATION_QUERY_SEARCH_MAX_LENGTH })
    .withMessage('errors.validation.lengthRange');

const optionalDomainQueryField = (field) =>
  query(field)
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .toLowerCase()
    .isLength({ min: 1, max: 253 })
    .withMessage('errors.validation.lengthRange')
    .isFQDN({
      require_tld: true,
      allow_wildcard: false,
      allow_trailing_dot: false,
      allow_underscores: false,
    })
    .withMessage('errors.validation.invalidDomain');

const organizationIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const createOrganizationValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 180 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableDomainBodyField('domain'),
  optionalNullableTrimmedField('notes', 5000),
];

export const createOrganizationBodyValidation = buildAllowedBodyValidation({
  allowedFields: ORGANIZATION_WRITEABLE_FIELDS,
});

export const listOrganizationsValidator = [
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
  optionalDomainQueryField('domain'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(ORGANIZATION_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const organizationOptionsValidator = [
  optionalSearchQueryField('q'),
  optionalSearchQueryField('search'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
];

export const organizationByIdValidator = [organizationIdParam];

export const updateOrganizationValidator = [
  organizationIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 180 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableDomainBodyField('domain'),
  optionalNullableTrimmedField('notes', 5000),
];

export const updateOrganizationBodyValidation = buildAllowedBodyValidation({
  allowedFields: ORGANIZATION_WRITEABLE_FIELDS,
  requireAtLeastOne: true,
});
