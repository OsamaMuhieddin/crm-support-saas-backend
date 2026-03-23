import { body, param, query } from 'express-validator';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import {
  validateBusinessHoursPayload,
  validateSlaPolicyPayload,
} from '../services/sla.service.js';

const businessHoursSortAllowlist = [
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const slaPolicySortAllowlist = [
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const businessHoursAllowedFields = ['name', 'timezone', 'weeklySchedule'];
const slaPolicyAllowedFields = ['name', 'businessHoursId', 'rulesByPriority'];

const resourceIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const baseListValidator = (sortAllowlist) => [
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
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(sortAllowlist)
    .withMessage('errors.validation.invalidEnum'),
];

const baseOptionsValidator = [
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
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
];

const requireTrimmedName = body('name')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .isLength({ min: 1, max: 120 })
  .withMessage('errors.validation.lengthRange');

const optionalTrimmedName = body('name')
  .optional()
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .isLength({ min: 1, max: 120 })
  .withMessage('errors.validation.lengthRange');

export const listBusinessHoursValidator = baseListValidator(
  businessHoursSortAllowlist
);

export const businessHoursOptionsValidator = baseOptionsValidator;

export const businessHoursByIdValidator = [resourceIdParam];

export const createBusinessHoursValidator = [
  requireTrimmedName,
  body('timezone')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('weeklySchedule')
    .isArray({ min: 1, max: 7 })
    .withMessage('errors.validation.invalid'),
  (req) => validateBusinessHoursPayload(req.body, { requireAllFields: true }),
];

export const updateBusinessHoursValidator = [
  resourceIdParam,
  optionalTrimmedName,
  body('timezone')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('weeklySchedule')
    .optional()
    .isArray({ min: 1, max: 7 })
    .withMessage('errors.validation.invalid'),
  (req) => validateBusinessHoursPayload(req.body, { requireAllFields: false }),
];

export const updateBusinessHoursBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !businessHoursAllowedFields.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = businessHoursAllowedFields.some((field) =>
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

export const listSlaPoliciesValidator = [
  ...baseListValidator(slaPolicySortAllowlist),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
];

export const slaPolicyOptionsValidator = [
  ...baseOptionsValidator,
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
];

export const slaPolicyByIdValidator = [resourceIdParam];

export const createSlaPolicyValidator = [
  requireTrimmedName,
  body('businessHoursId')
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  body('rulesByPriority')
    .custom((value) => value && typeof value === 'object' && !Array.isArray(value))
    .withMessage('errors.validation.invalid'),
  (req) => validateSlaPolicyPayload(req.body, { requireAllFields: true }),
];

export const updateSlaPolicyValidator = [
  resourceIdParam,
  optionalTrimmedName,
  body('businessHoursId')
    .optional()
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  body('rulesByPriority')
    .optional()
    .custom((value) => value && typeof value === 'object' && !Array.isArray(value))
    .withMessage('errors.validation.invalid'),
  (req) => validateSlaPolicyPayload(req.body, { requireAllFields: false }),
];

export const updateSlaPolicyBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !slaPolicyAllowedFields.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = slaPolicyAllowedFields.some((field) =>
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

export const slaPolicyActionByIdValidator = [resourceIdParam];

export const deactivateSlaPolicyValidator = [
  resourceIdParam,
  body('replacementPolicyId')
    .optional()
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  (req) => {
    const requestBody = req.body || {};
    const allowedFields = ['replacementPolicyId'];
    const unknownFields = Object.keys(requestBody).filter(
      (field) => !allowedFields.includes(field)
    );

    if (unknownFields.length > 0) {
      return unknownFields.map((field) =>
        buildValidationError(field, 'errors.validation.unknownField')
      );
    }

    return [];
  },
];
