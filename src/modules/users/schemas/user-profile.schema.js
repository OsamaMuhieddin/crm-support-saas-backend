import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null
    },
    avatar: {
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

export default userProfileSchema;

