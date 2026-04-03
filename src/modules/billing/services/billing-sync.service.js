import mongoose from 'mongoose';
import { billingConfig } from '../../../config/billing.config.js';
import { BILLING_SUBSCRIPTION_STATUS } from '../../../constants/billing-subscription-status.js';
import { BILLING_WEBHOOK_EVENT_STATUS } from '../../../constants/billing-webhook-event-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { User } from '../../users/models/user.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { BillingWebhookEvent } from '../models/billing-webhook-event.model.js';
import { Subscription } from '../models/subscription.model.js';
import { UsageMeter } from '../models/usage-meter.model.js';
import {
  findActivePlanByKeyOrThrow,
  findAddonByStripePriceId,
  findPlanByStripePriceId,
  resolveActiveAddonSelectionsOrThrow,
  syncBillingCatalog
} from './billing-catalog.service.js';
import {
  buildSubscriptionFlags,
  ensureWorkspaceBillingFoundation,
  ensureWorkspaceSubscriptionFoundation,
  recomputeWorkspaceEntitlement,
  syncWorkspaceSubscriptionLifecycle as syncWorkspaceSubscriptionLifecycleFoundation
} from './billing-foundation.service.js';
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeCustomer,
  ensureStripePriceId,
  listStripeSubscriptionsForCustomer,
  retrieveStripeSubscription,
  updateStripeSubscription
} from './providers/stripe-billing.provider.js';
import {
  buildStripeLifecyclePatch,
  toDateOrNull
} from '../utils/billing-lifecycle.js';

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

const idsEqual = (left, right) => String(left || '') === String(right || '');

const datesEqual = (left, right) => {
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

const assignDocPatch = (doc, patch = {}) => {
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (
      value instanceof Date ||
      doc[key] instanceof Date ||
      key.endsWith('At') ||
      key.endsWith('Date')
    ) {
      if (!datesEqual(doc[key], value)) {
        doc[key] = value;
        changed = true;
      }
      continue;
    }

    if (Array.isArray(value) || (value && typeof value === 'object')) {
      if (JSON.stringify(doc[key] || null) !== JSON.stringify(value || null)) {
        doc[key] = value;
        changed = true;
      }
      continue;
    }

    if (doc[key] !== value) {
      doc[key] = value;
      changed = true;
    }
  }

  return changed;
};

const buildWorkspaceLookup = async (workspaceId) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null
  })
    .select('_id name slug ownerUserId')
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  const owner = await User.findOne({
    _id: workspace.ownerUserId,
    deletedAt: null
  })
    .select('_id email emailNormalized profile.name')
    .lean();

  return {
    workspace,
    owner
  };
};

const buildCheckoutResponse = (session) => ({
  checkoutSession: {
    sessionId: session.id,
    url: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    provider: billingConfig.provider
  }
});

const buildPortalResponse = (session) => ({
  portalSession: {
    url: session.url,
    provider: billingConfig.provider,
    createdAt: session.created ? new Date(session.created * 1000) : null
  }
});

const normalizeMetadataValue = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const extractWorkspaceIdFromStripeObject = (object) => {
  const metadataWorkspaceId = normalizeMetadataValue(object?.metadata?.workspaceId);

  if (metadataWorkspaceId) {
    return metadataWorkspaceId;
  }

  if (object?.object === 'checkout.session') {
    return normalizeMetadataValue(object?.client_reference_id);
  }

  return null;
};

const buildStripeAddonItems = async (stripeSubscription) => {
  const items = Array.isArray(stripeSubscription?.items?.data)
    ? stripeSubscription.items.data
    : [];
  const addonItems = [];

  for (const item of items) {
    const priceId = normalizeMetadataValue(item?.price?.id);
    if (!priceId) {
      continue;
    }

    const addon = await findAddonByStripePriceId({ priceId });
    if (!addon) {
      continue;
    }

    addonItems.push({
      addonId: addon._id,
      addonKey: addon.key,
      quantity: Math.max(1, Number(item.quantity || 1))
    });
  }

  return addonItems;
};

