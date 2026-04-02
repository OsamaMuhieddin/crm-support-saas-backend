import mongoose from 'mongoose';
import {
  BILLING_PROVIDER,
  BILLING_PROVIDER_VALUES,
} from '../../../constants/billing-provider.js';
import {
  BILLING_WEBHOOK_EVENT_STATUS,
  BILLING_WEBHOOK_EVENT_STATUS_VALUES,
} from '../../../constants/billing-webhook-event-status.js';

const billingWebhookEventSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
    },
    provider: {
      type: String,
      required: true,
      enum: BILLING_PROVIDER_VALUES,
      default: BILLING_PROVIDER.STRIPE,
    },
    eventId: {
      type: String,
      required: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: BILLING_WEBHOOK_EVENT_STATUS_VALUES,
      default: BILLING_WEBHOOK_EVENT_STATUS.PENDING,
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    enqueuedAt: {
      type: Date,
      default: null,
    },
    processingJobId: {
      type: String,
      trim: true,
      default: null,
    },
    attemptsCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    payloadHash: {
      type: String,
      trim: true,
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    normalizedPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    lastEnqueueError: {
      type: String,
      default: null,
    },
  },
  {
    strict: true,
    timestamps: true,
  }
);

billingWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
billingWebhookEventSchema.index({ status: 1, receivedAt: 1 });
billingWebhookEventSchema.index({ provider: 1, eventType: 1, receivedAt: -1 });
billingWebhookEventSchema.index({ workspaceId: 1, receivedAt: -1 });

export const BillingWebhookEvent =
  mongoose.models.BillingWebhookEvent ||
  mongoose.model('BillingWebhookEvent', billingWebhookEventSchema);
