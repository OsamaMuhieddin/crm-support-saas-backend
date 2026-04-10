import request from 'supertest';
import app from '../src/app.js';
import { PlatformAdmin } from '../src/modules/platform/models/platform-admin.model.js';
import { PLATFORM_ROLES } from '../src/constants/platform-roles.js';
import { hashPlatformPassword } from '../src/modules/admin/services/admin-auth.service.js';
import {
  captureFallbackEmail,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { Entitlement } from '../src/modules/billing/models/entitlement.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { WorkspaceInvite } from '../src/modules/workspaces/models/workspace-invite.model.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { MEMBER_STATUS } from '../src/constants/member-status.js';

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

const seedWorkspaceInspectionData = async ({
  owner,
  memberEmail,
  pendingInviteEmail,
}) => {
  const workspace = await Workspace.findById(owner.workspaceId)
    .select('_id ownerUserId defaultMailboxId')
    .lean();

  const extraMailbox = await Mailbox.create({
    workspaceId: workspace._id,
    name: 'Escalations',
    type: 'email',
    emailAddress: `escalations-${owner.workspaceId}@example.com`,
  });

  const extraMember = await createVerifiedUser({
    email: memberEmail,
    name: 'Workspace Agent',
  });

  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: extraMember.user._id,
    roleKey: 'agent',
    status: MEMBER_STATUS.ACTIVE,
  });

  await WorkspaceInvite.create({
    workspaceId: workspace._id,
    email: pendingInviteEmail,
    roleKey: 'viewer',
    invitedByUserId: workspace.ownerUserId,
    tokenHash: `pending-${workspace._id}-${Date.now()}`,
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  await Ticket.collection.insertMany([
    {
      workspaceId: workspace._id,
      mailboxId: workspace.defaultMailboxId,
      number: 1,
      subject: 'Open admin ticket',
      subjectNormalized: 'open admin ticket',
      status: 'open',
      priority: 'normal',
      channel: 'manual',
      contactId: new Workspace.base.Types.ObjectId(),
      assigneeId: workspace.ownerUserId,
      categoryId: null,
      tagIds: [],
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: new Date('2026-04-01T10:00:00.000Z'),
      assignedAt: new Date('2026-04-01T10:00:00.000Z'),
      closedAt: null,
      sla: {},
      deletedAt: null,
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    },
    {
      workspaceId: workspace._id,
      mailboxId: extraMailbox._id,
      number: 2,
      subject: 'Solved admin ticket',
      subjectNormalized: 'solved admin ticket',
      status: 'solved',
      priority: 'high',
      channel: 'manual',
      contactId: new Workspace.base.Types.ObjectId(),
      assigneeId: extraMember.user._id,
      categoryId: null,
      tagIds: [],
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: new Date('2026-04-02T10:00:00.000Z'),
      assignedAt: new Date('2026-04-02T10:00:00.000Z'),
      closedAt: null,
      sla: {},
      deletedAt: null,
      createdAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    },
  ]);

    await Subscription.updateOne(
      { workspaceId: workspace._id, deletedAt: null },
      {
        $set: {
          status: 'trialing',
          planKey: 'starter',
          trialEndsAt: new Date('2026-04-20T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-04-20T00:00:00.000Z'),
        },
      }
    );

  await Entitlement.updateOne(
    { workspaceId: workspace._id, deletedAt: null },
    {
      $set: {
        features: {
          slaEnabled: true,
        },
      },
    },
    { upsert: true }
  );
};

describe('Admin workspace management', () => {
  maybeDbTest('admin workspace list and detail require platform auth', async () => {
    const owner = await createVerifiedUser({
      email: `admin-list-owner-${Date.now()}@example.com`,
      name: 'Owner List',
    });
    const supportAdmin = await createPlatformAdmin({
      email: `platform-support-${Date.now()}@example.com`,
      role: PLATFORM_ROLES.PLATFORM_SUPPORT,
    });

    const unauthenticated = await request(app).get('/api/admin/workspaces');

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.messageKey).toBe(
      'errors.platformAuth.invalidToken'
    );

    const supportAccessToken = await loginPlatformAdmin(supportAdmin);

    const listResponse = await request(app)
      .get('/api/admin/workspaces')
      .set('Authorization', `Bearer ${supportAccessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.workspaces)).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/admin/workspaces/${owner.workspaceId}`)
      .set('Authorization', `Bearer ${supportAccessToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.workspace._id).toBe(owner.workspaceId);
  });

  maybeDbTest('admin workspace list rejects unknown query filters', async () => {
    const superAdmin = await createPlatformAdmin({
      email: `super-list-query-${Date.now()}@example.com`,
    });
    const accessToken = await loginPlatformAdmin(superAdmin);

    const response = await request(app)
      .get('/api/admin/workspaces?workspaceId=should-not-pass')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.messageKey).toBe('errors.validation.failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'workspaceId',
          messageKey: 'errors.validation.unknownField',
        }),
      ])
    );
  });

  maybeDbTest('admin workspace list and detail return compact inspection data', async () => {
    const superAdmin = await createPlatformAdmin({
      email: `super-list-${Date.now()}@example.com`,
    });
    const ownerA = await createVerifiedUser({
      email: `workspace-a-${Date.now()}@example.com`,
      name: 'Alpha Owner',
    });
    const ownerB = await createVerifiedUser({
      email: `workspace-b-${Date.now()}@example.com`,
      name: 'Beta Owner',
    });

    await seedWorkspaceInspectionData({
      owner: ownerA,
      memberEmail: `workspace-agent-${Date.now()}@example.com`,
      pendingInviteEmail: `pending-${Date.now()}@example.com`,
    });

    await Subscription.updateOne(
      { workspaceId: ownerB.workspaceId, deletedAt: null },
      {
        $set: {
          status: 'active',
          planKey: 'growth',
        },
      }
    );

    const accessToken = await loginPlatformAdmin(superAdmin);

    const listResponse = await request(app)
      .get(
        `/api/admin/workspaces?status=active&billingStatus=trialing&trialing=true&planKey=starter&q=Alpha`
      )
      .set('Authorization', `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.total).toBe(1);
    expect(listResponse.body.workspaces).toHaveLength(1);
    expect(listResponse.body.workspaces[0]).toEqual(
      expect.objectContaining({
        _id: ownerA.workspaceId,
        name: expect.stringContaining('Alpha'),
        status: 'active',
        owner: expect.objectContaining({
          email: ownerA.email,
          name: 'Alpha Owner',
        }),
        billing: expect.objectContaining({
          status: 'trialing',
          planKey: 'starter',
        }),
        usage: expect.objectContaining({
          seatsUsed: 3,
          activeMailboxes: 2,
          storageBytes: 0,
        }),
        entitlementSummary: expect.objectContaining({
          slaEnabled: true,
        }),
      })
    );

    const detailResponse = await request(app)
      .get(`/api/admin/workspaces/${ownerA.workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.workspace).toEqual(
      expect.objectContaining({
        _id: ownerA.workspaceId,
        status: 'active',
      })
    );
    expect(detailResponse.body.owner).toEqual(
      expect.objectContaining({
        email: ownerA.email,
        name: 'Alpha Owner',
      })
    );
    expect(detailResponse.body.billing.subscription).toEqual(
      expect.objectContaining({
        status: 'trialing',
        planKey: 'starter',
      })
    );
    expect(detailResponse.body.usage.current).toEqual(
      expect.objectContaining({
        seatsUsed: 3,
        activeMailboxes: 2,
        storageBytes: 0,
      })
    );
    expect(detailResponse.body.counts).toEqual(
      expect.objectContaining({
        members: expect.objectContaining({
          active: 2,
          suspended: 0,
          removed: 0,
        }),
        pendingInvites: 1,
        mailboxes: expect.objectContaining({
          total: 2,
          active: 2,
        }),
        tickets: expect.objectContaining({
          total: 2,
          statusBreakdown: expect.objectContaining({
            open: 1,
            solved: 1,
          }),
        }),
      })
    );
  });

  maybeDbTest('workspace suspend and reactivate are super-admin-only, idempotent, and block runtime access', async () => {
    const owner = await createVerifiedUser({
      email: `suspend-owner-${Date.now()}@example.com`,
      name: 'Suspend Owner',
    });
    const supportAdmin = await createPlatformAdmin({
      email: `support-suspend-${Date.now()}@example.com`,
      role: PLATFORM_ROLES.PLATFORM_SUPPORT,
    });
    const superAdmin = await createPlatformAdmin({
      email: `super-suspend-${Date.now()}@example.com`,
      role: PLATFORM_ROLES.SUPER_ADMIN,
    });

    const supportToken = await loginPlatformAdmin(supportAdmin);
    const superToken = await loginPlatformAdmin(superAdmin);
    const subscriptionBefore = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null,
    })
      .select('status planKey trialEndsAt currentPeriodEnd')
      .lean();

    const forbiddenSuspend = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/suspend`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({});

    expect(forbiddenSuspend.status).toBe(403);
    expect(forbiddenSuspend.body.messageKey).toBe(
      'errors.platformAuth.forbiddenRole'
    );

    const firstSuspend = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/suspend`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({});

    expect(firstSuspend.status).toBe(200);
    expect(firstSuspend.body.changed).toBe(true);
    expect(firstSuspend.body.workspace.status).toBe('suspended');

    const secondSuspend = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/suspend`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({});

    expect(secondSuspend.status).toBe(200);
    expect(secondSuspend.body.changed).toBe(false);
    expect(secondSuspend.body.workspace.status).toBe('suspended');

    const blockedReport = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(blockedReport.status).toBe(403);
    expect(blockedReport.body.messageKey).toBe('errors.workspace.suspended');

    const firstReactivate = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/reactivate`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({});

    expect(firstReactivate.status).toBe(200);
    expect(firstReactivate.body.changed).toBe(true);
    expect(firstReactivate.body.workspace.status).toBe('trial');

    const secondReactivate = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/reactivate`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({});

    expect(secondReactivate.status).toBe(200);
    expect(secondReactivate.body.changed).toBe(false);
    expect(secondReactivate.body.workspace.status).toBe('trial');

    const reportAfterReactivate = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(reportAfterReactivate.status).toBe(200);

    const subscriptionAfter = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null,
    })
      .select('status planKey trialEndsAt currentPeriodEnd')
      .lean();

    expect(subscriptionAfter).toMatchObject({
      status: subscriptionBefore.status,
      planKey: subscriptionBefore.planKey,
      trialEndsAt: subscriptionBefore.trialEndsAt,
      currentPeriodEnd: subscriptionBefore.currentPeriodEnd,
    });
  });

  maybeDbTest('workspace extend-trial validates input and enforces trialing-only business rules', async () => {
    const owner = await createVerifiedUser({
      email: `trial-owner-${Date.now()}@example.com`,
      name: 'Trial Owner',
    });
    const superAdmin = await createPlatformAdmin({
      email: `super-trial-${Date.now()}@example.com`,
    });

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          status: 'trialing',
          planKey: 'starter',
          trialEndsAt: new Date('2026-04-20T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-04-20T00:00:00.000Z'),
          graceStartsAt: new Date('2026-04-10T00:00:00.000Z'),
          graceEndsAt: new Date('2026-04-12T00:00:00.000Z'),
          pastDueAt: new Date('2026-04-10T00:00:00.000Z'),
          partialBlockStartsAt: new Date('2026-04-13T00:00:00.000Z'),
          canceledAt: new Date('2026-04-14T00:00:00.000Z'),
          cancelAtPeriodEnd: true,
        },
      }
    );

    const accessToken = await loginPlatformAdmin(superAdmin);

    const invalidDays = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/extend-trial`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ days: 0 });

    expect(invalidDays.status).toBe(422);
    expect(invalidDays.body.messageKey).toBe('errors.validation.failed');

    const extendResponse = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/extend-trial`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ days: 5 });

    expect(extendResponse.status).toBe(200);
    expect(extendResponse.body.trialExtension).toEqual(
      expect.objectContaining({
        workspaceId: owner.workspaceId,
        daysExtended: 5,
        subscriptionStatus: 'trialing',
      })
    );
    expect(extendResponse.body.trialExtension.trialEndsAt).toBe(
      '2026-04-25T00:00:00.000Z'
    );
    expect(extendResponse.body.trialExtension.currentPeriodEnd).toBe(
      '2026-04-25T00:00:00.000Z'
    );

    const subscriptionAfterExtension = await Subscription.findOne({
      workspaceId: owner.workspaceId,
      deletedAt: null,
    })
      .select(
        'trialEndsAt currentPeriodEnd graceStartsAt graceEndsAt pastDueAt partialBlockStartsAt canceledAt cancelAtPeriodEnd'
      )
      .lean();

    expect(subscriptionAfterExtension).toEqual(
      expect.objectContaining({
        graceStartsAt: null,
        graceEndsAt: null,
        pastDueAt: null,
        partialBlockStartsAt: null,
        canceledAt: null,
        cancelAtPeriodEnd: false,
      })
    );

    await Subscription.updateOne(
      { workspaceId: owner.workspaceId, deletedAt: null },
      {
        $set: {
          status: 'active',
        },
      }
    );

    const invalidState = await request(app)
      .post(`/api/admin/workspaces/${owner.workspaceId}/extend-trial`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ days: 3 });

    expect(invalidState.status).toBe(409);
    expect(invalidState.body.messageKey).toBe(
      'errors.billing.trialExtensionNotAllowed'
    );
  });
});
