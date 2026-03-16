import { body, param } from 'express-validator';
import { TICKET_PARTICIPANT_TYPE_VALUES } from '../../../constants/ticket-participant-type.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

const ticketIdParam = param('id')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const participantUserIdParam = param('userId')
  .isMongoId()
  .withMessage('errors.validation.invalidId');

const PARTICIPANT_ALLOWED_FIELDS = ['userId', 'type'];

const participantBodyValidation = (req) => {
  const requestBody = req.body || {};
  const unknownFields = Object.keys(requestBody).filter(
    (field) => !PARTICIPANT_ALLOWED_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  }

  return [];
};

export const listTicketParticipantsValidator = [ticketIdParam];

export const saveTicketParticipantValidator = [
  ticketIdParam,
  body('userId').isMongoId().withMessage('errors.validation.invalidId'),
  body('type')
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_PARTICIPANT_TYPE_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  participantBodyValidation,
];

export const removeTicketParticipantValidator = [
  ticketIdParam,
  participantUserIdParam,
];
