import request from 'supertest';
import Stripe from 'stripe';
import { jest } from '@jest/globals';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { BillingWebhookEvent } from '../src/modules/billing/models/billing-webhook-event.model.js';
import { Entitlement } from '../src/modules/billing/models/entitlement.model.js';
import { Plan } from '../src/modules/billing/models/plan.model.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { UsageMeter } from '../src/modules/billing/models/usage-meter.model.js';
import {
  processBillingWebhookEventById,
  replayPendingBillingWebhookEvents,
  syncWorkspaceSubscriptionFromStripe
} from '../src/modules/billing/services/billing-sync.service.js';
import { acceptStripeWebhookEvent } from '../src/modules/billing/services/billing-webhooks.service.js';
import { assertWorkspaceUploadAllowed } from '../src/modules/billing/services/billing-enforcement.service.js';
import { stripeBillingProvider } from '../src/modules/billing/services/providers/stripe-billing.provider.js';
import { buildOverLimitFlags } from '../src/modules/billing/utils/billing-canonical.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

afterEach(() => {
  jest.restoreAllMocks();
});

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Billing Runtime User'
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs)
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Billing Runtime User'
}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code
  });

  expect(verify.status).toBe(200);

  return {
    email,
    password,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId
  };
};

const createInviteWithToken = async ({
  workspaceId,
  accessToken,
  email,
  roleKey
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return {
    response,
    token: extractInviteTokenFromLogs(logs)
  };
};

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey, email }) => {
  const member = await createVerifiedUser({ email });
  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app).post('/api/workspaces/invites/accept').send({
    token: invite.token,
    email: member.email
  });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.email,
    password: member.password
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });

  expect(switched.status).toBe(200);
  expect(switched.body.accessToken).toBeTruthy();

  return {
    accessToken: switched.body.accessToken
  };
};

const createStripeWebhookHeader = (payload) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET
  });
};

