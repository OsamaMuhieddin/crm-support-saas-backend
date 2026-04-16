import mongoose from 'mongoose';

const widgetBrandingSchema = new mongoose.Schema(
  {
    displayName: {
      type: String,
      trim: true,
      default: null,
      maxlength: 120,
    },
    accentColor: {
      type: String,
      trim: true,
      default: null,
      maxlength: 20,
    },
    launcherLabel: {
      type: String,
      trim: true,
      default: null,
      maxlength: 80,
    },
    welcomeTitle: {
      type: String,
      trim: true,
      default: null,
      maxlength: 160,
    },
    welcomeMessage: {
      type: String,
      trim: true,
      default: null,
      maxlength: 1000,
    },
  },
  {
    _id: false,
    strict: true,
  }
);

export default widgetBrandingSchema;
