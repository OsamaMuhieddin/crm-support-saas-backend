import { billingConfig } from '../../../config/billing.config.js';
import { createError } from '../../../shared/errors/createError.js';
import { Addon } from '../models/addon.model.js';
import { Plan } from '../models/plan.model.js';
import { billingCatalogManifest } from '../utils/billing-catalog.manifest.js';
import {
  normalizeAddonEffects,
  normalizePlanFeatures,
  normalizePlanLimits,
  normalizeSubscriptionAddonItems
} from '../utils/billing-canonical.js';

const normalizeObjectId = (value) => String(value || '');
const normalizePriceId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const areEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const assertBillingEnabled = () => {
  if (!billingConfig.enabled) {
    throw createError('errors.billing.disabled', 503);
  }
};

export const buildCatalogPlanView = (plan) => ({
  _id: normalizeObjectId(plan._id),
  key: plan.key,
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  isActive: Boolean(plan.isActive),
  sortOrder: Number(plan.sortOrder || 0),
  catalogVersion: plan.catalogVersion || null,
  limits: normalizePlanLimits(plan.limits),
  features: normalizePlanFeatures(plan.features)
});

export const buildCatalogAddonView = (addon) => ({
  _id: normalizeObjectId(addon._id),
  key: addon.key,
  name: addon.name,
  type: addon.type,
  price: addon.price,
  currency: addon.currency,
  isActive: Boolean(addon.isActive),
  sortOrder: Number(addon.sortOrder || 0),
  catalogVersion: addon.catalogVersion || null,
  effects: normalizeAddonEffects(addon.effects)
});

const buildPlanWritePayload = (plan) => ({
  key: plan.key,
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  limits: normalizePlanLimits(plan.limits),
  features: normalizePlanFeatures(plan.features),
  isActive: true,
  sortOrder: Number(plan.sortOrder || 0),
  catalogVersion: billingCatalogManifest.version,
  providerMetadata: plan.providerMetadata || null
});

const buildAddonWritePayload = (addon) => ({
  key: addon.key,
  name: addon.name,
  type: addon.type,
  price: addon.price,
  currency: addon.currency,
  effects: normalizeAddonEffects(addon.effects),
  isActive: true,
  sortOrder: Number(addon.sortOrder || 0),
  catalogVersion: billingCatalogManifest.version,
  providerMetadata: addon.providerMetadata || null
});

const syncPlans = async () => {
  const activeKeys = new Set();

  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0
  };

  for (const manifestPlan of billingCatalogManifest.plans) {
    const nextPlan = buildPlanWritePayload(manifestPlan);
    activeKeys.add(manifestPlan.key);

    const existing = await Plan.findOne({ key: manifestPlan.key }).lean();

    if (existing) {
      const hasChanged =
        existing.name !== nextPlan.name ||
        existing.price !== nextPlan.price ||
        existing.currency !== nextPlan.currency ||
        existing.isActive !== nextPlan.isActive ||
        Number(existing.sortOrder || 0) !== nextPlan.sortOrder ||
        (existing.catalogVersion || null) !== nextPlan.catalogVersion ||
        !areEqual(existing.providerMetadata || null, nextPlan.providerMetadata) ||
        !areEqual(normalizePlanLimits(existing.limits), nextPlan.limits) ||
        !areEqual(normalizePlanFeatures(existing.features), nextPlan.features);

      if (!hasChanged) {
        summary.unchanged += 1;
        continue;
      }
    }

    const result = await Plan.updateOne(
      { key: manifestPlan.key },
      { $set: nextPlan },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      summary.created += 1;
      continue;
    }

    if (result.modifiedCount > 0) {
      summary.updated += 1;
      continue;
    }

    summary.unchanged += 1;
  }

  const deactivateResult = await Plan.updateMany(
    { key: { $nin: [...activeKeys] }, isActive: true },
    { $set: { isActive: false, catalogVersion: billingCatalogManifest.version } }
  );

  summary.deactivated = deactivateResult.modifiedCount || 0;

  return summary;
};

const syncAddons = async () => {
  const activeKeys = new Set();

  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0
  };

  for (const manifestAddon of billingCatalogManifest.addons) {
    const nextAddon = buildAddonWritePayload(manifestAddon);
    activeKeys.add(manifestAddon.key);

    const existing = await Addon.findOne({ key: manifestAddon.key }).lean();

    if (existing) {
      const hasChanged =
        existing.name !== nextAddon.name ||
        existing.type !== nextAddon.type ||
        existing.price !== nextAddon.price ||
        existing.currency !== nextAddon.currency ||
        existing.isActive !== nextAddon.isActive ||
        Number(existing.sortOrder || 0) !== nextAddon.sortOrder ||
        (existing.catalogVersion || null) !== nextAddon.catalogVersion ||
        !areEqual(existing.providerMetadata || null, nextAddon.providerMetadata) ||
        !areEqual(normalizeAddonEffects(existing.effects), nextAddon.effects);

      if (!hasChanged) {
        summary.unchanged += 1;
        continue;
      }
    }

    const result = await Addon.updateOne(
      { key: manifestAddon.key },
      { $set: nextAddon },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      summary.created += 1;
      continue;
    }

    if (result.modifiedCount > 0) {
      summary.updated += 1;
      continue;
    }

    summary.unchanged += 1;
  }

  const deactivateResult = await Addon.updateMany(
    { key: { $nin: [...activeKeys] }, isActive: true },
    { $set: { isActive: false, catalogVersion: billingCatalogManifest.version } }
  );

  summary.deactivated = deactivateResult.modifiedCount || 0;

  return summary;
};

