import { billingConfig } from '../../../config/billing.config.js';
import {
  buildCatalogAddonView,
  buildCatalogPlanView,
  getBillingCatalog as getCatalogPayload
} from './billing-catalog.service.js';
import {
  createInitialWorkspaceBillingFoundation,
  ensureWorkspaceBillingFoundation,
  recomputeWorkspaceEntitlement
} from './billing-foundation.service.js';
import {
  changeWorkspaceBillingPlan,
  createWorkspaceCheckoutSession,
  createWorkspacePortalSession,
  updateWorkspaceBillingAddons
} from './billing-sync.service.js';

const normalizeObjectId = (value) => String(value || '');

const toNullableDate = (value) => (value ? new Date(value) : null);

const buildResolvedAddonView = ({ addon, quantity }) => ({
  addon: buildCatalogAddonView(addon),
  quantity
});

const buildSubscriptionView = ({ subscription, plan, addons, flags }) => ({
  _id: normalizeObjectId(subscription._id),
  workspaceId: normalizeObjectId(subscription.workspaceId),
  provider: subscription.provider || billingConfig.provider,
  status: subscription.status,
  plan: plan ? buildCatalogPlanView(plan) : null,
  addonItems: addons.map((item) => buildResolvedAddonView(item)),
  stripeCustomerId: subscription.stripeCustomerId || null,
  stripeSubscriptionId: subscription.stripeSubscriptionId || null,
  currentPeriodStart: toNullableDate(subscription.currentPeriodStart),
  currentPeriodEnd: toNullableDate(subscription.currentPeriodEnd),
  trialStartedAt: toNullableDate(subscription.trialStartedAt),
  trialEndsAt: toNullableDate(subscription.trialEndsAt),
  graceStartsAt: toNullableDate(subscription.graceStartsAt),
  graceEndsAt: toNullableDate(subscription.graceEndsAt),
  pastDueAt: toNullableDate(subscription.pastDueAt),
  partialBlockStartsAt: toNullableDate(subscription.partialBlockStartsAt),
  canceledAt: toNullableDate(subscription.canceledAt),
  cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
  lastSyncedAt: toNullableDate(subscription.lastSyncedAt),
  catalogVersion: subscription.catalogVersion || null,
  metadata: subscription.metadata || null,
  flags
});

const buildEntitlementView = (entitlement) => ({
  limits: entitlement.limits,
  features: entitlement.features,
  usage: entitlement.usage,
  overLimit: entitlement.overLimit,
  computedAt: toNullableDate(entitlement.computedAt),
  sourceSnapshot: entitlement.sourceSnapshot || null
});

const buildUsageView = (usage, overLimit) => ({
  current: usage.current,
  monthly: usage.monthly,
  overLimit
});

export const getBillingCatalog = async () => getCatalogPayload();

export const getCurrentBillingSubscription = async ({ workspaceId }) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });

  return {
    subscription: buildSubscriptionView(foundation)
  };
};

export const getCurrentBillingEntitlements = async ({ workspaceId }) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });

  return {
    entitlements: buildEntitlementView(foundation.entitlement)
  };
};

export const getCurrentBillingUsage = async ({ workspaceId }) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });

  return {
    usage: buildUsageView(foundation.usage, foundation.flags.overLimit)
  };
};

export const getCurrentBillingSummary = async ({ workspaceId }) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });

  return {
    summary: {
      subscription: buildSubscriptionView(foundation),
      entitlements: {
        limits: foundation.entitlement.limits,
        features: foundation.entitlement.features
      },
      usage: buildUsageView(foundation.usage, foundation.flags.overLimit),
      flags: foundation.flags
    }
  };
};

export const seedAndSyncBillingCatalog = async () => getCatalogPayload();

export const recomputeCurrentWorkspaceEntitlements = async ({ workspaceId }) =>
  recomputeWorkspaceEntitlement({ workspaceId });

export const ensureCurrentWorkspaceBillingFoundation = async ({ workspaceId }) =>
  createInitialWorkspaceBillingFoundation({ workspaceId });

export const createBillingCheckoutSession = async ({
  workspaceId,
  payload
}) =>
  createWorkspaceCheckoutSession({
    workspaceId,
    planKey: payload?.planKey,
    addonItems: payload?.addonItems || [],
    successUrl: payload?.successUrl,
    cancelUrl: payload?.cancelUrl
  });

export const createBillingPortalSession = async ({
  workspaceId,
  payload
}) =>
  createWorkspacePortalSession({
    workspaceId,
    returnUrl: payload?.returnUrl
  });

export const changeCurrentWorkspaceBillingPlan = async ({
  workspaceId,
  payload
}) =>
  changeWorkspaceBillingPlan({
    workspaceId,
    planKey: payload?.planKey
  });

export const updateCurrentWorkspaceBillingAddons = async ({
  workspaceId,
  payload
}) =>
  updateWorkspaceBillingAddons({
    workspaceId,
    addonItems: payload?.addonItems || []
  });
