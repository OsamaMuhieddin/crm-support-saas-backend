import mongoose from 'mongoose';

const entitlementSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    limits: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    computedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    sourceSnapshot: {
      type: mongoose.Schema.Types.Mixed,
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

entitlementSchema.index(
  { workspaceId: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);

export const Entitlement =
  mongoose.models.Entitlement ||
  mongoose.model('Entitlement', entitlementSchema);

