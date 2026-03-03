import mongoose from 'mongoose';

const usageMeterSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    periodKey: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}$/
    },
    ticketsCreated: {
      type: Number,
      min: 0,
      default: 0
    },
    storageBytesUsed: {
      type: Number,
      min: 0,
      default: 0
    },
    apiCalls: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

usageMeterSchema.index({ workspaceId: 1, periodKey: 1 }, { unique: true });
usageMeterSchema.index({ workspaceId: 1, updatedAt: -1 });

export const UsageMeter =
  mongoose.models.UsageMeter || mongoose.model('UsageMeter', usageMeterSchema);
