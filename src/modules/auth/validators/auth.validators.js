import { body } from 'express-validator';
import { OTP_PURPOSE_VALUES } from '../../../constants/otp-purpose.js';

const emailRule = body('email')
  .isString()
  .withMessage('errors.validation.failed')
  .trim()
  .isEmail()
  .withMessage('errors.validation.failed')
  .isLength({ max: 320 })
  .withMessage('errors.validation.failed');

const passwordRule = (fieldName) =>
  body(fieldName)
    .isString()
    .withMessage('errors.validation.failed')
    .isLength({ min: 8, max: 128 })
    .withMessage('errors.validation.failed');

const otpCodeRule = body('code')
  .isString()
  .withMessage('errors.validation.failed')
  .trim()
  .matches(/^\d{4,8}$/)
  .withMessage('errors.validation.failed');

export const signupValidator = [
  emailRule,
  passwordRule('password'),
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.failed')
];

export const resendOtpValidator = [
  emailRule,
  body('purpose')
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(OTP_PURPOSE_VALUES)
    .withMessage('errors.validation.failed')
];

export const verifyEmailValidator = [
  emailRule,
  otpCodeRule,
  body('inviteToken')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 10, max: 512 })
    .withMessage('errors.validation.failed')
];

export const loginValidator = [emailRule, passwordRule('password')];

export const refreshValidator = [
  body('refreshToken')
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .notEmpty()
    .withMessage('errors.validation.failed')
];

export const forgotPasswordValidator = [emailRule];

export const resetPasswordValidator = [
  emailRule,
  otpCodeRule,
  passwordRule('newPassword')
];

export const changePasswordValidator = [
  passwordRule('currentPassword'),
  passwordRule('newPassword'),
  body('newPassword').custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error('errors.validation.failed');
    }

    return true;
  })
];
