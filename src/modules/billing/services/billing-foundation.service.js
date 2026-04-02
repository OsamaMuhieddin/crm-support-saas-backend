import mongoose from 'mongoose';
import { billingConfig } from '../../../config/billing.config.js';
import { INVITE_STATUS } from '../../../constants/invite-status.js';
import { MEMBER_STATUS } from '../../../constants/member-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { File } from '../../files/models/file.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { WorkspaceInvite } from '../../workspaces/models/workspace-invite.model.js';
import { WorkspaceMember } from '../../workspaces/models/workspace-member.model.js';
import { Entitlement } from '../models/entitlement.model.js';
import { Subscription } from '../models/subscription.model.js';
import { UsageMeter } from '../models/usage-meter.model.js';
import {
  assertBillingEnabled,
  findDefaultPlanOrThrow,
  resolvePlanForSubscriptionOrThrow,
  resolveSubscriptionAddons
} from './billing-catalog.service.js';
import {
  applyAddonEffectsToLimits,
  buildBillingPeriodKey,
  buildOverLimitFlags,
  normalizeEntitlementSnapshot,
  normalizePlanFeatures,
  normalizePlanLimits,
  normalizeUsageSnapshot
} from '../utils/billing-canonical.js';
import { BILLING_SUBSCRIPTION_STATUS } from '../../../constants/billing-subscription-status.js';
import { buildLocalLifecyclePatch, toDateOrNull } from '../utils/billing-lifecycle.js';

const normalizeObjectId = (value) => String(value || '');

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const datesAreEqual = (left, right) => {
  const leftDate = toDateOrNull(left);
  const rightDate = toDateOrNull(right);

  if (!leftDate && !rightDate) {
    return true;
  }

  if (!leftDate || !rightDate) {
    return false;
  }

  return leftDate.getTime() === rightDate.getTime();
};

const assignSubscriptionPatch = (subscription, patch = {}) => {
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof Date || subscription[key] instanceof Date || key.endsWith('At')) {
      if (!datesAreEqual(subscription[key], value)) {
        subscription[key] = value;
        changed = true;
      }
      continue;
    }

    if (subscription[key] !== value) {
      subscription[key] = value;
      changed = true;
    }
  }

  return changed;
};

const findWorkspaceOrThrow = async (workspaceId) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null
  })
    .select('_id name slug status ownerUserId')
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

const getPendingInviteCount = async (workspaceId, { excludeInviteId = null } = {}) => {
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    status: INVITE_STATUS.PENDING,
    deletedAt: null,
    expiresAt: { $gt: new Date() }
  };

  if (excludeInviteId) {
    query._id = { $ne: toObjectIdIfValid(excludeInviteId) };
  }

  return WorkspaceInvite.countDocuments(query);
};

const ensureUsageMeter = async ({ workspaceId, periodKey = buildBillingPeriodKey() }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  return UsageMeter.findOneAndUpdate(
    { workspaceId: workspaceObjectId, periodKey },
    { $setOnInsert: { workspaceId: workspaceObjectId, periodKey } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  ).lean();
};

const updateEntitlementUsageSnapshotIfPresent = async ({ workspaceId, usage }) => {
  await Entitlement.updateOne(
    {
      workspaceId: toObjectIdIfValid(workspaceId),
      deletedAt: null
    },
    {
      $set: {
        usage,
        computedAt: new Date()
      }
    }
  );
};

const getStorageBytesUsed = async (workspaceId) => {
  const [result] = await File.aggregate([
    {
      $match: {
        workspaceId: toObjectIdIfValid(workspaceId),
        deletedAt: null,
        storageStatus: 'ready'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$sizeBytes' }
      }
    }
  ]);

  return Number(result?.total || 0);
};

export const computeWorkspaceUsageSnapshot = async ({
  workspaceId,
  periodKey = buildBillingPeriodKey(),
  excludeInviteId = null
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  const meter = await ensureUsageMeter({ workspaceId: workspaceObjectId, periodKey });

  const [activeMembers, pendingInvites, activeMailboxes, storageBytes] =
    await Promise.all([
    WorkspaceMember.countDocuments({
      workspaceId: workspaceObjectId,
      status: MEMBER_STATUS.ACTIVE,
      deletedAt: null
    }),
    getPendingInviteCount(workspaceObjectId, { excludeInviteId }),
    Mailbox.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
      isActive: true
    }),
      getStorageBytesUsed(workspaceObjectId)
    ]);

  return normalizeUsageSnapshot({
    current: {
      seatsUsed: Number(activeMembers || 0) + Number(pendingInvites || 0),
      activeMailboxes,
      storageBytes
    },
    monthly: {
      periodKey,
      ticketsCreated: meter?.ticketsCreated || 0,
      uploadsCount: meter?.uploadsCount || 0
    }
  });
};

