import { body, param, query } from 'express-validator';
import {
  TICKET_MESSAGE_TYPE_VALUES,
  TICKET_MESSAGE_TYPE,
} from '../../../constants/ticket-message-type.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const MESSAGE_LIST_SORT_ALLOWLIST = ['createdAt', '-createdAt'];
const MESSAGE_CREATE_ALLOWED_FIELDS = [
  'type',
  'bodyText',
  'bodyHtml',
  'attachmentFileIds',
];

const MESSAGE_CREATE_TYPE_VALUES = [
  TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
  TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
  TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
];

const validateUniqueMongoIdArray = (field) =>
  body(field).custom((value) => {
    if (!Array.isArray(value)) {
      return true;
    }

    const ids = value.map((item) => String(item));
    if (new Set(ids).size !== ids.length) {
      throw new Error('errors.validation.duplicateValues');
    }

    return true;
  });

const buildAllowedBodyValidation = (allowedFields) => (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !allowedFields.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

const ticketIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const optionalNullableTrimmedField = (field, maxLength) =>
  body(field)
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

export const ticketConversationByTicketIdValidator = [ticketIdParam];

export const listTicketMessagesValidator = [
  ticketIdParam,
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
  query('type')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_MESSAGE_TYPE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(MESSAGE_LIST_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
];

export const createTicketMessageValidator = [
  ticketIdParam,
  body('type')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(MESSAGE_CREATE_TYPE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  body('bodyText')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableTrimmedField('bodyHtml', 50000),
  body('attachmentFileIds')
    .optional()
    .isArray({ max: 20 })
    .withMessage('errors.validation.invalid'),
  body('attachmentFileIds.*')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  validateUniqueMongoIdArray('attachmentFileIds'),
  buildAllowedBodyValidation(MESSAGE_CREATE_ALLOWED_FIELDS),
];
