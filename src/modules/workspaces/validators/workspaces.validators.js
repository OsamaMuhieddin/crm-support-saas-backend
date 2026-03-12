import { body, param, query } from 'express-validator';
import { WORKSPACE_ROLE_VALUES } from '../../../constants/workspace-roles.js';
import { INVITE_STATUS_VALUES } from '../../../constants/invite-status.js';

const workspaceIdParam = param('workspaceId')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const inviteIdParam = param('inviteId')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const createInviteValidator = [
  workspaceIdParam,
  body('email')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength'),
  body('roleKey')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(WORKSPACE_ROLE_VALUES)
    .withMessage('errors.validation.invalidEnum')
];

export const listInvitesValidator = [
  workspaceIdParam,
  query('status')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(INVITE_STATUS_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.invalidNumber')
    .toInt()
];

export const inviteByIdValidator = [workspaceIdParam, inviteIdParam];

export const acceptInviteValidator = [
  body('token')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 16, max: 512 })
    .withMessage('errors.validation.lengthRange'),
  body('email')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength'),
  body('password')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 8, max: 128 })
    .withMessage('errors.validation.lengthRange'),
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.lengthRange')
];

export const switchWorkspaceValidator = [
  body('workspaceId')
    .isMongoId()
    .withMessage('errors.validation.invalidId')
];
