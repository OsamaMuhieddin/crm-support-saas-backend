import mongoose from 'mongoose';

const platformSessionSchema = new mongoose.Schema(
  {
    platformAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlatformAdmin',
      required: true,
      index: true
    },
    refreshTokenHash: {
      type: String,
      required: true,
      trim: true
    },
    userAgent: {
      type: String,
      trim: true,
      default: null
    },
    ip: {
      type: String,
      trim: true,
      default: null
    },
    expiresAt: {
      type: Date,
      required: true
    },
    revokedAt: {
      type: Date,
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

platformSessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
platformSessionSchema.index({ platformAdminId: 1, createdAt: -1 });
platformSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PlatformSession =
  mongoose.models.PlatformSession ||
  mongoose.model('PlatformSession', platformSessionSchema);
