import mongoose from 'mongoose';

export const normalizeObjectId = (value) => String(value || '');

export const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};
