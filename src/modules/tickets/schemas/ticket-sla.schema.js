import mongoose from 'mongoose';

const ticketSlaSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SlaPolicy',
      default: null
    },
    firstResponseDueAt: {
      type: Date,
      default: null
    },
    nextResponseDueAt: {
      type: Date,
      default: null
    },
    resolutionDueAt: {
      type: Date,
      default: null
    },
    firstResponseAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    isFirstResponseBreached: {
      type: Boolean,
      default: false
    },
    isResolutionBreached: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: false,
    strict: true
  }
);

export default ticketSlaSchema;

