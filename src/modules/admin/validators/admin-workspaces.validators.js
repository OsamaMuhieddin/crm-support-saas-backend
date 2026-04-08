import { body, param, query } from 'express-validator';
import { BILLING_SUBSCRIPTION_STATUS_VALUES } from '../../../constants/billing-subscription-status.js';
import { WORKSPACE_STATUS_VALUES } from '../../../constants/workspace-status.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { buildAllowedBodyValidation } from '../../../shared/validators/body-validation.js';

const ADMIN_WORKSPACE_SORT_VALUES = [
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
  'name',
  '-name',
  'status',
  '-status',
];

const ADMIN_WORKSPACE_ALLOWED_QUERY_FIELDS = [
  'q',
  'search',
  'status',
  'billingStatus',
  'planKey',
  'trialing',
  'page',
  'limit',
  'sort',
];

const workspaceIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const buildAllowedAdminWorkspaceQueryValidation = () => (req) => {
  const unknownFields = Object.keys(req.query || {}).filter(
    (field) => !ADMIN_WORKSPACE_ALLOWED_QUERY_FIELDS.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

export const listAdminWorkspacesValidator = [
  buildAllowedAdminWorkspaceQueryValidation(),
  query('q')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.lengthRange'),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.lengthRange'),
  query('status')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(WORKSPACE_STATUS_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('billingStatus')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(BILLING_SUBSCRIPTION_STATUS_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('planKey')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('trialing')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean')
    .toBoolean(),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(ADMIN_WORKSPACE_SORT_VALUES)
    .withMessage('errors.validation.invalidEnum'),
];

export const adminWorkspaceByIdValidator = [workspaceIdParam];

export const suspendAdminWorkspaceValidator = [
  workspaceIdParam,
  buildAllowedBodyValidation({
    allowedFields: [],
  }),
];

export const reactivateAdminWorkspaceValidator = [
  workspaceIdParam,
  buildAllowedBodyValidation({
    allowedFields: [],
  }),
];

export const extendTrialAdminWorkspaceValidator = [
  workspaceIdParam,
  body('days')
    .isInt({ min: 1, max: 30 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  buildAllowedBodyValidation({
    allowedFields: ['days'],
  }),
];
