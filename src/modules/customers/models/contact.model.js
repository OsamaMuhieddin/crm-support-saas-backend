import mongoose from 'mongoose';
import { normalizeEmail, normalizeName } from '../../../shared/utils/normalize.js';

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
      default: null
    },
    tags: {
      type: [String],
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
  if (this.isModified('fullName') || !this.nameNormalized) {
    this.nameNormalized = normalizeName(this.fullName);
  }

  if (this.isModified('email')) {
    this.emailNormalized = normalizeEmail(this.email);
  }

  next();
});

contactSchema.index(
  { workspaceId: 1, emailNormalized: 1 },
  { partialFilterExpression: { emailNormalized: { $type: 'string' } } }
);
contactSchema.index({ workspaceId: 1, organizationId: 1 });
contactSchema.index({ workspaceId: 1, nameNormalized: 1 });

export const Contact =
  mongoose.models.Contact || mongoose.model('Contact', contactSchema);

