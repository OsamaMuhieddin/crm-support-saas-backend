import { body, param, query } from 'express-validator';
import { TICKET_STATUS_VALUES } from '../../../constants/ticket-status.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { TICKET_PRIORITY_VALUES } from '../../../constants/ticket-priority.js';
import { TICKET_CHANNEL_VALUES } from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE } from '../../../constants/ticket-message-type.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const TICKET_SORT_ALLOWLIST = [
  'number',
  '-number',
  'subject',
  '-subject',
  'priority',
  '-priority',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
  'lastMessageAt',
  '-lastMessageAt',
];

const TICKET_CREATE_ALLOWED_FIELDS = [
  'subject',
  'mailboxId',
  'contactId',
  'organizationId',
  'priority',
  'categoryId',
  'tagIds',
  'assigneeId',
  'initialMessage',
];

const TICKET_UPDATE_ALLOWED_FIELDS = [
  'subject',
  'priority',
  'categoryId',
  'tagIds',
  'mailboxId',
];

const TICKET_ASSIGN_ALLOWED_FIELDS = ['assigneeId'];

const TICKET_STATUS_ALLOWED_FIELDS = ['status'];

const INITIAL_MESSAGE_ALLOWED_FIELDS = [
  'type',
  'bodyText',
  'bodyHtml',
  'attachmentFileIds',
];

const TICKET_STATUS_ACTION_VALUES = [
  TICKET_STATUS.OPEN,
  TICKET_STATUS.PENDING,
  TICKET_STATUS.WAITING_ON_CUSTOMER,
  TICKET_STATUS.SOLVED,
];

const CREATE_TIME_MESSAGE_TYPES = [
  TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
  TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
];

const normalizeStatusQueryValue = (value) => {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
};

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const optionalNullableTrimmedField = (field, maxLength) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isString()
    .withMessage('errors.validation.invalid')
    .isLength({ min: 1, max: maxLength })
    .withMessage('errors.validation.lengthRange');

const optionalNullableMongoIdBodyField = (field) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(toNullableString)
    .if((value) => value !== null && value !== undefined)
    .isMongoId()
    .withMessage('errors.validation.invalidId');

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

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  return [];
};

const buildAllowedNestedObjectValidation = (field, allowedFields) => (req) => {
  const nestedValue = req.body?.[field];

  if (nestedValue === undefined || nestedValue === null) {
    return [];
  }

  if (typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
    return [];
  }

  const unknownFields = Object.keys(nestedValue).filter(
    (nestedField) => !allowedFields.includes(nestedField)
  );

  return unknownFields.map((nestedField) =>
    buildValidationError(
      `${field}.${nestedField}`,
      'errors.validation.unknownField'
    )
  );
};

const buildEmptyBodyValidation = () => (req) => {
  const requestBody = req.body || {};
  const bodyFields = Object.keys(requestBody);

  if (bodyFields.length === 0) {
    return [];
  }

  return bodyFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

const buildStatusQueryValidation = () => (req) => {
  if (!Object.prototype.hasOwnProperty.call(req.query || {}, 'status')) {
    return [];
  }

  const normalizedStatuses = normalizeStatusQueryValue(req.query.status);

  if (!Array.isArray(normalizedStatuses) || normalizedStatuses.length === 0) {
    return [buildValidationError('status', 'errors.validation.invalidEnum')];
  }

  const hasInvalidStatus = normalizedStatuses.some(
    (status) => !TICKET_STATUS_VALUES.includes(status)
  );

  if (hasInvalidStatus) {
    return [buildValidationError('status', 'errors.validation.invalidEnum')];
  }

  req.query.status =
    normalizedStatuses.length === 1
      ? normalizedStatuses[0]
      : [...new Set(normalizedStatuses)];

  return [];
};

const buildDateRangeCoherenceValidation = (fromField, toField) => (req) => {
  const fromValue = req.query?.[fromField];
  const toValue = req.query?.[toField];

  if (!fromValue || !toValue) {
    return [];
  }

  const fromDate = new Date(fromValue);
  const toDate = new Date(toValue);

  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    fromDate <= toDate
  ) {
    return [];
  }

  return [
    buildValidationError(fromField, 'errors.validation.invalidDateRange'),
  ];
};

const ticketIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

