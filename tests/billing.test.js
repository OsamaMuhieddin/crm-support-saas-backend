import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { Entitlement } from '../src/modules/billing/models/entitlement.model.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { UsageMeter } from '../src/modules/billing/models/usage-meter.model.js';
import {
  getBillingCatalog as getBillingCatalogPayload,
  syncBillingCatalog
} from '../src/modules/billing/services/billing-catalog.service.js';
import { billingConfig } from '../src/config/billing.config.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Billing Test User'
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
  name = 'Billing Test User'
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

describe('Billing foundation endpoints', () => {
  maybeDbTest('workspace bootstrap creates billing trial foundation immediately', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-bootstrap-owner@example.com'
    });

    const [subscription, entitlement, usageMeter] = await Promise.all([
      Subscription.findOne({ workspaceId: owner.workspaceId, deletedAt: null }).lean(),
      Entitlement.findOne({ workspaceId: owner.workspaceId, deletedAt: null }).lean(),
      UsageMeter.findOne({ workspaceId: owner.workspaceId }).lean()
    ]);

    expect(subscription).toBeTruthy();
    expect(subscription.status).toBe('trialing');
    expect(subscription.planKey).toBe('starter');
    expect(subscription.trialStartedAt).toBeTruthy();
    expect(subscription.trialEndsAt).toBeTruthy();

    expect(entitlement).toBeTruthy();
    expect(entitlement.features.billingEnabled).toBe(true);
    expect(entitlement.limits.seatsIncluded).toBe(3);
    expect(entitlement.usage.current.seatsUsed).toBe(1);

    expect(usageMeter).toBeTruthy();
    expect(usageMeter.ticketsCreated).toBe(0);
    expect(usageMeter.uploadsCount).toBe(0);
  });

  maybeDbTest('catalog endpoint returns the fixed active catalog for owner/admin', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-catalog-owner@example.com'
    });

    const ownerResponse = await request(app)
      .get('/api/billing/catalog')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.catalog.version).toBe(billingConfig.catalogVersion);
    expect(ownerResponse.body.catalog.defaultPlanKey).toBe('starter');
    expect(ownerResponse.body.catalog.plans).toHaveLength(3);
    expect(ownerResponse.body.catalog.addons.map((addon) => addon.key)).toEqual([
      'extra_seat',
      'extra_storage'
    ]);

    const admin = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.ADMIN,
      email: 'billing-catalog-admin@example.com'
    });

    const adminResponse = await request(app)
      .get('/api/billing/catalog')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.catalog.plans[0].key).toBe('starter');
    expect(adminResponse.body.catalog.plans[1].key).toBe('growth');
    expect(adminResponse.body.catalog.plans[2].key).toBe('business');
  });

  maybeDbTest('summary, subscription, entitlements, and usage bootstrap workspace billing foundation', async () => {
    const owner = await createVerifiedUser({
      email: 'billing-summary-owner@example.com'
    });

    const summaryResponse = await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.summary.subscription.status).toBe('trialing');
    expect(summaryResponse.body.summary.subscription.plan.key).toBe('starter');
    expect(summaryResponse.body.summary.subscription.provider).toBe('stripe');
    expect(summaryResponse.body.summary.flags.isTrialing).toBe(true);
    expect(summaryResponse.body.summary.entitlements.features.billingEnabled).toBe(true);
    expect(summaryResponse.body.summary.entitlements.features.slaEnabled).toBe(false);
    expect(summaryResponse.body.summary.usage.current.seatsUsed).toBe(1);
    expect(summaryResponse.body.summary.usage.current.activeMailboxes).toBe(1);
    expect(summaryResponse.body.summary.usage.monthly.periodKey).toMatch(/^\d{4}-\d{2}$/);

    const [subscription, entitlement, usageMeter] = await Promise.all([
      Subscription.findOne({ workspaceId: owner.workspaceId, deletedAt: null }).lean(),
      Entitlement.findOne({ workspaceId: owner.workspaceId, deletedAt: null }).lean(),
      UsageMeter.findOne({ workspaceId: owner.workspaceId }).lean()
    ]);

    expect(subscription).toBeTruthy();
    expect(subscription.status).toBe('trialing');
    expect(subscription.planKey).toBe('starter');
    expect(subscription.catalogVersion).toBe(billingConfig.catalogVersion);
    expect(subscription.trialStartedAt).toBeTruthy();
    expect(subscription.trialEndsAt).toBeTruthy();

    expect(entitlement).toBeTruthy();
    expect(entitlement.limits.seatsIncluded).toBe(3);
    expect(entitlement.limits.mailboxes).toBe(1);
    expect(entitlement.features.billingEnabled).toBe(true);
    expect(entitlement.usage.current.seatsUsed).toBe(1);
    expect(entitlement.usage.current.activeMailboxes).toBe(1);
    expect(entitlement.usage.monthly.uploadsCount).toBe(0);
    expect(entitlement.usage.monthly.ticketsCreated).toBe(0);

    expect(usageMeter).toBeTruthy();
    expect(usageMeter.ticketsCreated).toBe(0);
    expect(usageMeter.uploadsCount).toBe(0);

    const subscriptionResponse = await request(app)
      .get('/api/billing/subscription')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(subscriptionResponse.status).toBe(200);
    expect(subscriptionResponse.body.subscription.plan.key).toBe('starter');

    const entitlementsResponse = await request(app)
      .get('/api/billing/entitlements')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(entitlementsResponse.status).toBe(200);
    expect(entitlementsResponse.body.entitlements.limits.storageBytes).toBeGreaterThan(0);

    const usageResponse = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(usageResponse.status).toBe(200);
    expect(usageResponse.body.usage.current.storageBytes).toBeGreaterThanOrEqual(0);
    expect(usageResponse.body.usage.overLimit.any).toBe(false);
  });

  maybeDbTest('billing endpoints require auth and restrict access to owner/admin', async () => {
    const unauthenticated = await request(app).get('/api/billing/summary');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.messageKey).toBe('errors.auth.invalidToken');

    const owner = await createVerifiedUser({
      email: 'billing-rbac-owner@example.com'
    });

    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'billing-rbac-agent@example.com'
    });
    const viewer = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.VIEWER,
      email: 'billing-rbac-viewer@example.com'
    });

    const agentResponse = await request(app)
      .get('/api/billing/summary')
      .set('Authorization', `Bearer ${agent.accessToken}`);
    expect(agentResponse.status).toBe(403);
    expect(agentResponse.body.messageKey).toBe('errors.auth.forbiddenRole');

    const viewerResponse = await request(app)
      .get('/api/billing/catalog')
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(viewerResponse.status).toBe(403);
    expect(viewerResponse.body.messageKey).toBe('errors.auth.forbiddenRole');
  });

  maybeDbTest('catalog sync is idempotent and returns stable active catalog payload', async () => {
    const firstSync = await syncBillingCatalog();
    const secondSync = await syncBillingCatalog();
    const payload = await getBillingCatalogPayload();

    expect(firstSync.plans.created).toBeGreaterThan(0);
    expect(firstSync.addons.created).toBeGreaterThan(0);
    expect(secondSync.plans.created).toBe(0);
    expect(secondSync.addons.created).toBe(0);
    expect(secondSync.plans.unchanged).toBe(payload.catalog.plans.length);
    expect(secondSync.addons.unchanged).toBe(payload.catalog.addons.length);
    expect(payload.catalog.plans).toHaveLength(3);
    expect(payload.catalog.addons).toHaveLength(2);
  });
});