const buildStripePlanSelection = async (stripeSubscription) => {
  const items = Array.isArray(stripeSubscription?.items?.data)
    ? stripeSubscription.items.data
    : [];

  for (const item of items) {
    const priceId = normalizeMetadataValue(item?.price?.id);
    if (!priceId) {
      continue;
    }

    const plan = await findPlanByStripePriceId({ priceId });
    if (plan) {
      return plan;
    }
  }

  return null;
};

const pickSyncWorkspaceId = async ({
  eventPayload,
  stripeSubscriptionId,
  stripeCustomerId
}) => {
  const directWorkspaceId = extractWorkspaceIdFromStripeObject(eventPayload?.data?.object);
  if (directWorkspaceId) {
    return directWorkspaceId;
  }

  if (stripeSubscriptionId) {
    const bySubscription = await Subscription.findOne({
      stripeSubscriptionId
    }).lean();

    if (bySubscription?.workspaceId) {
      return String(bySubscription.workspaceId);
    }
  }

  if (stripeCustomerId) {
    const byCustomer = await Subscription.findOne({
      stripeCustomerId
    }).lean();

    if (byCustomer?.workspaceId) {
      return String(byCustomer.workspaceId);
    }
  }

  return null;
};

const createPendingWebhookEventError = (message) => {
  const error = createError('errors.billing.webhookProcessingFailed', 500);
  error.internalMessage = message;
  return error;
};

const createProviderSyncFailedError = (message) => {
  const error = createError('errors.billing.providerSyncFailed', 503);
  error.internalMessage = message;
  return error;
};

const createManagedSubscriptionRequiredError = () =>
  createError('errors.billing.managedSubscriptionRequired', 409);

const MANAGED_PORTAL_ELIGIBLE_STATUSES = new Set([
  BILLING_SUBSCRIPTION_STATUS.TRIALING,
  BILLING_SUBSCRIPTION_STATUS.ACTIVE,
  BILLING_SUBSCRIPTION_STATUS.PAST_DUE,
  BILLING_SUBSCRIPTION_STATUS.INCOMPLETE,
  BILLING_SUBSCRIPTION_STATUS.CANCELED
]);

const hasManagedPortalEligibility = ({ subscription }) =>
  Boolean(
    normalizeMetadataValue(subscription?.stripeCustomerId) &&
      normalizeMetadataValue(subscription?.stripeSubscriptionId) &&
      MANAGED_PORTAL_ELIGIBLE_STATUSES.has(subscription?.status)
  );

const normalizeAddonQuantityPatchItems = (items = []) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      addonKey: normalizeMetadataValue(item?.addonKey)?.toLowerCase() || null,
      quantity: Math.max(0, Math.trunc(Number(item?.quantity || 0)))
    }))
    .filter((item) => item.addonKey);
};

const resolveCurrentManagedStripeSubscriptionOrThrow = async ({
  workspaceId
}) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });
  const stripeSubscriptionId = normalizeMetadataValue(
    foundation.subscription?.stripeSubscriptionId
  );

  if (!stripeSubscriptionId) {
    throw createManagedSubscriptionRequiredError();
  }

  const remoteSubscription = await retrieveStripeSubscription({
    subscriptionId: stripeSubscriptionId
  });

  return {
    foundation,
    remoteSubscription,
    stripeSubscriptionId
  };
};

const findStripePlanItem = async (stripeSubscription) => {
  const items = Array.isArray(stripeSubscription?.items?.data)
    ? stripeSubscription.items.data
    : [];

  for (const item of items) {
    const priceId = normalizeMetadataValue(item?.price?.id);
    if (!priceId) {
      continue;
    }

    const plan = await findPlanByStripePriceId({ priceId });
    if (plan) {
      return {
        item,
        plan
      };
    }
  }

  return null;
};

