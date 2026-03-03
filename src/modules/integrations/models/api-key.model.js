import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
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
      maxlength: 120
    },
    keyHash: {
      type: String,
      required: true,
      trim: true
    },
    scopes: {
      type: [String],
      default: []
    },
    lastUsedAt: {
      type: Date,
      default: null
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    revokedAt: {
      type: Date,
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

apiKeySchema.index({ keyHash: 1 }, { unique: true });
apiKeySchema.index({ workspaceId: 1, createdAt: -1 });

export const ApiKey =
  mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);

