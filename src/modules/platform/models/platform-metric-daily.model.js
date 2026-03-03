import mongoose from 'mongoose';

const platformMetricDailyTotalsSchema = new mongoose.Schema(
  {
    workspacesCount: {
      type: Number,
      min: 0,
      default: 0
    },
    activeUsersCount: {
      type: Number,
      min: 0,
      default: 0
    },
    ticketsCount: {
      type: Number,
      min: 0,
      default: 0
    },
    revenueCents: {
      type: Number,
      min: 0,
      default: null
    }
  },
  {
    _id: false,
    strict: true
  }
);

const platformMetricDailySchema = new mongoose.Schema(
  {
    dateKey: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    totals: {
      type: platformMetricDailyTotalsSchema,
      default: () => ({})
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

platformMetricDailySchema.index({ dateKey: 1 }, { unique: true });

export const PlatformMetricDaily =
  mongoose.models.PlatformMetricDaily ||
  mongoose.model('PlatformMetricDaily', platformMetricDailySchema);
