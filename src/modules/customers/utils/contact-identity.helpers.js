import {
  buildCustomersValidationError,
  normalizeNullableEmailForWriteOrThrow,
  normalizeNullablePhoneForWriteOrThrow,
  normalizeNullableString,
  normalizeObjectId
} from './customer.helpers.js';

export const CONTACT_IDENTITY_TYPES = Object.freeze([
  'email',
  'phone',
  'whatsapp'
]);

export const CONTACT_IDENTITY_WRITEABLE_FIELDS = Object.freeze([
  'type',
  'value'
]);

export const CONTACT_IDENTITY_VIEW_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  contactId: 1,
  type: 1,
  value: 1,
  verifiedAt: 1,
  createdAt: 1,
  updatedAt: 1
};

export const normalizeContactIdentityType = (value) =>
  String(value || '').trim().toLowerCase();

export const buildContactIdentityView = (identity) => ({
  _id: normalizeObjectId(identity._id),
  workspaceId: normalizeObjectId(identity.workspaceId),
  contactId: normalizeObjectId(identity.contactId),
  type: identity.type,
  value: identity.value,
  verifiedAt: identity.verifiedAt || null,
  createdAt: identity.createdAt,
  updatedAt: identity.updatedAt
});

export const normalizeContactIdentityTypeOrThrow = ({
  type,
  field = 'type'
} = {}) => {
  const normalizedType = normalizeContactIdentityType(type);

  if (!CONTACT_IDENTITY_TYPES.includes(normalizedType)) {
    throw buildCustomersValidationError(field, 'errors.validation.invalidEnum');
  }

  return normalizedType;
};

export const normalizeContactIdentityValueForWriteOrThrow = ({
  type,
  value,
  field = 'value'
} = {}) => {
  let normalizedValue;

  if (type === 'email') {
    normalizedValue = normalizeNullableEmailForWriteOrThrow({ value, field });
  } else if (['phone', 'whatsapp'].includes(type)) {
    normalizedValue = normalizeNullablePhoneForWriteOrThrow({ value, field });
  } else {
    normalizedValue = normalizeNullableString(value);
  }

  if (normalizedValue === undefined || normalizedValue === null) {
    throw buildCustomersValidationError(field, 'errors.validation.invalid');
  }

  return normalizedValue;
};

export const normalizeContactIdentityCreatePayload = (payload = {}) => {
  const type = normalizeContactIdentityTypeOrThrow({
    type: payload.type
  });
  const value = normalizeContactIdentityValueForWriteOrThrow({
    type,
    value: payload.value
  });

  return {
    type,
    value
  };
};
