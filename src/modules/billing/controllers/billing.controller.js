import {
  changeCurrentWorkspaceBillingPlan,
  createBillingCheckoutSession,
  createBillingPortalSession,
  getBillingCatalog,
  getCurrentBillingEntitlements,
  getCurrentBillingSubscription,
  getCurrentBillingSummary,
  getCurrentBillingUsage,
  updateCurrentWorkspaceBillingAddons
} from '../services/billing.service.js';
import { acceptStripeWebhookEvent } from '../services/billing-webhooks.service.js';

export const getBillingCatalogController = async (req, res, next) => {
  try {
    const data = await getBillingCatalog();

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getBillingSubscriptionController = async (req, res, next) => {
  try {
    const data = await getCurrentBillingSubscription({
      workspaceId: req.auth.workspaceId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getBillingEntitlementsController = async (req, res, next) => {
  try {
    const data = await getCurrentBillingEntitlements({
      workspaceId: req.auth.workspaceId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getBillingUsageController = async (req, res, next) => {
  try {
    const data = await getCurrentBillingUsage({
      workspaceId: req.auth.workspaceId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getBillingSummaryController = async (req, res, next) => {
  try {
    const data = await getCurrentBillingSummary({
      workspaceId: req.auth.workspaceId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createBillingCheckoutSessionController = async (
  req,
  res,
  next
) => {
  try {
    const data = await createBillingCheckoutSession({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.billing.checkoutSessionCreated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createBillingPortalSessionController = async (req, res, next) => {
  try {
    const data = await createBillingPortalSession({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.billing.portalSessionCreated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const changeBillingPlanController = async (req, res, next) => {
  try {
    const data = await changeCurrentWorkspaceBillingPlan({
      workspaceId: req.auth.workspaceId,
      payload: req.body
    });

    return res.json({
      messageKey: 'success.billing.planChanged',
      ...data
    });
  } catch (error) {
    return next(error);
  }
};

export const updateBillingAddonsController = async (req, res, next) => {
  try {
    const data = await updateCurrentWorkspaceBillingAddons({
      workspaceId: req.auth.workspaceId,
      payload: req.body
    });

    return res.json({
      messageKey: 'success.billing.addonsUpdated',
      ...data
    });
  } catch (error) {
    return next(error);
  }
};

export const stripeWebhookController = async (req, res, next) => {
  try {
    const data = await acceptStripeWebhookEvent({
      signature: req.headers['stripe-signature'],
      rawBody: req.body,
    });

    return res.json({
      messageKey: 'success.billing.webhookAccepted',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
