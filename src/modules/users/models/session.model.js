import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null
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

sessionSchema.index({ userId: 1, createdAt: -1 });
sessionSchema.index({ refreshTokenHash: 1 });
sessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session =
  mongoose.models.Session || mongoose.model('Session', sessionSchema);

