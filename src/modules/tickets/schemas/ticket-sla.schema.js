import mongoose from 'mongoose';
import businessHoursDaySchema from '../../sla/schemas/business-hours-day.schema.js';

const ticketSlaSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SlaPolicy',
      default: null,
    },
    policyName: {
      type: String,
      trim: true,
      default: null,
    },
    businessHoursId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessHours',
      default: null,
    },
    businessHoursName: {
      type: String,
      trim: true,
      default: null,
    },
    businessHoursTimezone: {
      type: String,
      trim: true,
      default: null,
    },
    businessHoursWeeklySchedule: {
      type: [businessHoursDaySchema],
      default: [],
    },
    policySource: {
      type: String,
      enum: ['mailbox', 'workspace_default', null],
      default: null,
    },
    firstResponseTargetMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    resolutionTargetMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    firstResponseRemainingMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    resolutionRemainingMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    firstResponseDueAt: {
      type: Date,
      default: null,
    },
    nextResponseDueAt: {
      type: Date,
      default: null,
    },
    resolutionDueAt: {
      type: Date,
      default: null,
    },
    firstResponseAt: {
      type: Date,
      default: null,
    },
    firstResponseBreachedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolutionBreachedAt: {
      type: Date,
      default: null,
    },
    isFirstResponseBreached: {
      type: Boolean,
      default: false,
    },
    isResolutionBreached: {
      type: Boolean,
      default: false,
    },
    resolutionConsumedBusinessMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    resolutionRemainingBusinessMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    resolutionPausedAt: {
      type: Date,
      default: null,
    },
    isResolutionPaused: {
      type: Boolean,
      default: false,
    },
    resolutionPausedReason: {
      type: String,
      trim: true,
      default: null,
    },
    resolutionRunningSince: {
      type: Date,
      default: null,
    },
    reopenCount: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
    strict: true,
  }
);

export default ticketSlaSchema;
