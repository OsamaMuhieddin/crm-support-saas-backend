export const BILLING_SUBSCRIPTION_STATUS = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
});

export const BILLING_SUBSCRIPTION_STATUS_VALUES = Object.freeze(
  Object.values(BILLING_SUBSCRIPTION_STATUS)
);
