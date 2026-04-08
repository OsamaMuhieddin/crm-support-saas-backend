import { body } from 'express-validator';
import { OTP_PURPOSE_VALUES } from '../../../constants/otp-purpose.js';
import { buildAllowedBodyValidation } from '../../../shared/validators/body-validation.js';

const emailRule = body('email')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .isEmail()
  .withMessage('errors.validation.invalidEmail')
  .isLength({ max: 320 })
  .withMessage('errors.validation.maxLength');

const passwordRule = (fieldName) =>
  body(fieldName)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 8, max: 128 })
    .withMessage('errors.validation.lengthRange');

const otpCodeRule = body('code')
  .isString()
  .withMessage('errors.validation.invalid')
  .trim()
  .matches(/^\d{4,8}$/)
  .withMessage('errors.validation.otpLength');

export const signupValidator = [
  emailRule,
  passwordRule('password'),
  body('name')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage('errors.validation.lengthRange'),
];

export const resendOtpValidator = [
  emailRule,
  body('purpose')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(OTP_PURPOSE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
];

export const verifyEmailValidator = [
  emailRule,
  otpCodeRule,
  body('inviteToken')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 10, max: 512 })
    .withMessage('errors.validation.lengthRange'),
];

export const loginValidator = [emailRule, passwordRule('password')];

export const refreshValidator = [
  body('refreshToken')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .notEmpty()
    .withMessage('errors.validation.required'),
];

export const forgotPasswordValidator = [emailRule];

export const resetPasswordValidator = [
  emailRule,
  otpCodeRule,
  passwordRule('newPassword'),
];

export const changePasswordValidator = [
  passwordRule('currentPassword'),
  passwordRule('newPassword'),
  body('newPassword').custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error('errors.auth.passwordMustDiffer');
    }

    return true;
  }),
];

export const updateProfileValidator = [
  body('name')
    .optional()
    .customSanitizer((value) =>
      value === null || value === undefined ? value : String(value).trim()
    )
    .custom((value) => {
      if (value === null) {
        return true;
      }

      if (typeof value !== 'string') {
        throw new Error('errors.validation.invalid');
      }

      if (value.length < 1 || value.length > 160) {
        throw new Error('errors.validation.lengthRange');
      }

      return true;
    }),
  body('avatar')
    .optional()
    .customSanitizer((value) =>
      value === null || value === undefined ? value : String(value).trim()
    )
    .custom((value) => {
      if (value === null) {
        return true;
      }

      if (typeof value !== 'string') {
        throw new Error('errors.validation.invalid');
      }

      if (value.length > 2048) {
        throw new Error('errors.validation.maxLength');
      }

      return true;
    }),
  buildAllowedBodyValidation({
    allowedFields: ['name', 'avatar'],
    requireAtLeastOne: true,
  }),
];
