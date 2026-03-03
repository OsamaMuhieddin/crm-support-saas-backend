import mongoose from 'mongoose';
import {
  PLATFORM_ROLE_VALUES,
  PLATFORM_ROLES
} from '../../../constants/platform-roles.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';

const platformAdminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320
    },
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
      set: normalizeEmail
    },
    passwordHash: {
      type: String,
      trim: true,
      default: null
    },
    role: {
      type: String,
      required: true,
      enum: PLATFORM_ROLE_VALUES,
      default: PLATFORM_ROLES.PLATFORM_ADMIN
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'suspended'],
      default: 'active'
    },
    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

platformAdminSchema.pre('validate', function normalizePlatformAdminFields(next) {
  if (this.isModified('email') || !this.emailNormalized) {
    this.emailNormalized = normalizeEmail(this.email);
  }

  next();
});

platformAdminSchema.index({ emailNormalized: 1 }, { unique: true });
platformAdminSchema.index({ role: 1 });
platformAdminSchema.index({ status: 1 });

export const PlatformAdmin =
  mongoose.models.PlatformAdmin ||
  mongoose.model('PlatformAdmin', platformAdminSchema);