const findStripeAddonItemsByKey = async (stripeSubscription) => {
  const items = Array.isArray(stripeSubscription?.items?.data)
    ? stripeSubscription.items.data
    : [];
  const byAddonKey = new Map();

  for (const item of items) {
    const priceId = normalizeMetadataValue(item?.price?.id);
    if (!priceId) {
      continue;
    }

    const addon = await findAddonByStripePriceId({ priceId });
    if (!addon?.key) {
      continue;
    }

    byAddonKey.set(addon.key, {
      item,
      addon
    });
  }

  return byAddonKey;
};

const loadRemoteStripeSubscription = async ({
  stripeSubscriptionId,
  stripeCustomerId,
  subscriptionDoc
}) => {
  const resolvedSubscriptionId =
    normalizeMetadataValue(stripeSubscriptionId) ||
    normalizeMetadataValue(subscriptionDoc?.stripeSubscriptionId);
  const resolvedCustomerId =
    normalizeMetadataValue(stripeCustomerId) ||
    normalizeMetadataValue(subscriptionDoc?.stripeCustomerId);

  if (resolvedSubscriptionId) {
    try {
      const subscription = await retrieveStripeSubscription({
        subscriptionId: resolvedSubscriptionId
      });

      return {
        remoteSubscription: subscription,
        absenceConfirmed: false
      };
    } catch (error) {
      if (error?.statusCode !== 404) {
        throw createProviderSyncFailedError(
          `Stripe subscription retrieval failed for ${resolvedSubscriptionId}.`
        );
      }

      if (!resolvedCustomerId) {
        return {
          remoteSubscription: null,
          absenceConfirmed: true
        };
      }
    }
  }

  if (!resolvedCustomerId) {
    return {
      remoteSubscription: null,
      absenceConfirmed: true
    };
  }

  try {
    const subscriptions = await listStripeSubscriptionsForCustomer({
      customerId: resolvedCustomerId,
      limit: 5
    });

    if (!Array.isArray(subscriptions)) {
      throw createProviderSyncFailedError(
        `Stripe subscription list returned an unexpected payload for customer ${resolvedCustomerId}.`
      );
    }

    return {
      remoteSubscription: subscriptions[0] || null,
      absenceConfirmed: subscriptions.length === 0
    };
  } catch (error) {
    if (error?.messageKey === 'errors.billing.providerSyncFailed') {
      throw error;
    }

    throw createProviderSyncFailedError(
      `Stripe subscription listing failed for customer ${resolvedCustomerId}.`
    );
  }
};

export const ensureBillingCustomerLinkage = async ({ workspaceId }) => {
  await syncBillingCatalog();

  const subscriptionDoc = await Subscription.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null
  });

  const subscription =
    subscriptionDoc?.toObject() ||
    (await ensureWorkspaceSubscriptionFoundation({ workspaceId }));
  const { workspace, owner } = await buildWorkspaceLookup(workspaceId);

  const customer = await createStripeCustomer({
    existingCustomerId: subscription.stripeCustomerId,
    email: owner?.email || null,
    name: owner?.profile?.name || workspace.name,
    workspaceId: workspace._id,
    workspaceName: workspace.name
  });

  const customerId = normalizeMetadataValue(customer?.id);
  if (!customerId) {
    throw createError('errors.billing.customerUnavailable', 503);
  }

  if (!subscriptionDoc) {
    await Subscription.updateOne(
      { workspaceId: toObjectIdIfValid(workspaceId), deletedAt: null },
      {
        $set: {
          stripeCustomerId: customerId,
          lastSyncedAt: new Date()
        }
      }
    );
  } else if (subscriptionDoc.stripeCustomerId !== customerId) {
    subscriptionDoc.stripeCustomerId = customerId;
    subscriptionDoc.lastSyncedAt = new Date();
    await subscriptionDoc.save();
  }

  return {
    customerId,
    subscription:
      subscriptionDoc?.toObject() || {
        ...subscription,
        stripeCustomerId: customerId
      },
    workspace,
    owner
  };
};

