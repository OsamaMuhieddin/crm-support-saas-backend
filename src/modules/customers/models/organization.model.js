import mongoose from 'mongoose';
import { normalizeName } from '../../../shared/utils/normalize.js';

const organizationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    name: {
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
    domain: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    notes: {
      type: String,
      trim: true,
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

organizationSchema.pre('validate', function normalizeNameFields(next) {
  if (this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeName(this.name);
  }

  next();
});

organizationSchema.index({ workspaceId: 1, nameNormalized: 1 });
organizationSchema.index(
  { workspaceId: 1, domain: 1 },
  { partialFilterExpression: { domain: { $type: 'string' } } }
);
organizationSchema.index({ workspaceId: 1, createdAt: -1 });

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', organizationSchema);

