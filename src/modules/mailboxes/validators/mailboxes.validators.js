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
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.lengthRange');

const optionalNullableEmailField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength');

const mailboxIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const createMailboxValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('type')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(MAILBOX_V1_TYPE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
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
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('isDefault')
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
    .isIn(sortAllowlist)
    .withMessage('errors.validation.invalidEnum'),
];

export const mailboxOptionsValidator = [
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
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
];

export const mailboxByIdValidator = [mailboxIdParam];

export const updateMailboxValidator = [
  mailboxIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('type')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(MAILBOX_V1_TYPE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
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
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = updateAllowedFields.some((field) =>
    Object.prototype.hasOwnProperty.call(requestBody, field)
  );

  if (hasAllowedField) {
    return [];
  }

  return [
    buildValidationError('body', 'errors.validation.bodyRequiresAtLeastOneField'),
  ];
};

export const mailboxActionByIdValidator = [mailboxIdParam];
