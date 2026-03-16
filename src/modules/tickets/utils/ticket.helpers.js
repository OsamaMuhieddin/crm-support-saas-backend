import mongoose from 'mongoose';

export const normalizeObjectId = (value) => String(value || '');

export const normalizeNullableString = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

export const parseNullableBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const lowered = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(lowered)) {
    return true;
  }

  if (['0', 'false', 'no'].includes(lowered)) {
    return false;
  }

  return null;
};

export const buildI18nArgRef = (key, args = null) => {
  if (!key) {
    return null;
  }

  const ref = { key };

  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
    ref.args = args;
  }

  return ref;
};

export const buildTicketStatusI18nArg = (status) =>
  status ? buildI18nArgRef(`ticketStatus.${String(status)}`) : null;

export const buildTicketMessageTypeI18nArg = (type) =>
  type ? buildI18nArgRef(`ticketMessageType.${String(type)}`) : null;
