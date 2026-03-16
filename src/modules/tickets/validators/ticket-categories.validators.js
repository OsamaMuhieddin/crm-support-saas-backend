import { body, param, query } from 'express-validator';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const CATEGORY_SORT_ALLOWLIST = [
  'order',
  '-order',
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const CATEGORY_UPDATE_ALLOWED_FIELDS = ['name', 'slug', 'parentId', 'order'];

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const optionalNullableTrimmedField = (field, maxLength) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.lengthRange');

const optionalNullableMongoIdBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId');

const categoryIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const emptyBodyValidation = (req) => {
  const requestBody = req.body || {};
  const bodyFields = Object.keys(requestBody);

  if (bodyFields.length === 0) {
    return [];
  }

  return bodyFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

export const createTicketCategoryValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableTrimmedField('slug', 140),
  optionalNullableMongoIdBodyField('parentId'),
  body('order')
    .optional()
    .isInt()
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
];

export const listTicketCategoriesValidator = [
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
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('parentId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(CATEGORY_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const ticketCategoryOptionsValidator = [
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('parentId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
];

export const ticketCategoryByIdValidator = [categoryIdParam];

export const updateTicketCategoryValidator = [
  categoryIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableTrimmedField('slug', 140),
  optionalNullableMongoIdBodyField('parentId'),
  body('order')
    .optional()
    .isInt()
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
];

export const updateTicketCategoryBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !CATEGORY_UPDATE_ALLOWED_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = CATEGORY_UPDATE_ALLOWED_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(requestBody, field)
  );

  if (hasAllowedField) {
    return [];
  }

  return [
    buildValidationError(
      'body',
      'errors.validation.bodyRequiresAtLeastOneField'
    ),
  ];
};

export const ticketCategoryActionByIdValidator = [
  categoryIdParam,
  emptyBodyValidation,
];
