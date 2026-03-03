import { body, param, query } from 'express-validator';
import { WORKSPACE_ROLE_VALUES } from '../../../constants/workspace-roles.js';
import { INVITE_STATUS_VALUES } from '../../../constants/invite-status.js';

const workspaceIdParam = param('workspaceId')
  .isMongoId()
  .withMessage('errors.validation.failed');

const inviteIdParam = param('inviteId')
  .isMongoId()
  .withMessage('errors.validation.failed');

export const createInviteValidator = [
  workspaceIdParam,
  body('email')
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isEmail()
    .withMessage('errors.validation.failed')
    .isLength({ max: 320 })
    .withMessage('errors.validation.failed'),
  body('roleKey')
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(WORKSPACE_ROLE_VALUES)
    .withMessage('errors.validation.failed')
];

export const listInvitesValidator = [
  workspaceIdParam,
  query('status')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(INVITE_STATUS_VALUES)
    .withMessage('errors.validation.failed'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.failed')
    .toInt()
];

export const inviteByIdValidator = [workspaceIdParam, inviteIdParam];

export const acceptInviteValidator = [
  body('token')
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 16, max: 512 })
    .withMessage('errors.validation.failed'),
  body('email')
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isEmail()
    .withMessage('errors.validation.failed')
    .isLength({ max: 320 })
    .withMessage('errors.validation.failed'),
  body('password')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isLength({ min: 8, max: 128 })
    .withMessage('errors.validation.failed'),
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.failed')
];
