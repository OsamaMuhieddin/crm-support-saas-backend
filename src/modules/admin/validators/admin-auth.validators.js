import { body } from 'express-validator';
import { buildAllowedBodyValidation } from '../../../shared/validators/body-validation.js';

const emailRule = body('email')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .isEmail()
  .withMessage('errors.validation.invalidEmail')
  .isLength({ max: 320 })
  .withMessage('errors.validation.maxLength');

const passwordRule = body('password')
  .isString()
  .withMessage('errors.validation.invalid')
  .isLength({ min: 8, max: 128 })
  .withMessage('errors.validation.lengthRange');

export const adminLoginValidator = [
  emailRule,
  passwordRule,
  buildAllowedBodyValidation({
    allowedFields: ['email', 'password'],
  }),
];

export const adminRefreshValidator = [
  body('refreshToken')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .notEmpty()
    .withMessage('errors.validation.required'),
  buildAllowedBodyValidation({
    allowedFields: ['refreshToken'],
  }),
];
