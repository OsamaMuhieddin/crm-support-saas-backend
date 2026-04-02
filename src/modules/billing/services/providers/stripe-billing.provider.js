import crypto from 'node:crypto';
import Stripe from 'stripe';
import { billingConfig } from '../../../../config/billing.config.js';
import { createError } from '../../../../shared/errors/createError.js';

let stripeClient = null;

const STRIPE_API_VERSION = '2025-02-24.acacia';

const ensureStripeSecretConfigured = () => {
  if (!billingConfig.stripe.secretKey) {
    throw createError('errors.billing.providerNotConfigured', 503);
  }
};

const ensureStripeWebhookConfigured = () => {
  if (!billingConfig.stripe.webhookSecret) {
    throw createError('errors.billing.webhookNotConfigured', 503);
  }
};

export const getStripeClient = () => {
  ensureStripeSecretConfigured();

  if (!stripeClient) {
    stripeClient = new Stripe(billingConfig.stripe.secretKey, {
      apiVersion: STRIPE_API_VERSION
    });
  }

  return stripeClient;
};

export const buildStripePayloadHash = (payload) =>
  crypto
    .createHash('sha256')
    .update(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || '')))
    .digest('hex');

export const ensureStripePriceId = (value) => {
  const priceId = String(value || '').trim();

  if (!priceId) {
    throw createError('errors.billing.providerPriceMissing', 503);
  }

  return priceId;
};

export const stripeBillingProvider = {
  getClient: () => getStripeClient(),
  createCustomer: async ({
  email,
  name,
  workspaceId,
  workspaceName,
  existingCustomerId = null
}) => {
  const stripe = getStripeClient();
  const metadata = {
    workspaceId: String(workspaceId || '')
  };

  if (workspaceName) {
    metadata.workspaceName = workspaceName;
  }

  if (existingCustomerId) {
    try {
      return await stripe.customers.update(existingCustomerId, {
        email: email || undefined,
        name: name || workspaceName || undefined,
        metadata
      });
    } catch (error) {
      if (error?.statusCode !== 404) {
        throw error;
      }
    }
  }

  return stripe.customers.create({
    email: email || undefined,
    name: name || workspaceName || undefined,
    metadata
  });
},
  createCheckoutSession: async ({
  customerId,
  customerEmail,
  workspaceId,
  workspaceName,
  lineItems,
  successUrl,
  cancelUrl,
  trialEndsAt = null
  }) => {
  const stripe = getStripeClient();
  const subscriptionData = {
    metadata: {
      workspaceId: String(workspaceId || ''),
      workspaceName: String(workspaceName || '')
    }
  };

  if (trialEndsAt instanceof Date && trialEndsAt.getTime() > Date.now()) {
    subscriptionData.trial_end = Math.floor(trialEndsAt.getTime() / 1000);
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId || undefined,
    customer_email: customerId ? undefined : customerEmail || undefined,
    client_reference_id: String(workspaceId || ''),
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lineItems,
    metadata: {
      workspaceId: String(workspaceId || ''),
      workspaceName: String(workspaceName || '')
    },
    subscription_data: subscriptionData
  });
},
  createBillingPortalSession: async ({
  customerId,
  returnUrl = null
}) => {
  const stripe = getStripeClient();

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || undefined
  });
},
  verifyWebhookEvent: ({
  payload,
  signature
}) => {
  ensureStripeWebhookConfigured();

  if (!signature) {
    throw createError('errors.billing.webhookSignatureInvalid', 400);
  }

  const stripe = getStripeClient();

  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      billingConfig.stripe.webhookSecret
    );
  } catch (error) {
    throw createError('errors.billing.webhookSignatureInvalid', 400);
  }
},
  retrieveSubscription: async ({ subscriptionId }) => {
  if (!subscriptionId) {
    throw createError('errors.billing.subscriptionNotFound', 404);
  }

  const stripe = getStripeClient();

  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price']
  });
},
  listSubscriptionsForCustomer: async ({ customerId, limit = 10 }) => {
  if (!customerId) {
    return [];
  }

  const stripe = getStripeClient();
  const response = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit,
    expand: ['data.items.data.price']
  });

  return Array.isArray(response?.data) ? response.data : [];
}
};

export const createStripeCustomer = async (input) =>
  stripeBillingProvider.createCustomer(input);

export const createStripeCheckoutSession = async (input) =>
  stripeBillingProvider.createCheckoutSession(input);

export const createStripeBillingPortalSession = async (input) =>
  stripeBillingProvider.createBillingPortalSession(input);

export const verifyStripeWebhookEvent = (input) =>
  stripeBillingProvider.verifyWebhookEvent(input);

export const retrieveStripeSubscription = async (input) =>
  stripeBillingProvider.retrieveSubscription(input);

export const listStripeSubscriptionsForCustomer = async (input) =>
  stripeBillingProvider.listSubscriptionsForCustomer(input);
