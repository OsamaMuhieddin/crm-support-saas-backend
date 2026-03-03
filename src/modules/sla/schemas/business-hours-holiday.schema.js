import mongoose from 'mongoose';

const businessHoursHolidaySchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      trim: true
    },
    label: {
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

export default businessHoursHolidaySchema;