export const syncBillingCatalog = async () => {
  assertBillingEnabled();

  const [plans, addons] = await Promise.all([syncPlans(), syncAddons()]);

  return {
    version: billingCatalogManifest.version,
    provider: billingCatalogManifest.provider,
    currency: billingCatalogManifest.currency,
    plans,
    addons
  };
};

export const getBillingCatalog = async () => {
  assertBillingEnabled();
  await syncBillingCatalog();

  const [plans, addons] = await Promise.all([
    Plan.find({ isActive: true }).sort({ sortOrder: 1, key: 1 }).lean(),
    Addon.find({ isActive: true }).sort({ sortOrder: 1, key: 1 }).lean()
  ]);

  return {
    catalog: {
      version: billingCatalogManifest.version,
      provider: billingConfig.provider,
      currency: billingConfig.currency,
      trialDays: billingConfig.trialDays,
      graceDays: billingConfig.graceDays,
      defaultPlanKey: billingCatalogManifest.defaultPlanKey,
      plans: plans.map((plan) => buildCatalogPlanView(plan)),
      addons: addons.map((addon) => buildCatalogAddonView(addon))
    }
  };
};

export const findDefaultPlanOrThrow = async () => {
  await syncBillingCatalog();

  const plan = await Plan.findOne({
    key: billingCatalogManifest.defaultPlanKey,
    isActive: true
  }).lean();

  if (!plan) {
    throw createError('errors.billing.catalogUnavailable', 503);
  }

  return plan;
};

export const resolvePlanForSubscriptionOrThrow = async (subscription) => {
  if (subscription?.planId) {
    const planById = await Plan.findById(subscription.planId).lean();
    if (planById) {
      return planById;
    }
  }

  if (subscription?.planKey) {
    const planByKey = await Plan.findOne({ key: subscription.planKey }).lean();
    if (planByKey) {
      return planByKey;
    }
  }

  return findDefaultPlanOrThrow();
};

export const resolveSubscriptionAddons = async (addonItems = []) => {
  const normalizedItems = normalizeSubscriptionAddonItems(addonItems);
  if (normalizedItems.length === 0) {
    return [];
  }

  const addonIds = normalizedItems
    .map((item) => item.addonId)
    .filter(Boolean);
  const addonKeys = normalizedItems
    .map((item) => item.addonKey)
    .filter(Boolean);

  const addons = await Addon.find({
    isActive: true,
    $or: [{ _id: { $in: addonIds } }, { key: { $in: addonKeys } }]
  }).lean();

  const byId = new Map(addons.map((addon) => [normalizeObjectId(addon._id), addon]));
  const byKey = new Map(addons.map((addon) => [addon.key, addon]));

  return normalizedItems
    .map((item) => {
      const addon =
        (item.addonId && byId.get(item.addonId)) ||
        (item.addonKey && byKey.get(item.addonKey)) ||
        null;

      if (!addon) {
        return null;
      }

      return {
        addon,
        quantity: item.quantity
      };
    })
    .filter(Boolean);
};

export const findActivePlanByKeyOrThrow = async ({ planKey }) => {
  await syncBillingCatalog();

  const plan = await Plan.findOne({
    key: String(planKey || '').trim().toLowerCase(),
    isActive: true
  }).lean();

  if (!plan) {
    throw createError('errors.billing.planNotFound', 404);
  }

  return plan;
};

export const resolveActiveAddonSelectionsOrThrow = async (addonItems = []) => {
  const normalizedItems = normalizeSubscriptionAddonItems(addonItems);
  if (normalizedItems.length === 0) {
    return [];
  }

  await syncBillingCatalog();

  const addonKeys = normalizedItems
    .map((item) => item.addonKey)
    .filter(Boolean);
  const addons = await Addon.find({
    key: { $in: addonKeys },
    isActive: true
  }).lean();
  const byKey = new Map(addons.map((addon) => [addon.key, addon]));

  return normalizedItems.map((item) => {
    const addon = byKey.get(item.addonKey);

    if (!addon) {
      throw createError('errors.billing.addonNotFound', 404);
    }

    return {
      addon,
      quantity: item.quantity
    };
  });
};

export const findPlanByStripePriceId = async ({ priceId }) => {
  const normalizedPriceId = normalizePriceId(priceId);
  if (!normalizedPriceId) {
    return null;
  }

  return Plan.findOne({
    'providerMetadata.stripe.priceId': normalizedPriceId
  }).lean();
};

export const findAddonByStripePriceId = async ({ priceId }) => {
  const normalizedPriceId = normalizePriceId(priceId);
  if (!normalizedPriceId) {
    return null;
  }

  return Addon.findOne({
    'providerMetadata.stripe.priceId': normalizedPriceId
  }).lean();
};
