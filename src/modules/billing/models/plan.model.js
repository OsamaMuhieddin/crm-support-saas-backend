import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 8,
    },
    limits: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    catalogVersion: {
      type: String,
      trim: true,
      default: null,
    },
    providerMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    strict: true,
    timestamps: true,
  }
);

planSchema.index({ key: 1 }, { unique: true });
planSchema.index({ isActive: 1, sortOrder: 1, key: 1 });

export const Plan = mongoose.models.Plan || mongoose.model('Plan', planSchema);
