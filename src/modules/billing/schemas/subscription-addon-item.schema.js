import mongoose from 'mongoose';

const subscriptionAddonItemSchema = new mongoose.Schema(
  {
    addonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Addon',
      default: null
    },
    addonKey: {
      type: String,
      trim: true,
      default: null
    },
    quantity: {
      type: Number,
      min: 1,
      default: 1
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default subscriptionAddonItemSchema;

