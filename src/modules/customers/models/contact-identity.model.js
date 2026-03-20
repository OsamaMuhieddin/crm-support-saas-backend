import mongoose from 'mongoose';
import {
  CONTACT_IDENTITY_TYPES,
  normalizeContactIdentityTypeOrThrow,
  normalizeContactIdentityValueForWriteOrThrow
} from '../utils/contact-identity.helpers.js';

const contactIdentitySchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: true,
      index: true
    },
    type: {
      type: String,
      required: true,
      enum: CONTACT_IDENTITY_TYPES
    },
    value: {
      type: String,
      required: true,
      trim: true
    },
    valueNormalized: {
      type: String,
      required: true,
      trim: true
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

contactIdentitySchema.pre('validate', function normalizeIdentityFields(next) {
  try {
    if (
      this.isModified('type') ||
      this.isModified('value') ||
      !this.valueNormalized
    ) {
      const normalizedType = normalizeContactIdentityTypeOrThrow({
        type: this.type
      });
      const normalizedValue = normalizeContactIdentityValueForWriteOrThrow({
        type: normalizedType,
        value: this.value
      });

      this.type = normalizedType;
      this.value = normalizedValue;
      this.valueNormalized = normalizedValue;
    }

    next();
  } catch (error) {
    next(error);
  }
});

contactIdentitySchema.index(
  { workspaceId: 1, type: 1, valueNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);
contactIdentitySchema.index({ workspaceId: 1, contactId: 1 });

export const ContactIdentity =
  mongoose.models.ContactIdentity ||
  mongoose.model('ContactIdentity', contactIdentitySchema);
