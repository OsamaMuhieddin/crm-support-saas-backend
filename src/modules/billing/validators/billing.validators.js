import { body } from 'express-validator';
import { billingConfig } from '../../../config/billing.config.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const CHECKOUT_ALLOWED_FIELDS = ['planKey', 'addonItems', 'successUrl', 'cancelUrl'];
const PORTAL_ALLOWED_FIELDS = ['returnUrl'];
const PLAN_CHANGE_ALLOWED_FIELDS = ['planKey'];
const ADDON_UPDATE_ALLOWED_FIELDS = ['addonItems'];

const buildAllowedBodyValidation = (allowedFields) => (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !allowedFields.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

const validateUniqueAddonKeys = body('addonItems').custom((value) => {
  if (value === undefined) {
    return true;
  }

  if (!Array.isArray(value)) {
    throw new Error('errors.validation.invalid');
  }

  const keys = value.map((item) => String(item?.addonKey || '').trim().toLowerCase());
  const nonEmptyKeys = keys.filter(Boolean);

  if (new Set(nonEmptyKeys).size !== nonEmptyKeys.length) {
    throw new Error('errors.validation.duplicateValues');
  }

  return true;
});

const validateCheckoutUrlField = (field, fallbackValue) =>
  body(field).custom((value) => {
    const candidate =
      typeof value === 'string' && value.trim()
        ? value.trim()
        : fallbackValue || null;

    if (!candidate) {
      throw new Error('errors.validation.required');
    }

    try {
      const url = new URL(candidate);
      if (!url.protocol || !url.host) {
        throw new Error('invalid');
      }
    } catch (error) {
      throw new Error('errors.validation.invalid');
    }

    return true;
  });

export const billingCatalogValidator = [];
export const billingSubscriptionValidator = [];
export const billingEntitlementsValidator = [];
export const billingUsageValidator = [];
export const billingSummaryValidator = [];

export const billingCheckoutSessionValidator = [
  body('planKey')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('addonItems')
    .optional()
    .isArray({ max: 20 })
    .withMessage('errors.validation.invalid'),
  body('addonItems.*.addonKey')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('addonItems.*.quantity')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  validateUniqueAddonKeys,
  validateCheckoutUrlField(
    'successUrl',
    billingConfig.stripe.checkoutSuccessUrl
  ),
  validateCheckoutUrlField(
    'cancelUrl',
    billingConfig.stripe.checkoutCancelUrl
  ),
  buildAllowedBodyValidation(CHECKOUT_ALLOWED_FIELDS)
];

export const billingPortalSessionValidator = [
  body('returnUrl')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .custom((value) => {
      if (!value) {
        return true;
      }

      try {
        const url = new URL(value);
        return Boolean(url.protocol && url.host);
      } catch (error) {
        throw new Error('errors.validation.invalid');
      }
    }),
  buildAllowedBodyValidation(PORTAL_ALLOWED_FIELDS)
];

export const billingPlanChangeValidator = [
  body('planKey')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  buildAllowedBodyValidation(PLAN_CHANGE_ALLOWED_FIELDS)
];

export const billingAddonUpdateValidator = [
  body('addonItems')
    .isArray({ min: 1, max: 20 })
    .withMessage('errors.validation.invalid'),
  body('addonItems.*.addonKey')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  body('addonItems.*.quantity')
    .isInt({ min: 0, max: 1000 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  validateUniqueAddonKeys,
  buildAllowedBodyValidation(ADDON_UPDATE_ALLOWED_FIELDS)
];

export const billingStripeWebhookValidator = [];
