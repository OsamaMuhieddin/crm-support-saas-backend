import mongoose from 'mongoose';

const messagePartySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: null
    },
    email: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default messagePartySchema;