describe('Billing Stripe runtime', () => {
  test('checkout provider does not enable Stripe promotion codes', async () => {
    const stripe = stripeBillingProvider.getClient();
    const createCheckoutSessionSpy = jest
      .spyOn(stripe.checkout.sessions, 'create')
      .mockResolvedValue({
        id: 'cs_provider_test_1',
        url: 'https://checkout.stripe.test/session/cs_provider_test_1',
        expires_at: 1735689600
      });

    await stripeBillingProvider.createCheckoutSession({
      customerId: 'cus_provider_test_1',
      workspaceId: 'workspace_provider_test_1',
      workspaceName: 'Workspace Provider Test',
      lineItems: [{ price: 'price_provider_test_1', quantity: 1 }],
      successUrl: 'http://frontend.local/billing/success',
      cancelUrl: 'http://frontend.local/billing/cancel'
    });

    expect(createCheckoutSessionSpy).toHaveBeenCalledTimes(1);
    const [payload] = createCheckoutSessionSpy.mock.calls[0];
    expect(payload.allow_promotion_codes).toBeUndefined();
  });

  maybeDbTest('checkout endpoint enforces auth/rbac/validation and returns a compact session payload', async () => {
    const unauthenticated = await request(app)
      .post('/api/billing/checkout-session')
      .send({});

    expect(unauthenticated.status).toBe(401);

    const owner = await createVerifiedUser({
      email: 'billing-runtime-checkout-owner@example.com'
    });
    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'billing-runtime-checkout-agent@example.com'
    });

    const forbidden = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .send({
        planKey: 'growth',
        successUrl: 'http://frontend.local/billing/success',
        cancelUrl: 'http://frontend.local/billing/cancel'
      });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.messageKey).toBe('errors.auth.forbiddenRole');

    const invalid = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        planKey: '',
        successUrl: 'not-a-url',
        cancelUrl: 'http://frontend.local/billing/cancel'
      });

    expect(invalid.status).toBe(422);
    expect(invalid.body.messageKey).toBe('errors.validation.failed');

    jest.spyOn(stripeBillingProvider, 'createCustomer').mockResolvedValue({
      id: 'cus_checkout_123'
    });
    jest.spyOn(stripeBillingProvider, 'createCheckoutSession').mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session/cs_test_123',
      expires_at: 1735689600
    });

    const success = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        planKey: 'growth',
        addonItems: [{ addonKey: 'extra_seat', quantity: 2 }],
        successUrl: 'http://frontend.local/billing/success',
        cancelUrl: 'http://frontend.local/billing/cancel'
      });

    expect(success.status).toBe(200);
    expect(success.body.messageKey).toBe('success.billing.checkoutSessionCreated');
    expect(success.body.checkoutSession.sessionId).toBe('cs_test_123');
    expect(success.body.checkoutSession.url).toContain('checkout.stripe.test');

    const subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.stripeCustomerId).toBe('cus_checkout_123');
  });

  maybeDbTest('portal endpoint requires meaningful managed billing linkage and returns a compact session payload for supported managed states', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-portal-owner@example.com'
    });
    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'billing-runtime-portal-agent@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      { $set: { stripeCustomerId: 'cus_portal_123' } }
    );

    const unavailable = await request(app)
      .post('/api/billing/portal-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        returnUrl: 'http://frontend.local/settings/billing'
      });

    expect(unavailable.status).toBe(409);
    expect(unavailable.body.messageKey).toBe('errors.billing.portalUnavailable');

    const forbidden = await request(app)
      .post('/api/billing/portal-session')
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .send({});

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.messageKey).toBe('errors.auth.forbiddenRole');

    const invalid = await request(app)
      .post('/api/billing/portal-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ returnUrl: 'invalid-url' });

    expect(invalid.status).toBe(422);
    expect(invalid.body.messageKey).toBe('errors.validation.failed');

    jest.spyOn(stripeBillingProvider, 'createBillingPortalSession').mockResolvedValue({
      url: 'https://billing.stripe.test/portal/session',
      created: 1735689600
    });

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          stripeSubscriptionId: 'sub_portal_123',
          status: 'past_due'
        }
      }
    );

    const success = await request(app)
      .post('/api/billing/portal-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        returnUrl: 'http://frontend.local/settings/billing'
      });

    expect(success.status).toBe(200);
    expect(success.body.messageKey).toBe('success.billing.portalSessionCreated');
    expect(success.body.portalSession.url).toContain('billing.stripe.test');
  });

  maybeDbTest('change-plan endpoint updates the Stripe base plan item and syncs local billing state', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-change-plan-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const growthPlan = await Plan.findOne({ key: 'growth' }).lean();
    expect(growthPlan).toBeTruthy();

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          planId: growthPlan._id,
          planKey: growthPlan.key,
          status: 'active',
          stripeCustomerId: 'cus_change_plan_123',
          stripeSubscriptionId: 'sub_change_plan_123',
          addonItems: [
            {
              addonKey: 'extra_seat',
              quantity: 1
            }
          ]
        }
      }
    );

    jest.spyOn(stripeBillingProvider, 'retrieveSubscription').mockResolvedValue({
      id: 'sub_change_plan_123',
      customer: 'cus_change_plan_123',
      status: 'active',
      current_period_start: 1735689600,
      current_period_end: 1738368000,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_plan_growth_123',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY }
          },
          {
            id: 'si_addon_seat_123',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY }
          }
        ]
      },
      metadata: {
        workspaceId: owner.workspaceId
      }
    });
    const updateSubscriptionSpy = jest
      .spyOn(stripeBillingProvider, 'updateSubscription')
      .mockResolvedValue({
        id: 'sub_change_plan_123',
        customer: 'cus_change_plan_123',
        status: 'active',
        current_period_start: 1735689600,
        current_period_end: 1738368000,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              id: 'si_plan_growth_123',
              quantity: 1,
              price: { id: process.env.STRIPE_PRICE_BUSINESS_MONTHLY }
            },
            {
              id: 'si_addon_seat_123',
              quantity: 1,
              price: { id: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY }
            }
          ]
        },
        metadata: {
          workspaceId: owner.workspaceId
        }
      });

    const response = await request(app)
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        planKey: 'business'
      });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.billing.planChanged');
    expect(response.body.subscriptionUpdate.previousPlanKey).toBe('growth');
    expect(response.body.subscriptionUpdate.currentPlanKey).toBe('business');
    expect(updateSubscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_change_plan_123',
        items: [
          expect.objectContaining({
            id: 'si_plan_growth_123',
            price: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
            quantity: 1
          })
        ]
      })
    );

    const subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.planKey).toBe('business');
    expect(subscription.addonItems).toHaveLength(1);
    expect(subscription.addonItems[0].addonKey).toBe('extra_seat');
  });

  maybeDbTest('change-plan endpoint treats an unchanged plan request as a successful no-op', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-change-plan-noop-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const growthPlan = await Plan.findOne({ key: 'growth' }).lean();
    expect(growthPlan).toBeTruthy();

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          planId: growthPlan._id,
          planKey: growthPlan.key,
          status: 'active',
          stripeCustomerId: 'cus_change_plan_noop_123',
          stripeSubscriptionId: 'sub_change_plan_noop_123'
        }
      }
    );

    jest.spyOn(stripeBillingProvider, 'retrieveSubscription').mockResolvedValue({
      id: 'sub_change_plan_noop_123',
      customer: 'cus_change_plan_noop_123',
      status: 'active',
      current_period_start: 1735689600,
      current_period_end: 1738368000,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_plan_growth_noop_123',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY }
          }
        ]
      },
      metadata: {
        workspaceId: owner.workspaceId
      }
    });
    const updateSubscriptionSpy = jest.spyOn(
      stripeBillingProvider,
      'updateSubscription'
    );

    const response = await request(app)
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        planKey: 'growth'
      });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.billing.planChanged');
    expect(response.body.subscriptionUpdate.previousPlanKey).toBe('growth');
    expect(response.body.subscriptionUpdate.requestedPlanKey).toBe('growth');
    expect(response.body.subscriptionUpdate.currentPlanKey).toBe('growth');
    expect(updateSubscriptionSpy).not.toHaveBeenCalled();

    const subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.planKey).toBe('growth');
  });

  maybeDbTest('update-addons endpoint patches add-on quantities, removes zero-quantity add-ons, and syncs local billing state', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-update-addons-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const growthPlan = await Plan.findOne({ key: 'growth' }).lean();
    expect(growthPlan).toBeTruthy();

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          planId: growthPlan._id,
          planKey: growthPlan.key,
          status: 'active',
          stripeCustomerId: 'cus_update_addons_123',
          stripeSubscriptionId: 'sub_update_addons_123',
          addonItems: [
            {
              addonKey: 'extra_seat',
              quantity: 1
            }
          ]
        }
      }
    );

    jest.spyOn(stripeBillingProvider, 'retrieveSubscription').mockResolvedValue({
      id: 'sub_update_addons_123',
      customer: 'cus_update_addons_123',
      status: 'active',
      current_period_start: 1735689600,
      current_period_end: 1738368000,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_plan_growth_456',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY }
          },
          {
            id: 'si_addon_seat_456',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY }
          }
        ]
      },
      metadata: {
        workspaceId: owner.workspaceId
      }
    });
    const updateSubscriptionSpy = jest
      .spyOn(stripeBillingProvider, 'updateSubscription')
      .mockResolvedValue({
        id: 'sub_update_addons_123',
        customer: 'cus_update_addons_123',
        status: 'active',
        current_period_start: 1735689600,
        current_period_end: 1738368000,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              id: 'si_plan_growth_456',
              quantity: 1,
              price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY }
            },
            {
              id: 'si_addon_storage_456',
              quantity: 2,
              price: { id: process.env.STRIPE_PRICE_EXTRA_STORAGE_MONTHLY }
            }
          ]
        },
        metadata: {
          workspaceId: owner.workspaceId
        }
      });

    const response = await request(app)
      .post('/api/billing/update-addons')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        addonItems: [
          {
            addonKey: 'extra_seat',
            quantity: 0
          },
          {
            addonKey: 'extra_storage',
            quantity: 2
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.billing.addonsUpdated');
    expect(response.body.subscriptionUpdate.addonItems).toEqual([
      {
        addonKey: 'extra_storage',
        quantity: 2
      }
    ]);
    expect(updateSubscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_update_addons_123',
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'si_addon_seat_456',
            deleted: true
          }),
          expect.objectContaining({
            price: process.env.STRIPE_PRICE_EXTRA_STORAGE_MONTHLY,
            quantity: 2
          })
        ])
      })
    );

    const subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.planKey).toBe('growth');
    expect(subscription.addonItems).toHaveLength(1);
    expect(subscription.addonItems[0].addonKey).toBe('extra_storage');
    expect(subscription.addonItems[0].quantity).toBe(2);
  });

  maybeDbTest('update-addons endpoint treats unchanged add-on quantities as a successful no-op', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-update-addons-noop-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const growthPlan = await Plan.findOne({ key: 'growth' }).lean();
    expect(growthPlan).toBeTruthy();

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          planId: growthPlan._id,
          planKey: growthPlan.key,
          status: 'active',
          stripeCustomerId: 'cus_update_addons_noop_123',
          stripeSubscriptionId: 'sub_update_addons_noop_123',
          addonItems: [
            {
              addonKey: 'extra_seat',
              quantity: 2
            }
          ]
        }
      }
    );

    jest.spyOn(stripeBillingProvider, 'retrieveSubscription').mockResolvedValue({
      id: 'sub_update_addons_noop_123',
      customer: 'cus_update_addons_noop_123',
      status: 'active',
      current_period_start: 1735689600,
      current_period_end: 1738368000,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_plan_growth_noop_456',
            quantity: 1,
            price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY }
          },
          {
            id: 'si_addon_seat_noop_456',
            quantity: 2,
            price: { id: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY }
          }
        ]
      },
      metadata: {
        workspaceId: owner.workspaceId
      }
    });
    const updateSubscriptionSpy = jest.spyOn(
      stripeBillingProvider,
      'updateSubscription'
    );

    const response = await request(app)
      .post('/api/billing/update-addons')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        addonItems: [
          {
            addonKey: 'extra_seat',
            quantity: 2
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.billing.addonsUpdated');
    expect(response.body.subscriptionUpdate.addonItems).toEqual([
      {
        addonKey: 'extra_seat',
        quantity: 2
      }
    ]);
    expect(updateSubscriptionSpy).not.toHaveBeenCalled();

    const subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.planKey).toBe('growth');
    expect(subscription.addonItems).toHaveLength(1);
    expect(subscription.addonItems[0].addonKey).toBe('extra_seat');
    expect(subscription.addonItems[0].quantity).toBe(2);
  });

  maybeDbTest('zero limits are enforceable while explicit null limits stay unlimited', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-zero-limit-owner@example.com'
    });

    const starterPlan = await Plan.findOne({ key: 'starter' });
    expect(starterPlan).toBeTruthy();
    const zeroUploadPlanKey = `zero-upload-limit-test-${String(owner.workspaceId).toLowerCase()}`;

    const zeroUploadPlan = await Plan.create({
      key: zeroUploadPlanKey,
      name: 'Zero Upload Limit Test',
      price: 0,
      currency: 'USD',
      limits: {
        seatsIncluded: 3,
        mailboxes: 1,
        storageBytes: null,
        uploadsPerMonth: 0,
        ticketsPerMonth: null
      },
      features: starterPlan.features,
      isActive: true,
      sortOrder: 999,
      catalogVersion: 'test',
      providerMetadata: {
        stripe: {
          priceId: 'price_zero_upload_limit_test'
        }
      }
    });

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          planId: zeroUploadPlan._id,
          planKey: zeroUploadPlan.key
        }
      }
    );

    await expect(
      assertWorkspaceUploadAllowed({
        workspaceId: owner.workspaceId,
        incomingSizeBytes: 1
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      messageKey: 'errors.billing.uploadLimitExceeded'
    });

    expect(
      buildOverLimitFlags({
        limits: {
          seatsIncluded: 0,
          mailboxes: null,
          storageBytes: 0,
          uploadsPerMonth: null,
          ticketsPerMonth: 1
        },
        usage: {
          current: {
            seatsUsed: 1,
            activeMailboxes: 999,
            storageBytes: 1
          },
          monthly: {
            periodKey: '2026-04',
            uploadsCount: 999,
            ticketsCreated: 2
          }
        }
      })
    ).toEqual(
      expect.objectContaining({
        seats: true,
        mailboxes: false,
        storageBytes: true,
        uploadsPerMonth: false,
        ticketsPerMonth: true,
        any: true
      })
    );
  });

  maybeDbTest('stripe webhook rejects invalid signatures and persists accepted events idempotently', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-webhook-owner@example.com'
    });

    const payload = JSON.stringify({
      id: 'evt_checkout_runtime_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_runtime_1',
          subscription: 'sub_runtime_1',
          customer: 'cus_runtime_1',
          client_reference_id: owner.workspaceId,
          metadata: {
            workspaceId: owner.workspaceId
          }
        }
      }
    });

    const invalid = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid')
      .send(payload);

    expect(invalid.status).toBe(400);
    expect(invalid.body.messageKey).toBe('errors.billing.webhookSignatureInvalid');

    const validSignature = createStripeWebhookHeader(payload);

    const accepted = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', validSignature)
      .send(payload);

    expect(accepted.status).toBe(200);
    expect(accepted.body.messageKey).toBe('success.billing.webhookAccepted');
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.body.queued).toBe(false);

    const persisted = await BillingWebhookEvent.findOne({
      provider: 'stripe',
      eventId: 'evt_checkout_runtime_1'
    }).lean();

    expect(persisted).toBeTruthy();
    expect(String(persisted.workspaceId)).toBe(String(owner.workspaceId));
    expect(persisted.status).toBe('pending');
    expect(persisted.lastEnqueueError).toBe('queue_unavailable');

    const duplicate = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', validSignature)
      .send(payload);

    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    const total = await BillingWebhookEvent.countDocuments({
      provider: 'stripe',
      eventId: 'evt_checkout_runtime_1'
    });
    expect(total).toBe(1);
  });

  maybeDbTest('duplicate processed webhook deliveries stay accepted without re-enqueueing', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-webhook-duplicate-owner@example.com'
    });

    const payload = JSON.stringify({
      id: 'evt_checkout_runtime_duplicate_processed_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_runtime_duplicate_processed_1',
          subscription: 'sub_runtime_duplicate_processed_1',
          customer: 'cus_runtime_duplicate_processed_1',
          client_reference_id: owner.workspaceId,
          metadata: {
            workspaceId: owner.workspaceId
          }
        }
      }
    });

    const signature = createStripeWebhookHeader(payload);

    await BillingWebhookEvent.create({
      workspaceId: owner.workspaceId,
      provider: 'stripe',
      eventId: 'evt_checkout_runtime_duplicate_processed_1',
      eventType: 'checkout.session.completed',
      status: 'processed',
      processedAt: new Date(),
      processingJobId: 'billing:webhook:existing-job',
      payloadHash: 'hash-duplicate-processed',
      payload: JSON.parse(payload),
      normalizedPayload: {
        workspaceId: owner.workspaceId,
        customerId: 'cus_runtime_duplicate_processed_1',
        subscriptionId: 'sub_runtime_duplicate_processed_1'
      }
    });

    const result = await acceptStripeWebhookEvent({
      signature,
      rawBody: payload
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.queued).toBe(false);

    const persisted = await BillingWebhookEvent.findOne({
      provider: 'stripe',
      eventId: 'evt_checkout_runtime_duplicate_processed_1'
    }).lean();

    expect(persisted.status).toBe('processed');
    expect(persisted.processingJobId).toBe('billing:webhook:existing-job');
    expect(persisted.lastEnqueueError).toBeNull();
  });

  maybeDbTest('accepted webhook service rejects malformed payload bodies after verification', async () => {
    jest.spyOn(stripeBillingProvider, 'verifyWebhookEvent').mockReturnValue({
      id: 'evt_malformed_payload_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_malformed_payload_1'
        }
      }
    });

    await expect(
      acceptStripeWebhookEvent({
        signature: 'sig_malformed_payload_1',
        rawBody: 'not-json'
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      messageKey: 'errors.billing.webhookPayloadInvalid'
    });
  });

  maybeDbTest('replay processes pending webhook events, clears enqueue errors, and becomes idempotent after success', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-replay-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const event = await BillingWebhookEvent.create({
      workspaceId: owner.workspaceId,
      provider: 'stripe',
      eventId: 'evt_subscription_replay_1',
      eventType: 'customer.subscription.updated',
      payloadHash: 'hash-replay',
      lastEnqueueError: 'queue_unavailable',
      payload: {
        id: 'evt_subscription_replay_1',
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            object: 'subscription',
            id: 'sub_replay_1',
            customer: 'cus_replay_1',
            status: 'active',
            current_period_start: 1735689600,
            current_period_end: 1738368000,
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY },
                  quantity: 1
                }
              ]
            },
            metadata: {
              workspaceId: owner.workspaceId
            }
          }
        }
      }
    });

    const replaySummary = await replayPendingBillingWebhookEvents();
    expect(replaySummary.scanned).toBeGreaterThanOrEqual(1);
    expect(replaySummary.processed).toBeGreaterThanOrEqual(1);
    expect(replaySummary.failed).toBe(0);

    const processedEvent = await BillingWebhookEvent.findById(event._id).lean();
    expect(processedEvent.status).toBe('processed');
    expect(processedEvent.lastEnqueueError).toBeNull();

    const secondPass = await processBillingWebhookEventById({
      webhookEventId: String(event._id)
    });

    expect(secondPass.processed).toBe(false);
    expect(secondPass.alreadyProcessed).toBe(true);
  });

  maybeDbTest('provider sync falls back only when Stripe absence is confirmed and preserves local state on provider failure', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-provider-fallback-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          stripeCustomerId: 'cus_provider_fallback_1',
          stripeSubscriptionId: null,
          status: 'trialing'
        }
      }
    );

    jest
      .spyOn(stripeBillingProvider, 'listSubscriptionsForCustomer')
      .mockResolvedValueOnce([]);

    const fallbackResult = await syncWorkspaceSubscriptionFromStripe({
      workspaceId: owner.workspaceId,
      stripeCustomerId: 'cus_provider_fallback_1'
    });

    expect(fallbackResult.subscription.status).toBe('trialing');

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          stripeCustomerId: 'cus_provider_list_failure_1',
          stripeSubscriptionId: null,
          status: 'active'
        }
      }
    );

    jest
      .spyOn(stripeBillingProvider, 'listSubscriptionsForCustomer')
      .mockRejectedValueOnce(new Error('stripe list temporarily unavailable'));

    await expect(
      syncWorkspaceSubscriptionFromStripe({
        workspaceId: owner.workspaceId,
        stripeCustomerId: 'cus_provider_list_failure_1'
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      messageKey: 'errors.billing.providerSyncFailed'
    });

    let persistedSubscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(persistedSubscription.status).toBe('active');
    expect(persistedSubscription.stripeCustomerId).toBe('cus_provider_list_failure_1');
    expect(persistedSubscription.stripeSubscriptionId).toBeNull();

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          stripeSubscriptionId: 'sub_provider_unknown_1',
          status: 'active',
          lastSyncedAt: new Date('2026-04-01T00:00:00.000Z')
        }
      }
    );

    jest
      .spyOn(stripeBillingProvider, 'retrieveSubscription')
      .mockRejectedValueOnce(new Error('stripe temporarily unavailable'));

    await expect(
      syncWorkspaceSubscriptionFromStripe({
        workspaceId: owner.workspaceId,
        stripeSubscriptionId: 'sub_provider_unknown_1'
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      messageKey: 'errors.billing.providerSyncFailed'
    });

    persistedSubscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(persistedSubscription.status).toBe('active');
    expect(persistedSubscription.stripeSubscriptionId).toBe('sub_provider_unknown_1');
  });

  maybeDbTest('scheduled replay only processes failed events and stale pending events', async () => {
    const stalePendingEvent = await BillingWebhookEvent.create({
      provider: 'stripe',
      eventId: 'evt_stale_pending_replay_1',
      eventType: 'customer.created',
      status: 'pending',
      payloadHash: 'hash-stale-pending-replay-1',
      payload: {
        id: 'evt_stale_pending_replay_1',
        object: 'event',
        type: 'customer.created',
        data: {
          object: {
            object: 'customer',
            id: 'cus_stale_pending_replay_1'
          }
        }
      },
      receivedAt: new Date(Date.now() - 10 * 60 * 1000)
    });

    const freshPendingEvent = await BillingWebhookEvent.create({
      provider: 'stripe',
      eventId: 'evt_fresh_pending_replay_1',
      eventType: 'customer.created',
      status: 'pending',
      payloadHash: 'hash-fresh-pending-replay-1',
      payload: {
        id: 'evt_fresh_pending_replay_1',
        object: 'event',
        type: 'customer.created',
        data: {
          object: {
            object: 'customer',
            id: 'cus_fresh_pending_replay_1'
          }
        }
      },
      receivedAt: new Date()
    });

    const failedEvent = await BillingWebhookEvent.create({
      provider: 'stripe',
      eventId: 'evt_failed_replay_1',
      eventType: 'customer.created',
      status: 'failed',
      payloadHash: 'hash-failed-replay-1',
      payload: {
        id: 'evt_failed_replay_1',
        object: 'event',
        type: 'customer.created',
        data: {
          object: {
            object: 'customer',
            id: 'cus_failed_replay_1'
          }
        }
      },
      receivedAt: new Date()
    });

    const replaySummary = await replayPendingBillingWebhookEvents({
      limit: 50,
      pendingOlderThanMinutes: 5
    });

    expect(replaySummary.scanned).toBe(2);
    expect(replaySummary.processed).toBe(2);
    expect(replaySummary.failed).toBe(0);

    const [reloadedStalePendingEvent, reloadedFreshPendingEvent, reloadedFailedEvent] =
      await Promise.all([
        BillingWebhookEvent.findById(stalePendingEvent._id).lean(),
        BillingWebhookEvent.findById(freshPendingEvent._id).lean(),
        BillingWebhookEvent.findById(failedEvent._id).lean()
      ]);

    expect(reloadedStalePendingEvent.status).toBe('processed');
    expect(reloadedFailedEvent.status).toBe('processed');
    expect(reloadedFreshPendingEvent.status).toBe('pending');
  });

  maybeDbTest('webhook processing syncs subscription lifecycle and preserves usage across upgrade and downgrade', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-runtime-sync-owner@example.com'
    });

    await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const periodKey = new Date().toISOString().slice(0, 7);
    await UsageMeter.updateOne(
      { workspaceId: owner.workspaceId, periodKey },
      {
        $set: {
          ticketsCreated: 11,
          uploadsCount: 7
        }
      }
    );

    const upgradeEvent = await BillingWebhookEvent.create({
      workspaceId: owner.workspaceId,
      provider: 'stripe',
      eventId: 'evt_subscription_upgrade_1',
      eventType: 'customer.subscription.updated',
      payloadHash: 'hash-upgrade',
      payload: {
        id: 'evt_subscription_upgrade_1',
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            object: 'subscription',
            id: 'sub_upgrade_1',
            customer: 'cus_upgrade_1',
            status: 'active',
            current_period_start: 1735689600,
            current_period_end: 1738368000,
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: { id: process.env.STRIPE_PRICE_GROWTH_MONTHLY },
                  quantity: 1
                },
                {
                  price: { id: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY },
                  quantity: 2
                }
              ]
            },
            metadata: {
              workspaceId: owner.workspaceId
            }
          }
        }
      }
    });

    const upgradeResult = await processBillingWebhookEventById({
      webhookEventId: String(upgradeEvent._id)
    });

    expect(upgradeResult.processed).toBe(true);

    let subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();
    let entitlement = await Entitlement.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.status).toBe('active');
    expect(subscription.planKey).toBe('growth');
    expect(subscription.stripeSubscriptionId).toBe('sub_upgrade_1');
    expect(subscription.addonItems).toHaveLength(1);
    expect(subscription.addonItems[0].addonKey).toBe('extra_seat');
    expect(subscription.addonItems[0].quantity).toBe(2);
    expect(entitlement.limits.seatsIncluded).toBe(12);
    expect(entitlement.usage.monthly.ticketsCreated).toBe(11);
    expect(entitlement.usage.monthly.uploadsCount).toBe(7);

    const downgradeEvent = await BillingWebhookEvent.create({
      workspaceId: owner.workspaceId,
      provider: 'stripe',
      eventId: 'evt_subscription_downgrade_1',
      eventType: 'customer.subscription.updated',
      payloadHash: 'hash-downgrade',
      payload: {
        id: 'evt_subscription_downgrade_1',
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            object: 'subscription',
            id: 'sub_upgrade_1',
            customer: 'cus_upgrade_1',
            status: 'active',
            current_period_start: 1735689600,
            current_period_end: 1738368000,
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: { id: process.env.STRIPE_PRICE_STARTER_MONTHLY },
                  quantity: 1
                }
              ]
            },
            metadata: {
              workspaceId: owner.workspaceId
            }
          }
        }
      }
    });

    await processBillingWebhookEventById({
      webhookEventId: String(downgradeEvent._id)
    });

    subscription = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();
    entitlement = await Entitlement.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null
    }).lean();

    expect(subscription.planKey).toBe('starter');
    expect(subscription.addonItems).toHaveLength(0);
    expect(entitlement.limits.seatsIncluded).toBe(3);
    expect(entitlement.usage.monthly.ticketsCreated).toBe(11);
    expect(entitlement.usage.monthly.uploadsCount).toBe(7);
  });
});
