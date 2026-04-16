import { body, param, query } from 'express-validator';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { buildAllowedBodyValidation } from '../../../shared/validators/body-validation.js';

const WIDGET_SORT_ALLOWLIST = [
  'name',
  '-name',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
];

const WIDGET_UPDATE_ALLOWED_FIELDS = [
  'name',
  'mailboxId',
  'branding',
  'behavior',
];

const PUBLIC_WIDGET_KEY_PATTERN = /^wgt_[a-f0-9]{32}$/;
const PUBLIC_WIDGET_SESSION_TOKEN_PATTERN = /^wgs_[a-f0-9]{48}$/;
const PUBLIC_WIDGET_RECOVERY_TOKEN_PATTERN = /^wgr_[a-f0-9]{48}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const widgetIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const publicWidgetKeyParam = param('publicKey')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .custom((value) => PUBLIC_WIDGET_KEY_PATTERN.test(value))
  .withMessage('errors.validation.invalid');

const optionalPublicSessionTokenField = body('sessionToken')
  .optional({ nullable: true })
  .customSanitizer((value) => {
    if (value === undefined || value === null) {
      return value;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  })
  .if((value) => value !== null && value !== undefined)
  .isString()
  .withMessage('errors.validation.invalid')
  .custom((value) => PUBLIC_WIDGET_SESSION_TOKEN_PATTERN.test(value))
  .withMessage('errors.validation.invalid');

const emailField = body('email')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .isEmail()
  .withMessage('errors.validation.invalidEmail')
  .isLength({ max: 320 })
  .withMessage('errors.validation.maxLength');

const otpCodeField = body('code')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .matches(/^\d{4,8}$/)
  .withMessage('errors.validation.otpLength');

const recoveryTokenField = body('recoveryToken')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .custom((value) => PUBLIC_WIDGET_RECOVERY_TOKEN_PATTERN.test(value))
  .withMessage('errors.validation.invalid');

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

const optionalNullableTrimmedField = (path, maxLength) =>
  body(path)
    .optional({ nullable: true })
    .customSanitizer((value) => {
      if (value === undefined || value === null) {
        return value;
      }

      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : null;
    })
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.lengthRange');

const optionalNullableColorField = (path) =>
  body(path)
    .optional({ nullable: true })
    .customSanitizer((value) => {
      if (value === undefined || value === null) {
        return value;
      }

      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : null;
    })
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .custom((value) => HEX_COLOR_PATTERN.test(value))
    .withMessage('errors.validation.invalid');

const optionalBehaviorValidator = [
  body('behavior')
    .optional()
    .isObject({ strict: true })
    .withMessage('errors.validation.invalid'),
  body('behavior.defaultLocale')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(['en', 'ar'])
    .withMessage('errors.validation.invalidEnum'),
  body('behavior.collectName')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  body('behavior.collectEmail')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
];

const optionalBrandingValidator = [
  body('branding')
    .optional()
    .isObject({ strict: true })
    .withMessage('errors.validation.invalid'),
  optionalNullableTrimmedField('branding.displayName', 120),
  optionalNullableColorField('branding.accentColor'),
  optionalNullableTrimmedField('branding.launcherLabel', 80),
  optionalNullableTrimmedField('branding.welcomeTitle', 160),
  optionalNullableTrimmedField('branding.welcomeMessage', 1000),
];

const brandingUnknownFieldValidation = (req) => {
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'branding')) {
    return [];
  }

  const branding = req.body?.branding;
  if (!branding || typeof branding !== 'object' || Array.isArray(branding)) {
    return [];
  }

  const allowedFields = [
    'displayName',
    'accentColor',
    'launcherLabel',
    'welcomeTitle',
    'welcomeMessage',
  ];
  const unknownFields = Object.keys(branding).filter(
    (field) => !allowedFields.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(`branding.${field}`, 'errors.validation.unknownField')
  );
};

