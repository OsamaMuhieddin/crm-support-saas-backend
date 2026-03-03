import mongoose from 'mongoose';
import { OTP_PURPOSE_VALUES, OTP_PURPOSE } from '../../../constants/otp-purpose.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';

const otpCodeSchema = new mongoose.Schema(
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    purpose: {
      type: String,
      required: true,
      enum: OTP_PURPOSE_VALUES,
      default: OTP_PURPOSE.LOGIN
    },
    codeHash: {
      type: String,
      required: true,
      trim: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    consumedAt: {
      type: Date,
      default: null
    },
    attemptCount: {
      type: Number,
      min: 0,
      default: 0
    },
    lastSentAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

otpCodeSchema.pre('validate', function normalizeEmailFields(next) {
  if (this.isModified('email') || !this.emailNormalized) {
    this.emailNormalized = normalizeEmail(this.email);
  }

  next();
});

otpCodeSchema.index({ emailNormalized: 1, purpose: 1, createdAt: -1 });
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpCode =
  mongoose.models.OtpCode || mongoose.model('OtpCode', otpCodeSchema);

