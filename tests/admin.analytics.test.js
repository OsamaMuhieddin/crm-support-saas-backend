import request from 'supertest';
import app from '../src/app.js';
import { Entitlement } from '../src/modules/billing/models/entitlement.model.js';
import { Plan } from '../src/modules/billing/models/plan.model.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { syncBillingCatalog } from '../src/modules/billing/services/billing-catalog.service.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { PlatformAdmin } from '../src/modules/platform/models/platform-admin.model.js';
import { PlatformMetricDaily } from '../src/modules/platform/models/platform-metric-daily.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { hashPlatformPassword } from '../src/modules/admin/services/admin-auth.service.js';
import { PLATFORM_ROLES } from '../src/constants/platform-roles.js';
import { captureFallbackEmail, extractOtpCodeFromLogs } from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Workspace Owner',
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs),
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Workspace Owner',
}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });

  expect(signup.response.status).toBe(200);

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code,
  });

  expect(verify.status).toBe(200);

  return {
    email,
    password,
    user: verify.body.user,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
  };
};

const createPlatformAdmin = async ({
  email,
  password = 'Password123!',
  role = PLATFORM_ROLES.SUPER_ADMIN,
  status = 'active',
}) => {
  const admin = await PlatformAdmin.create({
    email,
    passwordHash: await hashPlatformPassword(password),
    role,
    status,
  });

  return {
    admin,
    email,
    password,
  };
};

const loginPlatformAdmin = async ({ email, password }) => {
  const response = await request(app).post('/api/admin/auth/login').send({
    email,
    password,
  });

  expect(response.status).toBe(200);

  return response.body.tokens.accessToken;
};

const seedTicket = async ({
  workspaceId,
  mailboxId,
  number,
  ownerUserId,
  subject,
  status = 'open',
  createdAt,
}) => {
  await Ticket.collection.insertOne({
    workspaceId,
    mailboxId,
    number,
    subject,
    subjectNormalized: subject.toLowerCase(),
    status,
    priority: 'normal',
    channel: 'manual',
    contactId: new Workspace.base.Types.ObjectId(),
    assigneeId: ownerUserId,
    categoryId: null,
    tagIds: [],
    messageCount: 0,
    publicMessageCount: 0,
    internalNoteCount: 0,
    attachmentCount: 0,
    participantCount: 0,
    statusChangedAt: createdAt,
    assignedAt: createdAt,
    closedAt: status === 'closed' ? createdAt : null,
    sla: {},
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  });
};

