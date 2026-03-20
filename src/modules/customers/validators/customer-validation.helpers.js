import { normalizePhone } from '../../../shared/utils/normalize.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';

export const buildAllowedBodyValidation = ({
  allowedFields,
  requireAtLeastOne = false
}) => {
  return (req) => {
    const requestBody = req.body || {};
    const unknownFields = Object.keys(requestBody).filter(
      (field) => !allowedFields.includes(field)
    );

    const errors = unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );

    if (requireAtLeastOne) {
      const hasAllowedField = allowedFields.some((field) =>
        Object.prototype.hasOwnProperty.call(requestBody, field)
      );

      if (!hasAllowedField) {
        errors.push(
          buildValidationError(
            'body',
            'errors.validation.bodyRequiresAtLeastOneField'
          )
        );
      }
    }

    return errors;
  };
};

export const toNullableTrimmedString = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const validatePlausiblePhone = (value) => {
  if (!normalizePhone(value)) {
    throw new Error('errors.validation.invalidPhone');
  }

  return true;
};

export const toNormalizedPhoneString = (value) => {
  if (value === undefined || value === null || typeof value !== 'string') {
    return value;
  }

  return normalizePhone(value) || value;
};
