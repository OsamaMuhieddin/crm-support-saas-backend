import {
  arrayOf,
  commonErrorResponses,
  integerSchema,
  jsonRequest,
  objectSchema,
  operation,
  parameterRef,
  ref,
  booleanSchema,
  stringSchema,
} from '../../../docs/openapi/helpers.js';

const checkoutAddonItemSchema = objectSchema(
  {
    addonKey: stringSchema({ minLength: 1, maxLength: 120 }),
    quantity: integerSchema({ minimum: 1, maximum: 1000 }),
  },
  { required: ['addonKey', 'quantity'], additionalProperties: false }
);

const addonItemSchema = objectSchema(
  {
    addonKey: stringSchema({ minLength: 1, maxLength: 120 }),
    quantity: integerSchema({ minimum: 0, maximum: 1000 }),
  },
  { required: ['addonKey', 'quantity'], additionalProperties: false }
);

export const billingOpenApiPaths = {
  '/billing/webhooks/stripe': {
    post: operation({
      tags: 'Billing',
      summary: 'Accept Stripe webhook',
      operationId: 'acceptStripeWebhook',
      security: 'stripeWebhook',
      includeLang: false,
      description:
        'Purpose: accept a Stripe webhook event using the raw request body and stripe-signature header. This route is public to Stripe but signature-protected.',
      parameters: [parameterRef('StripeSignatureHeader')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: objectSchema({}, { additionalProperties: true }),
          },
        },
      },
      responses: {
        200: {
          description: 'Webhook accepted.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  ref('SuccessEnvelope'),
                  objectSchema(
                    { accepted: booleanSchema() },
                    { additionalProperties: true }
                  ),
                ],
              },
            },
          },
        },
        ...commonErrorResponses(['400', '422', '500']),
      },
    }),
  },
  '/billing/catalog': {
    get: operation({
      tags: 'Billing',
      summary: 'Get billing catalog',
      operationId: 'getBillingCatalog',
      description:
        'Purpose: return available billing plans and add-ons. Authorization: owner or admin roleKey required.',
      success: {
        payload: {
          plans: arrayOf(ref('BillingPlan')),
          addons: arrayOf(ref('BillingAddon')),
        },
      },
    }),
  },
  '/billing/subscription': {
    get: operation({
      tags: 'Billing',
      summary: 'Get current subscription',
      operationId: 'getBillingSubscription',
      description:
        'Purpose: return the current workspace subscription. Authorization: owner or admin roleKey required.',
      success: { payload: { subscription: ref('BillingSubscription') } },
    }),
  },
  '/billing/entitlements': {
    get: operation({
      tags: 'Billing',
      summary: 'Get current entitlements',
      operationId: 'getBillingEntitlements',
      description:
        'Purpose: return current workspace billing entitlements. Authorization: owner or admin roleKey required.',
      success: { payload: { entitlements: ref('BillingEntitlements') } },
    }),
  },
  '/billing/usage': {
    get: operation({
      tags: 'Billing',
      summary: 'Get current usage',
      operationId: 'getBillingUsage',
      description:
        'Purpose: return current workspace billing usage. Authorization: owner or admin roleKey required.',
      success: { payload: { usage: ref('BillingUsage') } },
    }),
  },
  '/billing/summary': {
    get: operation({
      tags: 'Billing',
      summary: 'Get billing summary',
      operationId: 'getBillingSummary',
      description:
        'Purpose: return subscription, entitlement, usage, and flag summary for the active workspace. Authorization: owner or admin roleKey required.',
      success: { payload: { summary: ref('BillingSummary') } },
    }),
  },
  '/billing/checkout-session': {
    post: operation({
      tags: 'Billing',
      summary: 'Create checkout session',
      operationId: 'createBillingCheckoutSession',
      description:
        'Purpose: create a Stripe checkout session for a plan and optional add-ons. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(
        objectSchema(
          {
            planKey: stringSchema({ minLength: 1, maxLength: 120 }),
            addonItems: arrayOf(checkoutAddonItemSchema, { maxItems: 20 }),
            successUrl: stringSchema({ format: 'uri' }),
            cancelUrl: stringSchema({ format: 'uri' }),
          },
          {
            required: ['planKey'],
            additionalProperties: false,
          }
        )
      ),
      success: {
        messageKey: 'success.billing.checkoutSessionCreated',
        payload: { checkoutSession: ref('BillingCheckoutSession') },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/billing/portal-session': {
    post: operation({
      tags: 'Billing',
      summary: 'Create billing portal session',
      operationId: 'createBillingPortalSession',
      description:
        'Purpose: create a Stripe billing portal session. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(
        objectSchema(
          {
            returnUrl: stringSchema({ format: 'uri' }),
          },
          { additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.billing.portalSessionCreated',
        payload: { portalSession: ref('BillingPortalSession') },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/billing/change-plan': {
    post: operation({
      tags: 'Billing',
      summary: 'Change billing plan',
      operationId: 'changeBillingPlan',
      description:
        'Purpose: change the current workspace plan through the billing provider. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(
        objectSchema(
          {
            planKey: stringSchema({ minLength: 1, maxLength: 120 }),
          },
          { required: ['planKey'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.billing.planChanged',
        payload: {
          subscriptionUpdate: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/billing/update-addons': {
    post: operation({
      tags: 'Billing',
      summary: 'Update billing add-ons',
      operationId: 'updateBillingAddons',
      description:
        'Purpose: update add-on quantities for the current workspace subscription. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(
        objectSchema(
          {
            addonItems: arrayOf(addonItemSchema, { minItems: 1, maxItems: 20 }),
          },
          { required: ['addonItems'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.billing.addonsUpdated',
        payload: {
          subscriptionUpdate: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
};