export const getWorkspaceSeatUsage = async ({
  workspaceId,
  excludeInviteId = null
}) => {
  const [activeMembers, pendingInvites] = await Promise.all([
    WorkspaceMember.countDocuments({
      workspaceId: toObjectIdIfValid(workspaceId),
      status: MEMBER_STATUS.ACTIVE,
      deletedAt: null
    }),
    getPendingInviteCount(workspaceId, { excludeInviteId })
  ]);

  return {
    activeMembers: Number(activeMembers || 0),
    pendingInvites: Number(pendingInvites || 0),
    seatsUsed: Number(activeMembers || 0) + Number(pendingInvites || 0)
  };
};

export const recountWorkspaceStorageBytes = async ({ workspaceId }) =>
  getStorageBytesUsed(workspaceId);

export const incrementWorkspaceUsageMeter = async ({
  workspaceId,
  periodKey = buildBillingPeriodKey(),
  uploadsCount = 0,
  ticketsCreated = 0
}) => {
  const increments = {};

  if (Number(uploadsCount)) {
    increments.uploadsCount = Number(uploadsCount);
  }

  if (Number(ticketsCreated)) {
    increments.ticketsCreated = Number(ticketsCreated);
  }

  const meter = await ensureUsageMeter({ workspaceId, periodKey });

  if (!Object.keys(increments).length) {
    return meter;
  }

  return UsageMeter.findOneAndUpdate(
    {
      workspaceId: toObjectIdIfValid(workspaceId),
      periodKey
    },
    {
      $inc: increments
    },
    {
      new: true
    }
  ).lean();
};

export const incrementWorkspaceUploadsCount = async ({
  workspaceId,
  count = 1,
  periodKey = buildBillingPeriodKey()
}) =>
  incrementWorkspaceUsageMeter({
    workspaceId,
    periodKey,
    uploadsCount: count
  });

export const incrementWorkspaceTicketsCreated = async ({
  workspaceId,
  count = 1,
  periodKey = buildBillingPeriodKey()
}) =>
  incrementWorkspaceUsageMeter({
    workspaceId,
    periodKey,
    ticketsCreated: count
  });

export const refreshWorkspaceBillingUsageSnapshot = async ({ workspaceId }) => {
  const usage = await computeWorkspaceUsageSnapshot({ workspaceId });
  await updateEntitlementUsageSnapshotIfPresent({ workspaceId, usage });
  return usage;
};

