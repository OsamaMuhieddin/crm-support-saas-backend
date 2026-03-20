import mongoose from 'mongoose';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone
} from '../../../shared/utils/normalize.js';
import {
  isNormalizedEmailLike,
  normalizeNullableEmailForWriteOrThrow
} from '../utils/customer.helpers.js';

const contactSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180
    },
    nameNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      set: normalizeName
    },
    email: {
      type: String,
      trim: true,
      maxlength: 320,
      validate: {
        validator: (value) => value === null || value === undefined || isNormalizedEmailLike(value),
        message: 'errors.validation.invalidEmail'
      },
      default: null
    },
    emailNormalized: {
      type: String,
      trim: true,
      maxlength: 320,
      default: null,
      set: normalizeEmail
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 40,
      set: normalizePhone,
      default: null
    },
    tags: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 50
        }
      ],
      default: []
    },
    customFields: {
      type: mongoose.Schema.Types.Mixed,
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

contactSchema.pre('validate', function normalizeContactFields(next) {
  try {
    if (this.isModified('fullName') || !this.nameNormalized) {
      this.nameNormalized = normalizeName(this.fullName);
    }

    if (this.isModified('email')) {
      const normalizedEmail = normalizeNullableEmailForWriteOrThrow({
        value: this.email,
        field: 'email'
      });

      this.email = normalizedEmail;
      this.emailNormalized = normalizedEmail;
    }

    next();
  } catch (error) {
    next(error);
  }
});

contactSchema.index(
  { workspaceId: 1, emailNormalized: 1 },
  {
    partialFilterExpression: {
      deletedAt: null,
      emailNormalized: { $type: 'string' }
    }
  }
);
contactSchema.index(
  { workspaceId: 1, organizationId: 1 },
  { partialFilterExpression: { deletedAt: null } }
);
contactSchema.index(
  { workspaceId: 1, nameNormalized: 1 },
  { partialFilterExpression: { deletedAt: null } }
);
contactSchema.index(
  { workspaceId: 1, updatedAt: -1 },
  { partialFilterExpression: { deletedAt: null } }
);

export const Contact =
  mongoose.models.Contact || mongoose.model('Contact', contactSchema);