export const createWorkspaceCheckoutSession = async ({
  workspaceId,
  planKey,
  addonItems = [],
  successUrl = null,
  cancelUrl = null
}) => {
  await syncBillingCatalog();

  const plan = await findActivePlanByKeyOrThrow({ planKey });
  const addonSelections = await resolveActiveAddonSelectionsOrThrow(addonItems);
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });
  const effectiveSuccessUrl =
    normalizeMetadataValue(successUrl) || billingConfig.stripe.checkoutSuccessUrl;
  const effectiveCancelUrl =
    normalizeMetadataValue(cancelUrl) || billingConfig.stripe.checkoutCancelUrl;

  if (!effectiveSuccessUrl || !effectiveCancelUrl) {
    throw createError('errors.billing.checkoutUrlsRequired', 422);
  }

  if (!plan.features?.checkoutEnabled || !plan.features?.billingEnabled) {
    throw createError('errors.billing.checkoutUnavailable', 409);
  }

  if (
    foundation.subscription.stripeSubscriptionId &&
    ![
      BILLING_SUBSCRIPTION_STATUS.CANCELED,
      BILLING_SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED
    ].includes(foundation.subscription.status)
  ) {
    throw createError('errors.billing.checkoutAlreadyManagedInPortal', 409);
  }

  const { customerId, workspace, owner } = await ensureBillingCustomerLinkage({
    workspaceId
  });

  const lineItems = [
    {
      price: ensureStripePriceId(plan.providerMetadata?.stripe?.priceId),
      quantity: 1
    },
    ...addonSelections.map(({ addon, quantity }) => ({
      price: ensureStripePriceId(addon.providerMetadata?.stripe?.priceId),
      quantity
    }))
  ];

  const session = await createStripeCheckoutSession({
    customerId,
    customerEmail: owner?.email || null,
    workspaceId,
    workspaceName: workspace.name,
    lineItems,
    successUrl: effectiveSuccessUrl,
    cancelUrl: effectiveCancelUrl,
    trialEndsAt: foundation.subscription.trialEndsAt
      ? new Date(foundation.subscription.trialEndsAt)
      : null
  });

  return buildCheckoutResponse(session);
};

export const createWorkspacePortalSession = async ({
  workspaceId,
  returnUrl = null
}) => {
  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });
  const customerId = normalizeMetadataValue(foundation.subscription.stripeCustomerId);

  if (!foundation.plan?.features?.portalEnabled) {
    throw createError('errors.billing.portalUnavailable', 409);
  }

  if (!customerId || !hasManagedPortalEligibility({ subscription: foundation.subscription })) {
    throw createError('errors.billing.portalUnavailable', 409);
  }

  const session = await createStripeBillingPortalSession({
    customerId,
    returnUrl:
      normalizeMetadataValue(returnUrl) || billingConfig.stripe.portalReturnUrl || null
  });

  return buildPortalResponse(session);
};

export const changeWorkspaceBillingPlan = async ({
  workspaceId,
  planKey
}) => {
  await syncBillingCatalog();

  const targetPlan = await findActivePlanByKeyOrThrow({ planKey });
  const {
    foundation,
    remoteSubscription,
    stripeSubscriptionId
  } = await resolveCurrentManagedStripeSubscriptionOrThrow({ workspaceId });

  const currentPlanItem = await findStripePlanItem(remoteSubscription);
  if (!currentPlanItem?.item?.id) {
    throw createProviderSyncFailedError(
      `Unable to resolve the current Stripe plan item for workspace ${workspaceId}.`
    );
  }

  const updatedStripeSubscription = await updateStripeSubscription({
    subscriptionId: stripeSubscriptionId,
    items: [
      {
        id: currentPlanItem.item.id,
        price: ensureStripePriceId(targetPlan.providerMetadata?.stripe?.priceId),
        quantity: 1
      }
    ],
    prorationBehavior: 'always_invoice'
  });

  const synced = await syncWorkspaceSubscriptionFromStripe({
    workspaceId,
    stripeSubscriptionId,
    stripeSubscription: updatedStripeSubscription
  });

  return {
    subscriptionUpdate: {
      workspaceId: String(workspaceId),
      provider: billingConfig.provider,
      previousPlanKey: foundation.subscription?.planKey || null,
      requestedPlanKey: targetPlan.key,
      currentPlanKey: synced.subscription.planKey,
      status: synced.subscription.status,
      stripeSubscriptionId: synced.subscription.stripeSubscriptionId || null
    }
  };
};

