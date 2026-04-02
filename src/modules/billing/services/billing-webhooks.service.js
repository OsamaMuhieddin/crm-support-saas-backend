import { billingConfig } from '../../../config/billing.config.js';
import { BILLING_WEBHOOK_EVENT_STATUS } from '../../../constants/billing-webhook-event-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { BillingWebhookEvent } from '../models/billing-webhook-event.model.js';
import { enqueueBillingWebhookEvent } from './billing-queue.service.js';
import { persistStripeWebhookEvent } from './billing-sync.service.js';
import {
  buildStripePayloadHash,
  verifyStripeWebhookEvent
} from './providers/stripe-billing.provider.js';

const toBufferPayload = (value) => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return Buffer.from(value);
  }

  if (value && typeof value === 'object') {
    return Buffer.from(JSON.stringify(value));
  }

  return Buffer.from('');
};

const parseWebhookPayloadOrThrow = (payloadBuffer) => {
  try {
    return JSON.parse(payloadBuffer.toString('utf8') || '{}');
  } catch (error) {
    throw createError('errors.billing.webhookPayloadInvalid', 400);
  }
};

const getDuplicateEnqueueSkipReason = (webhookEvent) => {
  if (!webhookEvent || !webhookEvent._id) {
    throw createError('errors.billing.webhookProcessingFailed', 500);
  }

  if (webhookEvent.status === BILLING_WEBHOOK_EVENT_STATUS.PROCESSED) {
    return 'already_processed';
  }

  if (
    webhookEvent.status === BILLING_WEBHOOK_EVENT_STATUS.PENDING &&
    webhookEvent.processingJobId
  ) {
    return 'already_queued';
  }

  return null;
};

export const acceptStripeWebhookEvent = async ({
  signature,
  rawBody
}) => {
  if (billingConfig.provider !== 'stripe') {
    throw createError('errors.billing.disabled', 503);
  }

  const payloadBuffer = toBufferPayload(rawBody);
  const event = verifyStripeWebhookEvent({
    payload: payloadBuffer,
    signature
  });

  const payloadHash = buildStripePayloadHash(payloadBuffer);
  const persisted = await persistStripeWebhookEvent({
    event,
    payloadHash,
    payload: parseWebhookPayloadOrThrow(payloadBuffer)
  });

  const skipEnqueueReason = !persisted.created
    ? getDuplicateEnqueueSkipReason(persisted.webhookEvent)
    : null;

  let enqueueResult = {
    enqueued: false,
    job: null,
    reason: skipEnqueueReason || 'queue_unavailable'
  };

  if (!skipEnqueueReason) {
    try {
      enqueueResult = await enqueueBillingWebhookEvent({
        webhookEventId: String(persisted.webhookEvent._id)
      });

      if (enqueueResult.enqueued) {
        await BillingWebhookEvent.updateOne(
          { _id: persisted.webhookEvent._id },
          {
            $set: {
              enqueuedAt: new Date(),
              processingJobId: enqueueResult.job?.id || null,
              lastEnqueueError: null
            }
          }
        );
      } else {
        await BillingWebhookEvent.updateOne(
          { _id: persisted.webhookEvent._id },
          {
            $set: {
              lastEnqueueError: enqueueResult.reason || 'queue_unavailable'
            }
          }
        );
      }
    } catch (error) {
      await BillingWebhookEvent.updateOne(
        { _id: persisted.webhookEvent._id },
        {
          $set: {
            lastEnqueueError:
              error?.messageKey || error?.message || 'queue_enqueue_failed'
          }
        }
      );
    }
  }

  return {
    accepted: true,
    duplicate: !persisted.created,
    queued: enqueueResult.enqueued,
    webhookEventId: String(persisted.webhookEvent._id),
    eventId: event.id,
    eventType: event.type
  };
};
