import { body, param } from 'express-validator';
import {
  CONTACT_IDENTITY_TYPES,
  CONTACT_IDENTITY_WRITEABLE_FIELDS,
} from '../utils/contact-identity.helpers.js';
import {
  buildAllowedBodyValidation,
  toNormalizedPhoneString,
  validatePlausiblePhone,
} from './customer-validation.helpers.js';

const CONTACT_IDENTITY_PHONE_MAX_LENGTH = 40;

const contactIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const listContactIdentitiesValidator = [contactIdParam];

export const createContactIdentityValidator = [
  contactIdParam,
  body('type')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .toLowerCase()
    .isIn(CONTACT_IDENTITY_TYPES)
    .withMessage('errors.validation.invalidEnum'),
  body('value')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .custom((value) => {
      if (!value) {
        throw new Error('errors.validation.lengthRange');
      }

      return true;
    }),
  body('value')
    .if((value, { req }) => req.body.type === 'email')
    .isEmail()
    .withMessage('errors.validation.invalidEmail')
    .isLength({ max: 320 })
    .withMessage('errors.validation.maxLength'),
  body('value')
    .if((value, { req }) =>
      ['phone', 'whatsapp'].includes(String(req.body.type || ''))
    )
    .isLength({ max: CONTACT_IDENTITY_PHONE_MAX_LENGTH })
    .withMessage('errors.validation.maxLength')
    .custom(validatePlausiblePhone)
    .customSanitizer(toNormalizedPhoneString),
];

export const createContactIdentityBodyValidation = buildAllowedBodyValidation({
  allowedFields: CONTACT_IDENTITY_WRITEABLE_FIELDS,
});
