import { body, param, query } from 'express-validator';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const TAG_SORT_ALLOWLIST = [
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const TAG_UPDATE_ALLOWED_FIELDS = ['name'];

const tagIdParam = param('id')
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

export const createTicketTagValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
];

export const listTicketTagsValidator = [
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
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
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
    .isIn(TAG_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const ticketTagOptionsValidator = [
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
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

export const ticketTagByIdValidator = [tagIdParam];

export const updateTicketTagValidator = [
  tagIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('errors.validation.lengthRange'),
];

export const updateTicketTagBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !TAG_UPDATE_ALLOWED_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = TAG_UPDATE_ALLOWED_FIELDS.some((field) =>
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

export const ticketTagActionByIdValidator = [tagIdParam, emptyBodyValidation];
