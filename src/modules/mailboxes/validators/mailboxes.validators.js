import { body, param, query } from 'express-validator';
import { MAILBOX_TYPE } from '../../../constants/mailbox-type.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const sortAllowlist = [
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const updateAllowedFields = [
  'name',
  'type',
  'emailAddress',
  'fromName',
  'replyTo',
  'signatureText',
  'signatureHtml',
];

const MAILBOX_V1_TYPE_VALUES = Object.freeze([MAILBOX_TYPE.EMAIL]);

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
    .withMessage('errors.validation.failed')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.failed');

const optionalNullableEmailField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.failed')
    .isEmail()
    .withMessage('errors.validation.failed')
    .isLength({ max: 320 })
    .withMessage('errors.validation.failed');

const mailboxIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.failed');

export const createMailboxValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  body('type')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(MAILBOX_V1_TYPE_VALUES)
    .withMessage('errors.validation.failed'),
  optionalNullableEmailField('emailAddress'),
  optionalNullableTrimmedField('fromName', 120),
  optionalNullableEmailField('replyTo'),
  optionalNullableTrimmedField('signatureText', 10000),
  optionalNullableTrimmedField('signatureHtml', 50000),
];

export const listMailboxesValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
  query('isDefault')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(sortAllowlist)
    .withMessage('errors.validation.failed'),
];

export const mailboxOptionsValidator = [
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
];

export const mailboxByIdValidator = [mailboxIdParam];

export const updateMailboxValidator = [
  mailboxIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  body('type')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(MAILBOX_V1_TYPE_VALUES)
    .withMessage('errors.validation.failed'),
  optionalNullableEmailField('emailAddress'),
  optionalNullableTrimmedField('fromName', 120),
  optionalNullableEmailField('replyTo'),
  optionalNullableTrimmedField('signatureText', 10000),
  optionalNullableTrimmedField('signatureHtml', 50000),
];

export const updateMailboxBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !updateAllowedFields.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.failed')
    );
  }

  const hasAllowedField = updateAllowedFields.some((field) =>
    Object.prototype.hasOwnProperty.call(requestBody, field)
  );

  if (hasAllowedField) {
    return [];
  }

  return [buildValidationError('body', 'errors.validation.failed')];
};

export const mailboxActionByIdValidator = [mailboxIdParam];
