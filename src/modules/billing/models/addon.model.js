import mongoose from 'mongoose';
import {
  BILLING_ADDON_TYPE_VALUES,
  BILLING_ADDON_TYPE
} from '../../../constants/billing-addon-type.js';

const addonSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    type: {
      type: String,
      required: true,
      enum: BILLING_ADDON_TYPE_VALUES,
      default: BILLING_ADDON_TYPE.FEATURE
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 8
    },
    effects: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

addonSchema.index({ key: 1 }, { unique: true });

export const Addon =
  mongoose.models.Addon || mongoose.model('Addon', addonSchema);

