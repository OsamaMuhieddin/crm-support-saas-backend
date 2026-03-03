export const BILLING_SUBSCRIPTION_STATUS = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete'
});

export const BILLING_SUBSCRIPTION_STATUS_VALUES = Object.freeze(
  Object.values(BILLING_SUBSCRIPTION_STATUS)
);

