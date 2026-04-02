import { createError } from '../../../shared/errors/createError.js';
import {
  BILLING_PLAN_FEATURE_KEYS,
  BILLING_PLAN_LIMIT_KEYS,
  isBillingLimitEnforced
} from '../utils/billing-canonical.js';
import {
  ensureWorkspaceBillingFoundation,
  getWorkspaceSeatUsage
} from './billing-foundation.service.js';

const getEnforcedLimit = (value) => {
  return isBillingLimitEnforced(value) ? Number(value) : null;
};

const assertPartialBlockInactive = ({ foundation }) => {
  if (!foundation?.flags?.isPartialBlockActive) {
    return;
  }

  throw createError('errors.billing.partialBlockActive', 409, null, {
    partialBlockStartsAt: foundation.subscription.partialBlockStartsAt
  });
};

const getFoundationOrThrow = async ({ workspaceId }) =>
  ensureWorkspaceBillingFoundation({ workspaceId });

export const assertWorkspaceSeatReservationAllowed = async ({
  workspaceId
}) => {
  const foundation = await getFoundationOrThrow({ workspaceId });
  assertPartialBlockInactive({ foundation });

  const seatLimit = getEnforcedLimit(
    foundation.entitlement?.limits?.[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]
  );

  if (seatLimit === null) {
    return foundation;
  }

  const projectedSeatsUsed = Number(foundation.usage?.current?.seatsUsed || 0) + 1;

  if (projectedSeatsUsed > seatLimit) {
    throw createError('errors.billing.seatLimitExceeded', 409, null, {
      limit: seatLimit,
      current: Number(foundation.usage?.current?.seatsUsed || 0),
      projected: projectedSeatsUsed
    });
  }

  return foundation;
};

export const assertWorkspaceMemberActivationAllowed = async ({
  workspaceId,
  reservedInviteId = null
}) => {
  const foundation = await getFoundationOrThrow({ workspaceId });
  assertPartialBlockInactive({ foundation });

  const seatLimit = getEnforcedLimit(
    foundation.entitlement?.limits?.[BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]
  );

  if (seatLimit === null) {
    return foundation;
  }

  const seatUsage = await getWorkspaceSeatUsage({
    workspaceId,
    excludeInviteId: reservedInviteId
  });
  const projectedSeatsUsed = Number(seatUsage.seatsUsed || 0) + 1;

  if (projectedSeatsUsed > seatLimit) {
    throw createError('errors.billing.seatLimitExceeded', 409, null, {
      limit: seatLimit,
      current: Number(seatUsage.seatsUsed || 0),
      projected: projectedSeatsUsed
    });
  }

  return foundation;
};

export const assertWorkspaceMailboxWriteAllowed = async ({
  workspaceId
}) => {
  const foundation = await getFoundationOrThrow({ workspaceId });
  assertPartialBlockInactive({ foundation });

  const mailboxLimit = getEnforcedLimit(
    foundation.entitlement?.limits?.[BILLING_PLAN_LIMIT_KEYS.MAILBOXES]
  );

  if (mailboxLimit === null) {
    return foundation;
  }

  const projectedActiveMailboxes =
    Number(foundation.usage?.current?.activeMailboxes || 0) + 1;

  if (projectedActiveMailboxes > mailboxLimit) {
    throw createError('errors.billing.mailboxLimitExceeded', 409, null, {
      limit: mailboxLimit,
      current: Number(foundation.usage?.current?.activeMailboxes || 0),
      projected: projectedActiveMailboxes
    });
  }

  return foundation;
};

export const assertWorkspaceUploadAllowed = async ({
  workspaceId,
  incomingSizeBytes
}) => {
  const foundation = await getFoundationOrThrow({ workspaceId });
  assertPartialBlockInactive({ foundation });

  const storageLimit = getEnforcedLimit(
    foundation.entitlement?.limits?.[BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]
  );
  const uploadsLimit = getEnforcedLimit(
    foundation.entitlement?.limits?.[BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]
  );
  const currentStorageBytes = Number(foundation.usage?.current?.storageBytes || 0);
  const projectedStorageBytes =
    currentStorageBytes + Math.max(0, Number(incomingSizeBytes || 0));
  const currentUploadsCount = Number(
    foundation.usage?.monthly?.uploadsCount || 0
  );
  const projectedUploadsCount = currentUploadsCount + 1;

  if (storageLimit !== null && projectedStorageBytes > storageLimit) {
    throw createError('errors.billing.storageLimitExceeded', 409, null, {
      limit: storageLimit,
      current: currentStorageBytes,
      projected: projectedStorageBytes
    });
  }

  if (uploadsLimit !== null && projectedUploadsCount > uploadsLimit) {
    throw createError('errors.billing.uploadLimitExceeded', 409, null, {
      limit: uploadsLimit,
      current: currentUploadsCount,
      projected: projectedUploadsCount,
      periodKey: foundation.usage?.monthly?.periodKey || null
    });
  }

  return foundation;
};

export const assertWorkspaceSlaWriteAllowed = async ({ workspaceId }) => {
  const foundation = await getFoundationOrThrow({ workspaceId });
  const slaEnabled = Boolean(
    foundation.entitlement?.features?.[BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]
  );

  if (!slaEnabled) {
    throw createError('errors.billing.slaNotIncluded', 409);
  }

  assertPartialBlockInactive({ foundation });
  return foundation;
};

export const isWorkspaceSlaEnabled = async ({ workspaceId }) => {
  const foundation = await getFoundationOrThrow({ workspaceId });

  return Boolean(
    foundation.entitlement?.features?.[BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]
  );
};
