import { createError } from '../../../shared/errors/createError.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

export const toValidationError = (field, messageKey) =>
  createError('errors.validation.failed', 422, [
    buildValidationError(field, messageKey),
  ]);