export const updateWorkspaceBillingAddons = async ({
  workspaceId,
  addonItems = []
}) => {
  await syncBillingCatalog();

  const normalizedItems = normalizeAddonQuantityPatchItems(addonItems);
  const positiveSelections = normalizedItems.filter((item) => item.quantity > 0);
  const resolvedSelections = await resolveActiveAddonSelectionsOrThrow(
    positiveSelections
  );
  const resolvedSelectionsByKey = new Map(
    resolvedSelections.map((entry) => [entry.addon.key, entry])
  );
  const {
    remoteSubscription,
    stripeSubscriptionId
  } = await resolveCurrentManagedStripeSubscriptionOrThrow({ workspaceId });
  const currentAddonItemsByKey = await findStripeAddonItemsByKey(remoteSubscription);
  const subscriptionItemUpdates = [];

  for (const item of normalizedItems) {
    const existingAddonItem = currentAddonItemsByKey.get(item.addonKey) || null;
    const resolvedSelection = resolvedSelectionsByKey.get(item.addonKey) || null;

    if (item.quantity <= 0) {
      if (existingAddonItem?.item?.id) {
        subscriptionItemUpdates.push({
          id: existingAddonItem.item.id,
          deleted: true
        });
      }
      continue;
    }

    if (existingAddonItem?.item?.id) {
      subscriptionItemUpdates.push({
        id: existingAddonItem.item.id,
        quantity: item.quantity
      });
      continue;
    }

    subscriptionItemUpdates.push({
      price: ensureStripePriceId(
        resolvedSelection?.addon?.providerMetadata?.stripe?.priceId
      ),
      quantity: item.quantity
    });
  }

  if (subscriptionItemUpdates.length === 0) {
    const synced = await syncWorkspaceSubscriptionFromStripe({
      workspaceId,
      stripeSubscriptionId,
      stripeSubscription: remoteSubscription
    });

    return {
      subscriptionUpdate: {
        workspaceId: String(workspaceId),
        provider: billingConfig.provider,
        status: synced.subscription.status,
        stripeSubscriptionId: synced.subscription.stripeSubscriptionId || null,
        addonItems: synced.addons.map(({ addon, quantity }) => ({
          addonKey: addon.key,
          quantity
        }))
      }
    };
  }

  const updatedStripeSubscription = await updateStripeSubscription({
    subscriptionId: stripeSubscriptionId,
    items: subscriptionItemUpdates,
    prorationBehavior: 'always_invoice'
  });

  const synced = await syncWorkspaceSubscriptionFromStripe({
    workspaceId,
    stripeSubscriptionId,
    stripeSubscription: updatedStripeSubscription
  });

  return {
    subscriptionUpdate: {
      workspaceId: String(workspaceId),
      provider: billingConfig.provider,
      status: synced.subscription.status,
      stripeSubscriptionId: synced.subscription.stripeSubscriptionId || null,
      addonItems: synced.addons.map(({ addon, quantity }) => ({
        addonKey: addon.key,
        quantity
      }))
    }
  };
};

