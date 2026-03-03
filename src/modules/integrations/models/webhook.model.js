import mongoose from 'mongoose';

const webhookSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    url: {
      type: String,
      required: true,
      trim: true
    },
    secretHash: {
      type: String,
      required: true,
      trim: true
    },
    events: {
      type: [String],
      default: []
    },
    enabled: {
      type: Boolean,
      default: true
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

webhookSchema.index({ workspaceId: 1, enabled: 1 });

export const Webhook =
  mongoose.models.Webhook || mongoose.model('Webhook', webhookSchema);

