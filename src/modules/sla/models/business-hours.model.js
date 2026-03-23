import mongoose from 'mongoose';
import businessHoursDaySchema from '../schemas/business-hours-day.schema.js';
import businessHoursHolidaySchema from '../schemas/business-hours-holiday.schema.js';

const businessHoursSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
      default: 'UTC',
    },
    weeklySchedule: {
      type: [businessHoursDaySchema],
      default: [],
    },
    holidays: {
      type: [businessHoursHolidaySchema],
      default: [],
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    strict: true,
    timestamps: true,
  }
);

businessHoursSchema.index({ workspaceId: 1 });
businessHoursSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  name: 1,
});

export const BusinessHours =
  mongoose.models.BusinessHours ||
  mongoose.model('BusinessHours', businessHoursSchema);