export const syncWorkspaceSubscriptionFromStripe = async ({
  workspaceId,
  stripeSubscriptionId = null,
  stripeCustomerId = null,
  stripeSubscription = null,
  webhookEvent = null
}) => {
  await syncBillingCatalog();

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const subscriptionDoc = await Subscription.findOne({
    workspaceId: workspaceObjectId,
    deletedAt: null
  });

  if (!subscriptionDoc) {
    throw createError('errors.billing.subscriptionNotFound', 404);
  }

  let remoteSubscription = stripeSubscription;
  let absenceConfirmed = false;

  if (!remoteSubscription) {
    const resolvedRemoteSubscription = await loadRemoteStripeSubscription({
      stripeSubscriptionId,
      stripeCustomerId,
      subscriptionDoc
    });
    remoteSubscription = resolvedRemoteSubscription.remoteSubscription;
    absenceConfirmed = resolvedRemoteSubscription.absenceConfirmed;
  }

  if (!remoteSubscription) {
    if (!absenceConfirmed) {
      throw createProviderSyncFailedError(
        `Stripe subscription state could not be confirmed for workspace ${workspaceId}.`
      );
    }

    const localLifecycle = await syncWorkspaceSubscriptionLifecycleFoundation({
      workspaceId
    });
    const recomputed = await recomputeWorkspaceEntitlement({ workspaceId });

    return {
      subscription: {
        ...localLifecycle,
        lastSyncedAt: recomputed.subscription.lastSyncedAt
      },
      entitlement: recomputed.entitlement,
      plan: recomputed.plan,
      addons: recomputed.addons,
      flags: buildSubscriptionFlags({
        subscription: recomputed.subscription,
        entitlement: recomputed.entitlement
      })
    };
  }

  const plan = await buildStripePlanSelection(remoteSubscription);
  if (!plan) {
    throw createPendingWebhookEventError('Unable to map Stripe plan price to local plan.');
  }

  const addonItems = await buildStripeAddonItems(remoteSubscription);
  const lifecyclePatch = buildStripeLifecyclePatch({
    subscription: subscriptionDoc,
    stripeSubscription: remoteSubscription
  });

  const patch = {
    provider: billingConfig.provider,
    stripeCustomerId:
      normalizeMetadataValue(remoteSubscription.customer) ||
      normalizeMetadataValue(stripeCustomerId) ||
      subscriptionDoc.stripeCustomerId ||
      null,
    stripeSubscriptionId:
      normalizeMetadataValue(remoteSubscription.id) ||
      normalizeMetadataValue(stripeSubscriptionId) ||
      subscriptionDoc.stripeSubscriptionId ||
      null,
    planId: plan._id,
    planKey: plan.key,
    addonItems,
    catalogVersion: billingConfig.catalogVersion,
    metadata: {
      source: 'stripe',
      stripeStatus: String(remoteSubscription.status || ''),
      lastStripeEventId: webhookEvent?.eventId || null,
      lastStripeEventType: webhookEvent?.eventType || null
    },
    lastSyncedAt: new Date(),
    ...lifecyclePatch
  };

  assignDocPatch(subscriptionDoc, patch);
  await subscriptionDoc.save();

  const recomputed = await recomputeWorkspaceEntitlement({ workspaceId });

  return {
    subscription: recomputed.subscription,
    entitlement: recomputed.entitlement,
    plan: recomputed.plan,
    addons: recomputed.addons,
    flags: buildSubscriptionFlags({
      subscription: recomputed.subscription,
      entitlement: recomputed.entitlement
    })
  };
};

