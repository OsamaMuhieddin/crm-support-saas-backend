export const BILLING_WEBHOOK_EVENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSED: 'processed',
  FAILED: 'failed',
});

export const BILLING_WEBHOOK_EVENT_STATUS_VALUES = Object.freeze(
  Object.values(BILLING_WEBHOOK_EVENT_STATUS)
);
