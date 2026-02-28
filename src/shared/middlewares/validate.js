import { createError } from '../errors/createError.js';
import { validationResult } from 'express-validator';

export const buildValidationError = (field, messageKey, args = null) => {
  const error = {
    field,
    messageKey,
    msg: { key: messageKey }
  };

  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
    error.args = args;
    error.msg.args = args;
  }

  return error;
};

export const validate = (validator) => {
  return async (req, res, next) => {
    try {
      const customErrors = [];
      const validators = Array.isArray(validator) ? validator : [validator];

      for (const rule of validators) {
        if (!rule) continue;

        if (typeof rule.run === 'function') {
          await rule.run(req);
          continue;
        }

        if (typeof rule === 'function') {
          const result = await rule(req);
          if (Array.isArray(result) && result.length > 0) {
            customErrors.push(...result);
          }
        }
      }

      const expressErrors = validationResult(req)
        .array({ onlyFirstError: true })
        .map((error) => {
          const field = error.path || error.param || 'unknown';
          const messageKey =
            typeof error.msg === 'string' && error.msg.includes('.')
              ? error.msg
              : 'errors.validation.failed';

          return buildValidationError(field, messageKey);
        });

      const errors = [...customErrors, ...expressErrors];

      if (Array.isArray(errors) && errors.length > 0) {
        return next(createError('errors.validation.failed', 422, errors));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export default validate;