export const createTicketValidator = [
  body('subject')
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 240 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableMongoIdBodyField('mailboxId'),
  body('contactId').isMongoId().withMessage('errors.validation.invalidId'),
  optionalNullableMongoIdBodyField('organizationId'),
  body('priority')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_PRIORITY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  optionalNullableMongoIdBodyField('categoryId'),
  body('tagIds')
    .optional()
    .isArray({ max: 100 })
    .withMessage('errors.validation.invalid'),
  body('tagIds.*')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  validateUniqueMongoIdArray('tagIds'),
  optionalNullableMongoIdBodyField('assigneeId'),
  body('initialMessage')
    .optional({ nullable: true })
    .isObject()
    .withMessage('errors.validation.invalid'),
  body('initialMessage.type')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(CREATE_TIME_MESSAGE_TYPES)
    .withMessage('errors.validation.invalidEnum'),
  body('initialMessage.bodyText')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('errors.validation.lengthRange'),
  optionalNullableTrimmedField('initialMessage.bodyHtml', 50000),
  body('initialMessage.attachmentFileIds')
    .optional()
    .isArray({ max: 20 })
    .withMessage('errors.validation.invalid'),
  body('initialMessage.attachmentFileIds.*')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  validateUniqueMongoIdArray('initialMessage.attachmentFileIds'),
  body('initialMessage').custom((value) => {
    if (value === undefined || value === null) {
      return true;
    }

    if (!value.type) {
      throw new Error('errors.validation.required');
    }

    if (!value.bodyText) {
      throw new Error('errors.validation.required');
    }

    return true;
  }),
  buildAllowedBodyValidation(TICKET_CREATE_ALLOWED_FIELDS),
  buildAllowedNestedObjectValidation(
    'initialMessage',
    INITIAL_MESSAGE_ALLOWED_FIELDS
  ),
];

export const listTicketsValidator = [
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
  buildStatusQueryValidation(),
  query('priority')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_PRIORITY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('mailboxId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('assigneeId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('unassigned')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('categoryId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('tagId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('contactId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('organizationId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('channel')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_CHANNEL_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('includeClosed')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('createdFrom')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('createdTo')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('updatedFrom')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('updatedTo')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_SORT_ALLOWLIST)
    .withMessage('errors.validation.invalidEnum'),
  buildDateRangeCoherenceValidation('createdFrom', 'createdTo'),
  buildDateRangeCoherenceValidation('updatedFrom', 'updatedTo'),
  query('assigneeId').custom((value, { req }) => {
    if (!value) {
      return true;
    }

    const rawUnassigned = String(req.query.unassigned || '')
      .trim()
      .toLowerCase();
    if (
      rawUnassigned === 'true' ||
      rawUnassigned === '1' ||
      rawUnassigned === 'yes'
    ) {
      throw new Error('errors.validation.invalid');
    }

    return true;
  }),
];

export const ticketByIdValidator = [ticketIdParam];

export const ticketActionByIdValidator = [
  ticketIdParam,
  buildEmptyBodyValidation(),
];

export const updateTicketValidator = [
  ticketIdParam,
  body('subject')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 240 })
    .withMessage('errors.validation.lengthRange'),
  body('priority')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_PRIORITY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  optionalNullableMongoIdBodyField('categoryId'),
  body('tagIds')
    .optional()
    .isArray({ max: 100 })
    .withMessage('errors.validation.invalid'),
  body('tagIds.*')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  validateUniqueMongoIdArray('tagIds'),
  body('mailboxId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
];

export const updateTicketBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !TICKET_UPDATE_ALLOWED_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  const hasAllowedField = TICKET_UPDATE_ALLOWED_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(requestBody, field)
  );

  if (hasAllowedField) {
    return [];
  }

  return [
    buildValidationError(
      'body',
      'errors.validation.bodyRequiresAtLeastOneField'
    ),
  ];
};

export const assignTicketValidator = [
  ticketIdParam,
  body('assigneeId').isMongoId().withMessage('errors.validation.invalidId'),
  buildAllowedBodyValidation(TICKET_ASSIGN_ALLOWED_FIELDS),
];

export const updateTicketStatusValidator = [
  ticketIdParam,
  body('status')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_STATUS_ACTION_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  buildAllowedBodyValidation(TICKET_STATUS_ALLOWED_FIELDS),
];
