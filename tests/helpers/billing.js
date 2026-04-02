import { Plan } from '../../src/modules/billing/models/plan.model.js';
import { Subscription } from '../../src/modules/billing/models/subscription.model.js';
import { syncBillingCatalog } from '../../src/modules/billing/services/billing-catalog.service.js';
import { recomputeWorkspaceEntitlement } from '../../src/modules/billing/services/billing-foundation.service.js';

export const patchPlanForTests = async ({
  planKey,
  limits,
  features
}) => {
  await syncBillingCatalog();

  const plan = await Plan.findOne({ key: planKey }).lean();
  if (!plan) {
    throw new Error(`Plan not found for tests: ${planKey}`);
  }

  const nextLimits = {
    ...(plan.limits || {}),
    ...(limits || {})
  };
  const nextFeatures = {
    ...(plan.features || {}),
    ...(features || {})
  };

  await Plan.updateOne(
    { _id: plan._id },
    {
      $set: {
        limits: nextLimits,
        features: nextFeatures
      }
    }
  );

  return {
    ...plan,
    limits: nextLimits,
    features: nextFeatures
  };
};

export const setWorkspaceBillingPlanForTests = async ({
  workspaceId,
  planKey = 'business',
  addonItems = []
}) => {
  await syncBillingCatalog();

  const plan = await Plan.findOne({ key: planKey, isActive: true }).lean();
  if (!plan) {
    throw new Error(`Active plan not found for tests: ${planKey}`);
  }

  await Subscription.updateOne(
    {
      workspaceId,
      deletedAt: null
    },
    {
      $set: {
        planId: plan._id,
        planKey: plan.key,
        addonItems
      }
    }
  );

  return recomputeWorkspaceEntitlement({ workspaceId });
};