const behaviorUnknownFieldValidation = (req) => {
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'behavior')) {
    return [];
  }

  const behavior = req.body?.behavior;
  if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) {
    return [];
  }

  const allowedFields = ['defaultLocale', 'collectName', 'collectEmail'];
  const unknownFields = Object.keys(behavior).filter(
    (field) => !allowedFields.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(`behavior.${field}`, 'errors.validation.unknownField')
  );
};

export const createWidgetValidator = [
  body('name')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('mailboxId').isMongoId().withMessage('errors.validation.invalidId'),
  ...optionalBrandingValidator,
  ...optionalBehaviorValidator,
  brandingUnknownFieldValidation,
  behaviorUnknownFieldValidation,
];

export const listWidgetsValidator = [
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
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(WIDGET_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const widgetOptionsValidator = [
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

export const widgetByIdValidator = [widgetIdParam];

export const updateWidgetValidator = [
  widgetIdParam,
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('mailboxId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  ...optionalBrandingValidator,
  ...optionalBehaviorValidator,
  brandingUnknownFieldValidation,
  behaviorUnknownFieldValidation,
];

export const updateWidgetBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !WIDGET_UPDATE_ALLOWED_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = WIDGET_UPDATE_ALLOWED_FIELDS.some((field) => {
    if (!Object.prototype.hasOwnProperty.call(requestBody, field)) {
      return false;
    }

    if (field === 'branding' || field === 'behavior') {
      const value = requestBody[field];
      return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
      );
    }

    return true;
  });

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

export const widgetActionByIdValidator = [widgetIdParam, emptyBodyValidation];

export const publicWidgetBootstrapValidator = [
  publicWidgetKeyParam,
];

export const publicWidgetSessionValidator = [
  publicWidgetKeyParam,
  optionalPublicSessionTokenField,
  buildAllowedBodyValidation({
    allowedFields: ['sessionToken'],
    requireAtLeastOne: false,
  }),
];

export const publicWidgetMessageValidator = [
  publicWidgetKeyParam,
  body('sessionToken')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .custom((value) => PUBLIC_WIDGET_SESSION_TOKEN_PATTERN.test(value))
    .withMessage('errors.validation.invalid'),
  body('name')
    .optional({ nullable: true })
    .customSanitizer((value) => {
      if (value === undefined || value === null) {
        return value;
      }

      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : null;
    })
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: 180 })
    .withMessage('errors.validation.lengthRange'),
  body('email')
    .optional({ nullable: true })
    .customSanitizer((value) => {
      if (value === undefined || value === null) {
        return value;
      }

      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : null;
    })
    .if((value) => value !== null && value !== undefined)
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.lengthRange'),
  body('message')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('errors.validation.lengthRange'),
  buildAllowedBodyValidation({
    allowedFields: ['sessionToken', 'name', 'email', 'message'],
    requireAtLeastOne: false,
  }),
];

export const publicWidgetRecoveryRequestValidator = [
  publicWidgetKeyParam,
  emailField,
  buildAllowedBodyValidation({
    allowedFields: ['email'],
    requireAtLeastOne: true,
  }),
];

export const publicWidgetRecoveryVerifyValidator = [
  publicWidgetKeyParam,
  emailField,
  otpCodeField,
  buildAllowedBodyValidation({
    allowedFields: ['email', 'code'],
    requireAtLeastOne: true,
  }),
];

export const publicWidgetRecoveryContinueValidator = [
  publicWidgetKeyParam,
  recoveryTokenField,
  buildAllowedBodyValidation({
    allowedFields: ['recoveryToken'],
    requireAtLeastOne: true,
  }),
];

export const publicWidgetRecoveryStartNewValidator = [
  publicWidgetKeyParam,
  recoveryTokenField,
  buildAllowedBodyValidation({
    allowedFields: ['recoveryToken'],
    requireAtLeastOne: true,
  }),
];