export const ensureWorkspaceSubscriptionFoundation = async ({ workspaceId }) => {
  assertBillingEnabled();
  const workspace = await findWorkspaceOrThrow(workspaceId);
  const workspaceObjectId = toObjectIdIfValid(workspace._id);

  let subscription = await Subscription.findOne({
    workspaceId: workspaceObjectId,
    deletedAt: null
  });

  if (!subscription) {
    const defaultPlan = await findDefaultPlanOrThrow();
    const now = new Date();
    const trialEndsAt = addDays(now, billingConfig.trialDays);

    subscription = await Subscription.create({
      workspaceId: workspaceObjectId,
      planId: defaultPlan._id,
      planKey: defaultPlan.key,
      status: BILLING_SUBSCRIPTION_STATUS.TRIALING,
      provider: billingConfig.provider,
      currentPeriodStart: now,
      trialStartedAt: now,
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
      lastSyncedAt: now,
      catalogVersion: billingConfig.catalogVersion,
      metadata: null
    });
  } else {
    let changed = false;
    let defaultPlan = null;

    const ensureDefaultPlan = async () => {
      if (!defaultPlan) {
        defaultPlan = await findDefaultPlanOrThrow();
      }

      return defaultPlan;
    };

    if (!subscription.planId) {
      const resolvedDefaultPlan = await ensureDefaultPlan();
      subscription.planId = resolvedDefaultPlan._id;
      changed = true;
    }

    if (!subscription.planKey) {
      const resolvedDefaultPlan = await ensureDefaultPlan();
      subscription.planKey = resolvedDefaultPlan.key;
      changed = true;
    }

    if (!subscription.provider) {
      subscription.provider = billingConfig.provider;
      changed = true;
    }

    if (!subscription.catalogVersion) {
      subscription.catalogVersion = billingConfig.catalogVersion;
      changed = true;
    }

    if (
      subscription.status === BILLING_SUBSCRIPTION_STATUS.TRIALING &&
      !subscription.trialStartedAt
    ) {
      subscription.trialStartedAt =
        subscription.currentPeriodStart || subscription.createdAt || new Date();
      changed = true;
    }

    if (
      subscription.status === BILLING_SUBSCRIPTION_STATUS.TRIALING &&
      !subscription.trialEndsAt
    ) {
      subscription.trialEndsAt = addDays(
        subscription.trialStartedAt || new Date(),
        billingConfig.trialDays
      );
      changed = true;
    }

    if (!subscription.currentPeriodStart) {
      subscription.currentPeriodStart =
        subscription.trialStartedAt || subscription.createdAt || new Date();
      changed = true;
    }

    if (!subscription.currentPeriodEnd) {
      subscription.currentPeriodEnd =
        subscription.trialEndsAt ||
        addDays(subscription.currentPeriodStart || new Date(), billingConfig.trialDays);
      changed = true;
    }

    const lifecyclePatch = buildLocalLifecyclePatch({ subscription });
    if (lifecyclePatch) {
      changed =
        assignSubscriptionPatch(subscription, lifecyclePatch) || changed;
    }

    if (changed) {
      subscription.lastSyncedAt = new Date();
      await subscription.save();
    }
  }

  return subscription.toObject();
};

const buildEntitlementSourceSnapshot = ({ plan, addons, subscription }) => ({
  catalogVersion:
    subscription?.catalogVersion || plan?.catalogVersion || billingConfig.catalogVersion,
  plan: plan
    ? {
        _id: normalizeObjectId(plan._id),
        key: plan.key,
        name: plan.name
      }
    : null,
  addons: addons.map(({ addon, quantity }) => ({
    _id: normalizeObjectId(addon._id),
    key: addon.key,
    name: addon.name,
    quantity
  })),
  subscription: subscription
    ? {
        _id: normalizeObjectId(subscription._id),
        provider: subscription.provider,
        status: subscription.status
      }
    : null
});

export const buildEntitlementFromSubscription = async ({
  workspaceId,
  subscription
}) => {
  const plan = await resolvePlanForSubscriptionOrThrow(subscription);
  const addons = await resolveSubscriptionAddons(subscription?.addonItems || []);
  const usage = await computeWorkspaceUsageSnapshot({ workspaceId });
  const limits = applyAddonEffectsToLimits({
    limits: normalizePlanLimits(plan.limits),
    addons: addons.map(({ addon, quantity }) => ({
      effects: addon.effects,
      quantity
    }))
  });
  const features = normalizePlanFeatures(plan.features);

  const normalized = normalizeEntitlementSnapshot({
    limits,
    features,
    usage,
    computedAt: new Date(),
    sourceSnapshot: buildEntitlementSourceSnapshot({
      plan,
      addons,
      subscription
    })
  });

  return {
    plan,
    addons,
    usage: normalized.usage,
    entitlement: normalized
  };
};

