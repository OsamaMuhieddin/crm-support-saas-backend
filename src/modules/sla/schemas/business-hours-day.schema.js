import mongoose from 'mongoose';

const businessHoursWindowSchema = new mongoose.Schema(
  {
    start: {
      type: String,
      required: true,
      trim: true
    },
    end: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    _id: false,
    strict: true
  }
);

const businessHoursDaySchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6
    },
    isOpen: {
      type: Boolean,
      default: false
    },
    windows: {
      type: [businessHoursWindowSchema],
      default: []
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default businessHoursDaySchema;

