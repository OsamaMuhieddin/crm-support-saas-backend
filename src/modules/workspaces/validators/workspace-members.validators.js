import { body, param, query } from 'express-validator';
import { MEMBER_STATUS_VALUES } from '../../../constants/member-status.js';
import { WORKSPACE_ROLE_VALUES } from '../../../constants/workspace-roles.js';
import { buildAllowedBodyValidation } from '../../../shared/validators/body-validation.js';

const sortAllowlist = [
  'name',
  '-name',
  'email',
  '-email',
  'createdAt',
  '-createdAt',
  'joinedAt',
  '-joinedAt',
];

const workspaceIdParam = param('workspaceId')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const userIdParam = param('userId')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const commonFilters = [
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
  query('roleKey')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(WORKSPACE_ROLE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('status')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(MEMBER_STATUS_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('assignable')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('participantEligible')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('includeRemoved')
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

export const listWorkspaceMembersValidator = [
  workspaceIdParam,
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
  ...commonFilters,
];

export const workspaceMemberOptionsValidator = [
  workspaceIdParam,
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  ...commonFilters,
];

export const workspaceMemberByUserIdValidator = [workspaceIdParam, userIdParam];

export const updateWorkspaceMemberRoleValidator = [
  workspaceIdParam,
  userIdParam,
  buildAllowedBodyValidation({
    allowedFields: ['roleKey'],
    requireAtLeastOne: true,
  }),
  body('roleKey')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(WORKSPACE_ROLE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
];