export const persistStripeWebhookEvent = async ({
  event,
  payloadHash,
  payload,
  workspaceId = null
}) => {
  const normalizedPayload = {
    workspaceId:
      normalizeMetadataValue(workspaceId) ||
      extractWorkspaceIdFromStripeObject(event?.data?.object),
    customerId: normalizeMetadataValue(event?.data?.object?.customer),
    subscriptionId: normalizeMetadataValue(
      event?.data?.object?.subscription || event?.data?.object?.id
    )
  };
  const now = new Date();
  const insertPayload = {
    workspaceId: normalizedPayload.workspaceId
      ? toObjectIdIfValid(normalizedPayload.workspaceId)
      : null,
    provider: billingConfig.provider,
    eventId: event.id,
    eventType: event.type,
    status: BILLING_WEBHOOK_EVENT_STATUS.PENDING,
    receivedAt: now,
    processedAt: null,
    enqueuedAt: null,
    processingJobId: null,
    attemptsCount: 0,
    payloadHash,
    payload,
    normalizedPayload,
    lastError: null,
    lastEnqueueError: null,
    createdAt: now,
    updatedAt: now
  };

  try {
    const result = await BillingWebhookEvent.collection.findOneAndUpdate(
      {
        provider: billingConfig.provider,
        eventId: event.id
      },
      {
        $setOnInsert: insertPayload
      },
      {
        upsert: true,
        returnDocument: 'after',
        includeResultMetadata: true
      }
    );
    const resultDocument = result?.value || null;

    return {
      webhookEvent: resultDocument,
      created: !result?.lastErrorObject?.updatedExisting
    };
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await BillingWebhookEvent.findOne({
        provider: billingConfig.provider,
        eventId: event.id
      }).lean();

      if (existing?._id) {
        return {
          webhookEvent: existing,
          created: false
        };
      }
    }

    throw error;
  }
};

const isRelevantStripeEventType = (eventType) =>
  [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed'
  ].includes(String(eventType || ''));

export const processBillingWebhookEventById = async ({ webhookEventId }) => {
  const webhookEvent = await BillingWebhookEvent.findById(webhookEventId);

  if (!webhookEvent) {
    throw createError('errors.billing.webhookEventNotFound', 404);
  }

  if (webhookEvent.status === BILLING_WEBHOOK_EVENT_STATUS.PROCESSED) {
    return {
      processed: false,
      alreadyProcessed: true,
      webhookEventId: String(webhookEvent._id)
    };
  }

  webhookEvent.attemptsCount = Number(webhookEvent.attemptsCount || 0) + 1;

  try {
    if (!isRelevantStripeEventType(webhookEvent.eventType)) {
      webhookEvent.status = BILLING_WEBHOOK_EVENT_STATUS.PROCESSED;
      webhookEvent.processedAt = new Date();
      webhookEvent.lastError = null;
      await webhookEvent.save();

      return {
        processed: true,
        ignored: true,
        webhookEventId: String(webhookEvent._id)
      };
    }

    const object = webhookEvent.payload?.data?.object || {};
    const stripeSubscriptionId = normalizeMetadataValue(
      object.subscription || object.id
    );
    const stripeCustomerId = normalizeMetadataValue(object.customer);
    const workspaceId =
      normalizeMetadataValue(webhookEvent.normalizedPayload?.workspaceId) ||
      (await pickSyncWorkspaceId({
        eventPayload: webhookEvent.payload,
        stripeSubscriptionId:
          webhookEvent.eventType === 'checkout.session.completed' ? stripeSubscriptionId : object.id,
        stripeCustomerId
      }));

    if (!workspaceId) {
      throw createPendingWebhookEventError(
        'Unable to resolve workspace for billing webhook event.'
      );
    }

    if (!webhookEvent.workspaceId || !idsEqual(webhookEvent.workspaceId, workspaceId)) {
      webhookEvent.workspaceId = toObjectIdIfValid(workspaceId);
    }

    await ensureWorkspaceSubscriptionFoundation({ workspaceId });

    const syncResult = await syncWorkspaceSubscriptionFromStripe({
      workspaceId,
      stripeSubscriptionId:
        webhookEvent.eventType === 'customer.subscription.created' ||
        webhookEvent.eventType === 'customer.subscription.updated' ||
        webhookEvent.eventType === 'customer.subscription.deleted'
          ? object.id
          : stripeSubscriptionId,
      stripeCustomerId,
      stripeSubscription:
        object.object === 'subscription' ? object : null,
      webhookEvent
    });

    webhookEvent.status = BILLING_WEBHOOK_EVENT_STATUS.PROCESSED;
    webhookEvent.processedAt = new Date();
    webhookEvent.lastError = null;
    webhookEvent.lastEnqueueError = null;
    await webhookEvent.save();

    return {
      processed: true,
      webhookEventId: String(webhookEvent._id),
      workspaceId,
      subscriptionStatus: syncResult.subscription.status
    };
  } catch (error) {
    webhookEvent.status = BILLING_WEBHOOK_EVENT_STATUS.FAILED;
    webhookEvent.lastError =
      error?.internalMessage || error?.messageKey || error?.message || 'unknown';
    await webhookEvent.save();
    throw error;
  }
};

