import mongoose from 'mongoose';
import subscriptionAddonItemSchema from '../schemas/subscription-addon-item.schema.js';
import {
  BILLING_SUBSCRIPTION_STATUS_VALUES,
  BILLING_SUBSCRIPTION_STATUS
} from '../../../constants/billing-subscription-status.js';
import {
  BILLING_PROVIDER,
  BILLING_PROVIDER_VALUES
} from '../../../constants/billing-provider.js';

const subscriptionSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      default: null
    },
    planKey: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    addonItems: {
      type: [subscriptionAddonItemSchema],
      default: []
    },
    status: {
      type: String,
      required: true,
      enum: BILLING_SUBSCRIPTION_STATUS_VALUES,
      default: BILLING_SUBSCRIPTION_STATUS.TRIALING
    },
    provider: {
      type: String,
      required: true,
      enum: BILLING_PROVIDER_VALUES,
      default: BILLING_PROVIDER.STRIPE
    },
    stripeCustomerId: {
      type: String,
      trim: true,
      default: null
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
      default: null
    },
    currentPeriodStart: {
      type: Date,
      default: null
    },
    trialStartedAt: {
      type: Date,
      default: null
    },
    trialEndsAt: {
      type: Date,
      default: null
    },
    currentPeriodEnd: {
      type: Date,
      default: null
    },
    graceStartsAt: {
      type: Date,
      default: null
    },
    graceEndsAt: {
      type: Date,
      default: null
    },
    pastDueAt: {
      type: Date,
      default: null
    },
    partialBlockStartsAt: {
      type: Date,
      default: null
    },
    canceledAt: {
      type: Date,
      default: null
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    lastSyncedAt: {
      type: Date,
      default: null
    },
    catalogVersion: {
      type: String,
      trim: true,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

subscriptionSchema.index(
  { workspaceId: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);
subscriptionSchema.index(
  { stripeCustomerId: 1 },
  { partialFilterExpression: { stripeCustomerId: { $type: 'string' } } }
);
subscriptionSchema.index(
  { stripeSubscriptionId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeSubscriptionId: { $type: 'string' } }
  }
);

export const Subscription =
  mongoose.models.Subscription ||
  mongoose.model('Subscription', subscriptionSchema);
