import mongoose from 'mongoose';
import {
  normalizeDomain,
  normalizeName
} from '../../../shared/utils/normalize.js';
import {
  isNormalizedDomainLike,
  normalizeNullableDomainForWriteOrThrow
} from '../utils/customer.helpers.js';

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
      maxlength: 253,
      set: normalizeDomain,
      validate: {
        validator: (value) =>
          value === null || value === undefined || isNormalizedDomainLike(value),
        message: 'errors.validation.invalidDomain'
      },
      default: null
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 5000,
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
  try {
    if (this.isModified('name') || !this.nameNormalized) {
      this.nameNormalized = normalizeName(this.name);
    }

    if (this.isModified('domain')) {
      this.domain = normalizeNullableDomainForWriteOrThrow({
        value: this.domain,
        field: 'domain'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

organizationSchema.index(
  { workspaceId: 1, nameNormalized: 1 },
  { partialFilterExpression: { deletedAt: null } }
);
organizationSchema.index(
  { workspaceId: 1, domain: 1 },
  {
    partialFilterExpression: {
      deletedAt: null,
      domain: { $type: 'string' }
    }
  }
);
organizationSchema.index(
  { workspaceId: 1, createdAt: -1 },
  { partialFilterExpression: { deletedAt: null } }
);
organizationSchema.index(
  { workspaceId: 1, updatedAt: -1 },
  { partialFilterExpression: { deletedAt: null } }
);

export const Organization =
  mongoose.models.Organization ||
  mongoose.model('Organization', organizationSchema);