const seedPlatformAnalyticsData = async () => {
  await syncBillingCatalog();
  const [starterPlan, growthPlan] = await Promise.all([
    Plan.findOne({ key: 'starter' }).select('_id').lean(),
    Plan.findOne({ key: 'growth' }).select('_id').lean(),
  ]);

  const ownerA = await createVerifiedUser({
    email: `analytics-a-${Date.now()}@example.com`,
    name: 'Alpha Owner',
  });
  const ownerB = await createVerifiedUser({
    email: `analytics-b-${Date.now()}@example.com`,
    name: 'Beta Owner',
  });
  const ownerC = await createVerifiedUser({
    email: `analytics-c-${Date.now()}@example.com`,
    name: 'Gamma Owner',
  });

  const [workspaceA, workspaceB, workspaceC] = await Promise.all([
    Workspace.findById(ownerA.workspaceId).select('_id ownerUserId defaultMailboxId').lean(),
    Workspace.findById(ownerB.workspaceId).select('_id ownerUserId defaultMailboxId').lean(),
    Workspace.findById(ownerC.workspaceId).select('_id ownerUserId defaultMailboxId').lean(),
  ]);

  await Mailbox.create({
    workspaceId: workspaceA._id,
    name: 'Escalations',
    type: 'email',
    emailAddress: `analytics-escalations-${Date.now()}@example.com`,
  });

  await Workspace.updateOne(
    { _id: workspaceB._id },
    { $set: { status: 'trial' } }
  );
  await Workspace.updateOne(
    { _id: workspaceC._id },
    { $set: { status: 'suspended' } }
  );

  await Promise.all([
    Subscription.updateOne(
      { workspaceId: workspaceA._id, deletedAt: null },
      {
        $set: {
          status: 'active',
          planId: growthPlan._id,
          planKey: 'growth',
          addonItems: [{ addonKey: 'extra_seat', quantity: 1 }],
          stripeSubscriptionId: 'sub_active_alpha',
          stripeCustomerId: 'cus_active_alpha',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
          lastSyncedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      }
    ),
    Subscription.updateOne(
      { workspaceId: workspaceB._id, deletedAt: null },
      {
        $set: {
          status: 'trialing',
          planId: starterPlan._id,
          planKey: 'starter',
          addonItems: [],
          stripeSubscriptionId: null,
          stripeCustomerId: null,
          trialEndsAt: new Date('2026-04-20T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-04-20T00:00:00.000Z'),
          lastSyncedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      }
    ),
    Subscription.updateOne(
      { workspaceId: workspaceC._id, deletedAt: null },
      {
        $set: {
          status: 'past_due',
          planId: starterPlan._id,
          planKey: 'starter',
          addonItems: [],
          stripeSubscriptionId: 'sub_past_due_gamma',
          stripeCustomerId: 'cus_past_due_gamma',
          graceEndsAt: new Date('2026-04-25T00:00:00.000Z'),
          partialBlockStartsAt: new Date('2026-04-15T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-05-10T00:00:00.000Z'),
          lastSyncedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      }
    ),
  ]);

  await Promise.all([
    Entitlement.updateOne(
      { workspaceId: workspaceA._id, deletedAt: null },
      {
        $set: {
          features: { slaEnabled: true },
          limits: {
            seatsIncluded: 1,
            mailboxes: 1,
            storageBytes: 100,
            uploadsPerMonth: 10,
            ticketsPerMonth: 10,
          },
          usage: {
            current: {
              seatsUsed: 2,
              activeMailboxes: 2,
              storageBytes: 200,
            },
            monthly: {
              periodKey: '2026-04',
              ticketsCreated: 5,
              uploadsCount: 4,
            },
          },
          computedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      { upsert: true }
    ),
    Entitlement.updateOne(
      { workspaceId: workspaceB._id, deletedAt: null },
      {
        $set: {
          features: { slaEnabled: false },
          limits: {
            seatsIncluded: 3,
            mailboxes: 2,
            storageBytes: 1000,
            uploadsPerMonth: 100,
            ticketsPerMonth: 100,
          },
          usage: {
            current: {
              seatsUsed: 1,
              activeMailboxes: 1,
              storageBytes: 10,
            },
            monthly: {
              periodKey: '2026-04',
              ticketsCreated: 1,
              uploadsCount: 1,
            },
          },
          computedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      { upsert: true }
    ),
    Entitlement.updateOne(
      { workspaceId: workspaceC._id, deletedAt: null },
      {
        $set: {
          features: { slaEnabled: true },
          limits: {
            seatsIncluded: 5,
            mailboxes: 5,
            storageBytes: 1000,
            uploadsPerMonth: 1,
            ticketsPerMonth: 1,
          },
          usage: {
            current: {
              seatsUsed: 1,
              activeMailboxes: 1,
              storageBytes: 100,
            },
            monthly: {
              periodKey: '2026-04',
              ticketsCreated: 2,
              uploadsCount: 2,
            },
          },
          computedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      { upsert: true }
    ),
  ]);

  await Promise.all([
    seedTicket({
      workspaceId: workspaceA._id,
      mailboxId: workspaceA.defaultMailboxId,
      ownerUserId: workspaceA.ownerUserId,
      number: 1,
      subject: 'Recent Alpha Ticket',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
    }),
    seedTicket({
      workspaceId: workspaceB._id,
      mailboxId: workspaceB.defaultMailboxId,
      ownerUserId: workspaceB.ownerUserId,
      number: 1,
      subject: 'Recent Beta Ticket',
      createdAt: new Date('2026-04-02T10:00:00.000Z'),
    }),
    seedTicket({
      workspaceId: workspaceC._id,
      mailboxId: workspaceC.defaultMailboxId,
      ownerUserId: workspaceC.ownerUserId,
      number: 1,
      subject: 'Older Gamma Ticket',
      createdAt: new Date('2026-02-10T10:00:00.000Z'),
    }),
  ]);

  await PlatformMetricDaily.create([
    {
      dateKey: '2026-04-01',
      totals: {
        workspacesCount: 10,
        activeUsersCount: 100,
        ticketsCount: 1000,
        revenueCents: 9900,
      },
    },
    {
      dateKey: '2026-04-03',
      totals: {
        workspacesCount: 11,
        activeUsersCount: 110,
        ticketsCount: 1050,
        revenueCents: 10100,
      },
    },
  ]);

  return {
    ownerA,
    ownerB,
    ownerC,
  };
};

describe('Admin analytics', () => {
  maybeDbTest(
    'overview and metrics allow platform admin, while billing overview stays super-admin only',
    async () => {
      await seedPlatformAnalyticsData();

      const platformAdmin = await createPlatformAdmin({
        email: `platform-analytics-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.PLATFORM_ADMIN,
      });
      const supportAdmin = await createPlatformAdmin({
        email: `platform-support-analytics-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.PLATFORM_SUPPORT,
      });
      const superAdmin = await createPlatformAdmin({
        email: `super-analytics-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.SUPER_ADMIN,
      });

      const platformToken = await loginPlatformAdmin(platformAdmin);
      const supportToken = await loginPlatformAdmin(supportAdmin);
      const superToken = await loginPlatformAdmin(superAdmin);

      const supportOverview = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${supportToken}`);

      expect(supportOverview.status).toBe(403);
      expect(supportOverview.body.messageKey).toBe(
        'errors.platformAuth.forbiddenRole'
      );

      const platformOverview = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(platformOverview.status).toBe(200);
      expect(platformOverview.body.overview.report).toBe('overview');

      const platformMetrics = await request(app)
        .get('/api/admin/metrics?from=2026-04-01&to=2026-04-03&groupBy=day')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(platformMetrics.status).toBe(200);
      expect(platformMetrics.body.metrics.report).toBe('metrics');

      const platformBillingOverview = await request(app)
        .get('/api/admin/billing-overview')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(platformBillingOverview.status).toBe(403);
      expect(platformBillingOverview.body.messageKey).toBe(
        'errors.platformAuth.forbiddenRole'
      );

      const superBillingOverview = await request(app)
        .get('/api/admin/billing-overview')
        .set('Authorization', `Bearer ${superToken}`);

      expect(superBillingOverview.status).toBe(200);
      expect(superBillingOverview.body.billingOverview.report).toBe(
        'billing_overview'
      );
    }
  );

  maybeDbTest(
    'overview and billing-overview return grouped live analytics with revenue visibility handled carefully',
    async () => {
      await seedPlatformAnalyticsData();

      const platformAdmin = await createPlatformAdmin({
        email: `platform-overview-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.PLATFORM_ADMIN,
      });
      const superAdmin = await createPlatformAdmin({
        email: `super-overview-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.SUPER_ADMIN,
      });

      const platformToken = await loginPlatformAdmin(platformAdmin);
      const superToken = await loginPlatformAdmin(superAdmin);

      const overviewResponse = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(overviewResponse.status).toBe(200);
      expect(overviewResponse.body.overview).toEqual(
        expect.objectContaining({
          report: 'overview',
          platformRole: PLATFORM_ROLES.PLATFORM_ADMIN,
          kpis: expect.objectContaining({
            totalWorkspaces: 3,
            activeWorkspaces: 1,
            suspendedWorkspaces: 1,
            trialWorkspaces: 1,
            activeUsersCount: 3,
            totalTicketsCount: 3,
            ticketsCreatedLast30Days: 2,
          }),
          billing: expect.objectContaining({
            statusCounts: expect.objectContaining({
              active: 1,
              trialing: 1,
              past_due: 1,
            }),
            revenue: expect.objectContaining({
              visible: false,
            }),
          }),
          operational: expect.objectContaining({
            totalMailboxesCount: 4,
            usagePressure: expect.objectContaining({
              workspacesWithEntitlements: 3,
              overSeatLimit: 1,
              overMailboxLimit: 1,
              overStorageLimit: 1,
              overUploadsPerMonthLimit: 1,
              overTicketsPerMonthLimit: 1,
              anyOverLimit: 2,
              slaDisabled: 1,
            }),
          }),
        })
      );

      const billingOverviewResponse = await request(app)
        .get('/api/admin/billing-overview')
        .set('Authorization', `Bearer ${superToken}`);

      expect(billingOverviewResponse.status).toBe(200);
      expect(billingOverviewResponse.body.billingOverview).toEqual(
        expect.objectContaining({
          report: 'billing_overview',
          platformRole: PLATFORM_ROLES.SUPER_ADMIN,
          subscriptionStatus: expect.objectContaining({
            counts: expect.objectContaining({
              active: 1,
              trialing: 1,
              past_due: 1,
            }),
          }),
          lifecycle: expect.objectContaining({
            trialing: 1,
            pastDue: 1,
            inGracePeriod: 1,
            partialBlockActive: 1,
            cancelAtPeriodEnd: 1,
            providerManaged: 2,
          }),
          usagePressure: expect.objectContaining({
            overSeatLimit: 1,
            overMailboxLimit: 1,
            overStorageLimit: 1,
            overUploadsPerMonthLimit: 1,
            overTicketsPerMonthLimit: 1,
            anyOverLimit: 2,
            slaDisabled: 1,
          }),
          revenue: expect.objectContaining({
            visible: true,
            currentMrrCents: 12000,
            managedSubscriptionCount: 2,
            unsupportedSubscriptionCount: 0,
          }),
        })
      );

      expect(billingOverviewResponse.body.billingOverview.plans.distribution).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'starter',
            count: 2,
          }),
          expect.objectContaining({
            key: 'growth',
            count: 1,
          }),
        ])
      );
    }
  );

  maybeDbTest(
    'metrics validates filters and returns partial PlatformMetricDaily series honestly when history is incomplete',
    async () => {
      await seedPlatformAnalyticsData();

      const platformAdmin = await createPlatformAdmin({
        email: `platform-metrics-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.PLATFORM_ADMIN,
      });
      const superAdmin = await createPlatformAdmin({
        email: `super-metrics-${Date.now()}@example.com`,
        role: PLATFORM_ROLES.SUPER_ADMIN,
      });

      const platformToken = await loginPlatformAdmin(platformAdmin);
      const superToken = await loginPlatformAdmin(superAdmin);

      const invalidMetrics = await request(app)
        .get('/api/admin/metrics?from=2026-04-03&to=2026-04-01&groupBy=day')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(invalidMetrics.status).toBe(422);
      expect(invalidMetrics.body.messageKey).toBe('errors.validation.failed');

      const platformMetrics = await request(app)
        .get('/api/admin/metrics?from=2026-04-01&to=2026-04-03&groupBy=day')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(platformMetrics.status).toBe(200);
      expect(platformMetrics.body.metrics.coverage).toEqual(
        expect.objectContaining({
          expectedBuckets: 3,
          bucketsWithSnapshots: 2,
          availableDailySnapshots: 2,
          isComplete: false,
        })
      );
      expect(platformMetrics.body.metrics.series.workspaces).toEqual([
        expect.objectContaining({
          key: '2026-04-01',
          sourceDateKey: '2026-04-01',
          value: 10,
        }),
        expect.objectContaining({
          key: '2026-04-02',
          sourceDateKey: null,
          value: null,
        }),
        expect.objectContaining({
          key: '2026-04-03',
          sourceDateKey: '2026-04-03',
          value: 11,
        }),
      ]);
      expect(platformMetrics.body.metrics.series).not.toHaveProperty('revenue');

      const superMetrics = await request(app)
        .get('/api/admin/metrics?from=2026-04-01&to=2026-04-03&groupBy=day')
        .set('Authorization', `Bearer ${superToken}`);

      expect(superMetrics.status).toBe(200);
      expect(superMetrics.body.metrics.series.revenue).toEqual([
        expect.objectContaining({
          key: '2026-04-01',
          value: 9900,
        }),
        expect.objectContaining({
          key: '2026-04-02',
          value: null,
        }),
        expect.objectContaining({
          key: '2026-04-03',
          value: 10100,
        }),
      ]);
    }
  );
});