export const recomputeWorkspaceEntitlement = async ({ workspaceId }) => {
  const subscription = await ensureWorkspaceSubscriptionFoundation({ workspaceId });
  const computed = await buildEntitlementFromSubscription({
    workspaceId,
    subscription
  });
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const now = new Date();

  const entitlement = await Entitlement.findOneAndUpdate(
    { workspaceId: workspaceObjectId, deletedAt: null },
    {
      $set: {
        features: computed.entitlement.features,
        limits: computed.entitlement.limits,
        usage: computed.entitlement.usage,
        computedAt: now,
        sourceSnapshot: computed.entitlement.sourceSnapshot
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  ).lean();

  await Subscription.updateOne(
    { _id: subscription._id },
    { $set: { lastSyncedAt: now } }
  );

  return {
    subscription: {
      ...subscription,
      lastSyncedAt: now
    },
    entitlement: normalizeEntitlementSnapshot(entitlement),
    plan: computed.plan,
    addons: computed.addons
  };
};

export const buildSubscriptionFlags = ({ subscription, entitlement }) => {
  const now = Date.now();
  const overLimit = entitlement?.overLimit || buildOverLimitFlags(entitlement);

  return {
    isTrialing: subscription?.status === BILLING_SUBSCRIPTION_STATUS.TRIALING,
    isPastDue: subscription?.status === BILLING_SUBSCRIPTION_STATUS.PAST_DUE,
    isInGracePeriod:
      subscription?.status === BILLING_SUBSCRIPTION_STATUS.PAST_DUE &&
      Boolean(subscription?.graceStartsAt) &&
      (!subscription?.graceEndsAt ||
        new Date(subscription.graceEndsAt).getTime() >= now),
    isPartialBlockActive: Boolean(subscription?.partialBlockStartsAt),
    cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
    overLimit
  };
};

export const ensureWorkspaceBillingFoundation = async ({ workspaceId }) => {
  assertBillingEnabled();
  await findWorkspaceOrThrow(workspaceId);

  const foundation = await recomputeWorkspaceEntitlement({ workspaceId });
  const flags = buildSubscriptionFlags({
    subscription: foundation.subscription,
    entitlement: foundation.entitlement
  });

  return {
    ...foundation,
    usage: foundation.entitlement.usage,
    flags
  };
};

export const createInitialWorkspaceBillingFoundation = async ({ workspaceId }) =>
  ensureWorkspaceBillingFoundation({ workspaceId });

export const repairWorkspaceBillingState = async ({ workspaceId }) => {
  await ensureWorkspaceSubscriptionFoundation({ workspaceId });
  const usage = await refreshWorkspaceBillingUsageSnapshot({ workspaceId });
  const foundation = await recomputeWorkspaceEntitlement({ workspaceId });

  return {
    workspaceId: normalizeObjectId(workspaceId),
    subscriptionStatus: foundation.subscription.status,
    usage
  };
};

export const backfillWorkspaceBillingFoundations = async () => {
  const workspaces = await Workspace.find({
    deletedAt: null
  })
    .select('_id')
    .lean();

  const summary = {
    scanned: 0,
    repaired: 0
  };

  for (const workspace of workspaces) {
    summary.scanned += 1;
    await repairWorkspaceBillingState({
      workspaceId: workspace._id
    });
    summary.repaired += 1;
  }

  return summary;
};

export const syncWorkspaceSubscriptionLifecycle = async ({ workspaceId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const subscription = await Subscription.findOne({
    workspaceId: workspaceObjectId,
    deletedAt: null
  });

  if (!subscription) {
    return ensureWorkspaceSubscriptionFoundation({ workspaceId });
  }

  const lifecyclePatch = buildLocalLifecyclePatch({ subscription });
  if (!lifecyclePatch) {
    return subscription.toObject();
  }

  assignSubscriptionPatch(subscription, lifecyclePatch);
  subscription.lastSyncedAt = new Date();
  await subscription.save();

  return subscription.toObject();
};