export const replayPendingBillingWebhookEvents = async ({
  limit = 100,
  pendingOlderThanMinutes = null
} = {}) => {
  const normalizedPendingOlderThanMinutes = Number.parseInt(
    pendingOlderThanMinutes,
    10
  );
  const hasPendingAgeFilter =
    Number.isFinite(normalizedPendingOlderThanMinutes) &&
    normalizedPendingOlderThanMinutes >= 0;
  const pendingReceivedAtCutoff = hasPendingAgeFilter
    ? new Date(Date.now() - normalizedPendingOlderThanMinutes * 60 * 1000)
    : null;

  const events = await BillingWebhookEvent.find({
    provider: billingConfig.provider,
    $or: [
      {
        status: BILLING_WEBHOOK_EVENT_STATUS.FAILED
      },
      {
        status: BILLING_WEBHOOK_EVENT_STATUS.PENDING,
        ...(pendingReceivedAtCutoff
          ? {
              receivedAt: {
                $lte: pendingReceivedAtCutoff
              }
            }
          : {})
      }
    ]
  })
    .sort({ receivedAt: 1 })
    .limit(limit)
    .lean();

  const summary = {
    scanned: events.length,
    processed: 0,
    failed: 0
  };

  for (const event of events) {
    try {
      await processBillingWebhookEventById({
        webhookEventId: String(event._id)
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
    }
  }

  return summary;
};

export const syncWorkspaceBillingLifecycle = async ({ workspaceId }) => {
  const subscription = await syncWorkspaceSubscriptionLifecycleFoundation({
    workspaceId
  });
  const recomputed = await recomputeWorkspaceEntitlement({ workspaceId });

  return {
    workspaceId: String(workspaceId),
    status: subscription.status,
    flags: buildSubscriptionFlags({
      subscription: recomputed.subscription,
      entitlement: recomputed.entitlement
    })
  };
};

export const recomputeWorkspaceBillingRepair = async ({ workspaceId }) => {
  const foundation = await recomputeWorkspaceEntitlement({ workspaceId });

  return {
    workspaceId: String(workspaceId),
    subscriptionStatus: foundation.subscription.status,
    usage: foundation.entitlement.usage
  };
};

export const syncWorkspaceBillingFromProvider = async ({ workspaceId }) => {
  await ensureWorkspaceSubscriptionFoundation({ workspaceId });

  const foundation = await ensureWorkspaceBillingFoundation({ workspaceId });
  const stripeSubscriptionId = normalizeMetadataValue(
    foundation.subscription.stripeSubscriptionId
  );
  const stripeCustomerId = normalizeMetadataValue(
    foundation.subscription.stripeCustomerId
  );

  return syncWorkspaceSubscriptionFromStripe({
    workspaceId,
    stripeSubscriptionId,
    stripeCustomerId
  });
};

export const getWorkspaceUsageMeter = async ({ workspaceId, periodKey }) => {
  return UsageMeter.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    periodKey
  }).lean();
};
