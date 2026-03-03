import mongoose from 'mongoose';
import userProfileSchema from '../schemas/user-profile.schema.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import { PLATFORM_ROLE_VALUES } from '../../../constants/platform-roles.js';

const userSchema = new mongoose.Schema(
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
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    profile: {
      type: userProfileSchema,
      default: () => ({})
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active'
    },
    platformRole: {
      type: String,
      enum: PLATFORM_ROLE_VALUES,
      default: null
    },
    defaultWorkspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null
    },
    lastWorkspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null
    },
    lastLoginAt: {
      type: Date,
      default: null
    },
    deletedAt: {
      type: Date,
      default: null
    },
    anonymizedAt: {
      type: Date,
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

userSchema.pre('validate', function normalizeEmailFields(next) {
  if (this.isModified('email') || !this.emailNormalized) {
    this.emailNormalized = normalizeEmail(this.email);
  }

  next();
});

userSchema.index({ emailNormalized: 1 }, { unique: true });
userSchema.index({ defaultWorkspaceId: 1 });
userSchema.index({ platformRole: 1 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
