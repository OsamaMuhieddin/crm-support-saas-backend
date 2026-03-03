import mongoose from 'mongoose';

const workspaceSettingsSchema = new mongoose.Schema(
  {
    timeZone: {
      type: String,
      trim: true,
      default: 'UTC'
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default workspaceSettingsSchema;

