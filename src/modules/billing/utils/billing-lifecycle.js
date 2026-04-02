import { billingConfig } from '../../../config/billing.config.js';
import { BILLING_SUBSCRIPTION_STATUS } from '../../../constants/billing-subscription-status.js';

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const fromUnixSeconds = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000);
};

export const mapStripeStatusToBillingStatus = (status) => {
  switch (String(status || '').trim().toLowerCase()) {
    case 'trialing':
      return BILLING_SUBSCRIPTION_STATUS.TRIALING;
    case 'active':
      return BILLING_SUBSCRIPTION_STATUS.ACTIVE;
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return BILLING_SUBSCRIPTION_STATUS.PAST_DUE;
    case 'canceled':
      return BILLING_SUBSCRIPTION_STATUS.CANCELED;
    case 'incomplete_expired':
      return BILLING_SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED;
    case 'incomplete':
    default:
      return BILLING_SUBSCRIPTION_STATUS.INCOMPLETE;
  }
};

const buildPastDueWindow = ({
  current,
  anchorDate,
  now = new Date()
}) => {
  const pastDueAt = toDateOrNull(current?.pastDueAt) || toDateOrNull(anchorDate) || now;
  const graceStartsAt =
    toDateOrNull(current?.graceStartsAt) || toDateOrNull(anchorDate) || pastDueAt;
  const graceEndsAt =
    toDateOrNull(current?.graceEndsAt) || addDays(graceStartsAt, billingConfig.graceDays);
  const partialBlockStartsAt =
    graceEndsAt.getTime() < now.getTime()
      ? toDateOrNull(current?.partialBlockStartsAt) || graceEndsAt
      : null;

  return {
    graceStartsAt,
    graceEndsAt,
    pastDueAt,
    partialBlockStartsAt
  };
};

export const buildStripeLifecyclePatch = ({
  subscription,
  stripeSubscription,
  now = new Date()
}) => {
  const nextStatus = mapStripeStatusToBillingStatus(stripeSubscription?.status);
  const trialStartedAt = fromUnixSeconds(stripeSubscription?.trial_start);
  const trialEndsAt = fromUnixSeconds(stripeSubscription?.trial_end);
  const currentPeriodStart = fromUnixSeconds(
    stripeSubscription?.current_period_start
  );
  const currentPeriodEnd = fromUnixSeconds(stripeSubscription?.current_period_end);

  const patch = {
    status: nextStatus,
    currentPeriodStart: currentPeriodStart || subscription?.currentPeriodStart || null,
    currentPeriodEnd:
      currentPeriodEnd ||
      trialEndsAt ||
      subscription?.currentPeriodEnd ||
      subscription?.trialEndsAt ||
      null,
    trialStartedAt: trialStartedAt || subscription?.trialStartedAt || null,
    trialEndsAt: trialEndsAt || subscription?.trialEndsAt || null,
    cancelAtPeriodEnd: Boolean(stripeSubscription?.cancel_at_period_end),
    canceledAt:
      fromUnixSeconds(stripeSubscription?.canceled_at) ||
      subscription?.canceledAt ||
      null,
    graceStartsAt: null,
    graceEndsAt: null,
    pastDueAt: null,
    partialBlockStartsAt: null
  };

  if (nextStatus === BILLING_SUBSCRIPTION_STATUS.PAST_DUE) {
    const window = buildPastDueWindow({
      current: subscription,
      anchorDate: now,
      now
    });

    patch.graceStartsAt = window.graceStartsAt;
    patch.graceEndsAt = window.graceEndsAt;
    patch.pastDueAt = window.pastDueAt;
    patch.partialBlockStartsAt = window.partialBlockStartsAt;
  }

  if (nextStatus === BILLING_SUBSCRIPTION_STATUS.CANCELED) {
    patch.canceledAt =
      fromUnixSeconds(stripeSubscription?.canceled_at) || subscription?.canceledAt || now;
  }

  if (nextStatus === BILLING_SUBSCRIPTION_STATUS.ACTIVE) {
    patch.canceledAt = null;
  }

  return patch;
};

export const buildLocalLifecyclePatch = ({
  subscription,
  now = new Date()
}) => {
  const trialEndsAt = toDateOrNull(subscription?.trialEndsAt);

  if (
    subscription?.stripeSubscriptionId ||
    !trialEndsAt ||
    ![
      BILLING_SUBSCRIPTION_STATUS.TRIALING,
      BILLING_SUBSCRIPTION_STATUS.PAST_DUE
    ].includes(subscription?.status)
  ) {
    return null;
  }

  if (
    subscription.status === BILLING_SUBSCRIPTION_STATUS.TRIALING &&
    trialEndsAt.getTime() > now.getTime()
  ) {
    return null;
  }

  const pastDueWindow = buildPastDueWindow({
    current: subscription,
    anchorDate: trialEndsAt,
    now
  });

  return {
    status: BILLING_SUBSCRIPTION_STATUS.PAST_DUE,
    currentPeriodStart:
      toDateOrNull(subscription?.currentPeriodStart) ||
      toDateOrNull(subscription?.trialStartedAt) ||
      toDateOrNull(subscription?.createdAt) ||
      now,
    currentPeriodEnd:
      toDateOrNull(subscription?.currentPeriodEnd) || pastDueWindow.graceEndsAt,
    trialStartedAt: toDateOrNull(subscription?.trialStartedAt),
    trialEndsAt,
    graceStartsAt: pastDueWindow.graceStartsAt,
    graceEndsAt: pastDueWindow.graceEndsAt,
    pastDueAt: pastDueWindow.pastDueAt,
    partialBlockStartsAt: pastDueWindow.partialBlockStartsAt
  };
};
