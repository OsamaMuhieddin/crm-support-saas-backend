import mongoose from 'mongoose';
import {
  normalizeEmail,
  normalizePhone
} from '../../../shared/utils/normalize.js';

const CONTACT_IDENTITY_TYPES = Object.freeze(['email', 'phone', 'whatsapp']);

const normalizeIdentityValue = (type, value) => {
  if (type === 'email') {
    return normalizeEmail(value);
  }

  return normalizePhone(value);
};

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
  if (this.isModified('type') || this.isModified('value') || !this.valueNormalized) {
    this.valueNormalized = normalizeIdentityValue(this.type, this.value);
  }

  next();
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

