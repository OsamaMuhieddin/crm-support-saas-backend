import mongoose from 'mongoose';

const notificationEntitySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      trim: true,
      required: true
    },
    entityId: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default notificationEntitySchema;

