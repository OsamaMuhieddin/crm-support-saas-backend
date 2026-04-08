import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { TicketCategory } from '../src/modules/tickets/models/ticket-category.model.js';
import { TicketTag } from '../src/modules/tickets/models/ticket-tag.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const REPORT_FROM = '2026-03-01';
const REPORT_TO = '2026-03-31';

const buildDate = (value) => new Date(`${value}T10:00:00.000Z`);

const signupAndVerify = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
}) => {
  const signup = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  const code = extractOtpCodeFromLogs(signup.logs);
  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code,
  });

  expect(verify.status).toBe(200);

  return {
    email,
    password,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
  };
};

const createInvite = async ({ workspaceId, accessToken, email, roleKey }) => {
  const invite = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return extractInviteTokenFromLogs(invite.logs);
};

const acceptInviteAndSwitchWorkspace = async ({
  inviteToken,
  email,
  password,
  workspaceId,
}) => {
  const accept = await request(app).post('/api/workspaces/invites/accept').send({
    token: inviteToken,
    email,
  });

  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email,
    password,
  });

  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId });

  expect(switched.status).toBe(200);

  return switched.body.accessToken;
};

const seedWorkspaceReportData = async ({ workspaceId, ownerEmail, agentEmail }) => {
  const workspace = await Workspace.findById(workspaceId)
    .select('_id defaultMailboxId')
    .lean();

  const owner = await User.findOne({ email: ownerEmail }).select('_id').lean();
  const agent = await User.findOne({ email: agentEmail }).select('_id').lean();

  const escalationMailbox = await Mailbox.create({
    workspaceId,
    name: 'Escalations',
    type: 'email',
    emailAddress: `escalations-${workspaceId}@example.com`,
  });

  const category = await TicketCategory.create({
    workspaceId,
    name: 'Bug',
    slug: `bug-${String(workspaceId).slice(-6)}`,
  });

  const tag = await TicketTag.create({
    workspaceId,
    name: 'VIP',
  });

  await Ticket.collection.insertMany([
    {
      _id: new mongoose.Types.ObjectId(),
      workspaceId: workspace._id,
      mailboxId: workspace.defaultMailboxId,
      number: 1,
      subject: 'Open ticket',
      subjectNormalized: 'open ticket',
      status: 'open',
      priority: 'high',
      channel: 'manual',
      categoryId: category._id,
      tagIds: [tag._id],
      contactId: new mongoose.Types.ObjectId(),
      assigneeId: agent._id,
      createdByUserId: owner._id,
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: buildDate('2026-03-01'),
      assignedAt: buildDate('2026-03-01'),
      closedAt: null,
      sla: {
        firstResponseTargetMinutes: 60,
        firstResponseDueAt: new Date('2099-03-01T11:00:00.000Z'),
        firstResponseAt: null,
        isFirstResponseBreached: false,
        resolutionTargetMinutes: 240,
        resolutionDueAt: new Date('2099-03-01T14:00:00.000Z'),
        resolvedAt: null,
        isResolutionBreached: false,
        resolutionRemainingBusinessMinutes: 240,
        isResolutionPaused: false,
      },
      deletedAt: null,
      createdAt: buildDate('2026-03-01'),
      updatedAt: buildDate('2026-03-01'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      workspaceId: workspace._id,
      mailboxId: escalationMailbox._id,
      number: 2,
      subject: 'Solved ticket',
      subjectNormalized: 'solved ticket',
      status: 'solved',
      priority: 'normal',
      channel: 'manual',
      categoryId: null,
      tagIds: [],
      contactId: new mongoose.Types.ObjectId(),
      assigneeId: owner._id,
      createdByUserId: owner._id,
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: buildDate('2026-03-03'),
      assignedAt: buildDate('2026-03-02'),
      closedAt: null,
      sla: {
        firstResponseTargetMinutes: 60,
        firstResponseDueAt: new Date('2026-03-02T12:00:00.000Z'),
        firstResponseAt: new Date('2026-03-02T11:30:00.000Z'),
        isFirstResponseBreached: false,
        resolutionTargetMinutes: 240,
        resolutionDueAt: new Date('2026-03-03T14:00:00.000Z'),
        resolvedAt: new Date('2026-03-03T13:00:00.000Z'),
        isResolutionBreached: false,
        resolutionRemainingBusinessMinutes: 0,
        isResolutionPaused: false,
      },
      deletedAt: null,
      createdAt: buildDate('2026-03-02'),
      updatedAt: buildDate('2026-03-03'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      workspaceId: workspace._id,
      mailboxId: escalationMailbox._id,
      number: 3,
      subject: 'Closed breached ticket',
      subjectNormalized: 'closed breached ticket',
      status: 'closed',
      priority: 'urgent',
      channel: 'manual',
      categoryId: null,
      tagIds: [tag._id],
      contactId: new mongoose.Types.ObjectId(),
      assigneeId: null,
      createdByUserId: owner._id,
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: buildDate('2026-03-05'),
      assignedAt: null,
      closedAt: buildDate('2026-03-05'),
      sla: {
        firstResponseTargetMinutes: 60,
        firstResponseDueAt: new Date('2026-03-03T11:00:00.000Z'),
        firstResponseAt: new Date('2026-03-03T12:30:00.000Z'),
        isFirstResponseBreached: true,
        resolutionTargetMinutes: 240,
        resolutionDueAt: new Date('2026-03-03T14:00:00.000Z'),
        resolvedAt: new Date('2026-03-04T16:00:00.000Z'),
        isResolutionBreached: true,
        resolutionRemainingBusinessMinutes: 0,
        isResolutionPaused: false,
      },
      deletedAt: null,
      createdAt: buildDate('2026-03-03'),
      updatedAt: buildDate('2026-03-05'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      workspaceId: workspace._id,
      mailboxId: workspace.defaultMailboxId,
      number: 4,
      subject: 'Waiting ticket',
      subjectNormalized: 'waiting ticket',
      status: 'waiting_on_customer',
      priority: 'low',
      channel: 'manual',
      categoryId: category._id,
      tagIds: [],
      contactId: new mongoose.Types.ObjectId(),
      assigneeId: agent._id,
      createdByUserId: owner._id,
      messageCount: 0,
      publicMessageCount: 0,
      internalNoteCount: 0,
      attachmentCount: 0,
      participantCount: 0,
      statusChangedAt: buildDate('2026-02-22'),
      assignedAt: buildDate('2026-02-20'),
      closedAt: null,
      sla: {},
      deletedAt: null,
      createdAt: buildDate('2026-02-20'),
      updatedAt: buildDate('2026-02-22'),
    },
  ]);

  return {
    mailboxId: String(escalationMailbox._id),
    categoryId: String(category._id),
    tagId: String(tag._id),
  };
};

const setupReportWorkspace = async () => {
  const owner = await signupAndVerify({
    email: `reports-owner-${Date.now()}@example.com`,
    name: 'Owner User',
  });
  const agent = await signupAndVerify({
    email: `reports-agent-${Date.now()}@example.com`,
    name: 'Agent User',
  });
  const viewer = await signupAndVerify({
    email: `reports-viewer-${Date.now()}@example.com`,
    name: 'Viewer User',
  });

  const agentInviteToken = await createInvite({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: agent.email,
    roleKey: WORKSPACE_ROLES.AGENT,
  });
  const viewerInviteToken = await createInvite({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: viewer.email,
    roleKey: WORKSPACE_ROLES.VIEWER,
  });

  const agentWorkspaceToken = await acceptInviteAndSwitchWorkspace({
    inviteToken: agentInviteToken,
    email: agent.email,
    password: agent.password,
    workspaceId: owner.workspaceId,
  });
  const viewerWorkspaceToken = await acceptInviteAndSwitchWorkspace({
    inviteToken: viewerInviteToken,
    email: viewer.email,
    password: viewer.password,
    workspaceId: owner.workspaceId,
  });

  const seeded = await seedWorkspaceReportData({
    workspaceId: owner.workspaceId,
    ownerEmail: owner.email,
    agentEmail: agent.email,
  });

  return {
    owner,
    agent,
    viewer,
    agentWorkspaceToken,
    viewerWorkspaceToken,
    seeded,
  };
};

describe('Reports module', () => {
  maybeDbTest('workspace reports require auth and validate filters', async () => {
    const owner = await signupAndVerify({
      email: `reports-guard-${Date.now()}@example.com`,
    });

    const unauthenticated = await request(app).get('/api/reports/overview');

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.messageKey).toBe('errors.auth.invalidToken');

    const invalidGroupBy = await request(app)
      .get('/api/reports/overview?groupBy=hour')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(invalidGroupBy.status).toBe(422);
    expect(invalidGroupBy.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'groupBy',
          messageKey: 'errors.validation.invalidEnum',
        }),
      ])
    );

    const invalidDateRange = await request(app)
      .get('/api/reports/tickets?from=2026-03-31&to=2026-03-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(invalidDateRange.status).toBe(422);
    expect(invalidDateRange.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'from',
          messageKey: 'errors.validation.invalidDateRange',
        }),
      ])
    );

    const invalidDate = await request(app)
      .get('/api/reports/tickets?from=not-a-date&to=2026-03-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(invalidDate.status).toBe(422);
    expect(invalidDate.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'from',
          messageKey: 'errors.validation.invalidDate',
        }),
      ])
    );

    const oversizedDateRange = await request(app)
      .get('/api/reports/overview?from=2024-01-01&to=2026-03-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(oversizedDateRange.status).toBe(422);
    expect(oversizedDateRange.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'from',
          messageKey: 'errors.validation.invalidDateRange',
        }),
      ])
    );

    const unknownFilter = await request(app)
      .get('/api/reports/sla?workspaceId=should-not-pass')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(unknownFilter.status).toBe(422);
    expect(unknownFilter.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'workspaceId',
          messageKey: 'errors.validation.unknownField',
        }),
      ])
    );
  });

  maybeDbTest('workspace reports stay scoped to the active workspace', async () => {
    const primary = await setupReportWorkspace();
    const secondaryOwner = await signupAndVerify({
      email: `reports-secondary-${Date.now()}@example.com`,
      name: 'Secondary Owner',
    });

    await seedWorkspaceReportData({
      workspaceId: secondaryOwner.workspaceId,
      ownerEmail: secondaryOwner.email,
      agentEmail: secondaryOwner.email,
    });

    const response = await request(app)
      .get(`/api/reports/overview?from=${REPORT_FROM}&to=${REPORT_TO}&groupBy=day`)
      .set('Authorization', `Bearer ${primary.owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.totalTicketsInRange).toBe(3);
    expect(response.body.breakdowns.mailbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Escalations', count: 2 }),
      ])
    );
    expect(response.body.breakdowns.mailbox).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: `Escalations`,
          count: 4,
        }),
      ])
    );
  });

  maybeDbTest('overview, tickets, and sla reports return grouped workspace analytics', async () => {
    const { owner, seeded } = await setupReportWorkspace();
    const query = `from=${REPORT_FROM}&to=${REPORT_TO}&groupBy=day`;

    const overviewResponse = await request(app)
      .get(`/api/reports/overview?${query}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.messageKey).toBe('success.ok');
    expect(overviewResponse.body.report).toBe('overview');
    expect(overviewResponse.body.summary).toEqual(
      expect.objectContaining({
        totalTicketsInRange: 3,
        backlogTickets: 2,
        solvedTicketsInRange: 2,
        closedTicketsInRange: 1,
      })
    );
    expect(overviewResponse.body.breakdowns.status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'open', count: 1 }),
        expect.objectContaining({ key: 'solved', count: 1 }),
        expect.objectContaining({ key: 'closed', count: 1 }),
      ])
    );
    expect(overviewResponse.body.breakdowns.mailbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Escalations', count: 2 }),
      ])
    );
    expect(overviewResponse.body.sla).toEqual(
      expect.objectContaining({
        applicableTickets: 3,
        breachedTickets: 1,
        firstResponseStatusCounts: expect.objectContaining({
          pending: 1,
          met: 1,
          breached: 1,
        }),
        resolutionStatusCounts: expect.objectContaining({
          running: 1,
          met: 1,
          breached: 1,
        }),
      })
    );
    expect(overviewResponse.body.usage).toEqual(
      expect.objectContaining({
        seatsUsed: 3,
        activeMailboxes: 2,
      })
    );

    const ticketsResponse = await request(app)
      .get(`/api/reports/tickets?${query}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(ticketsResponse.status).toBe(200);
    expect(ticketsResponse.body.report).toBe('tickets');
    expect(ticketsResponse.body.summary).toEqual(
      expect.objectContaining({
        createdTicketsInRange: 3,
        solvedTicketsInRange: 2,
        closedTicketsInRange: 1,
      })
    );
    expect(ticketsResponse.body.breakdowns.priority).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'high', count: 1 }),
        expect.objectContaining({ key: 'normal', count: 1 }),
        expect.objectContaining({ key: 'urgent', count: 1 }),
      ])
    );
    expect(ticketsResponse.body.breakdowns.category).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Bug', count: 1 }),
      ])
    );
    expect(ticketsResponse.body.breakdowns.tag).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'VIP', count: 2 }),
      ])
    );
    expect(ticketsResponse.body.breakdowns.assignee).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Agent User', count: 1 }),
        expect.objectContaining({ label: 'Owner User', count: 1 }),
      ])
    );

    const march1Bucket = ticketsResponse.body.series.volume.find(
      (bucket) => bucket.key === '2026-03-01'
    );
    const march3Bucket = ticketsResponse.body.series.volume.find(
      (bucket) => bucket.key === '2026-03-03'
    );
    const march5Bucket = ticketsResponse.body.series.volume.find(
      (bucket) => bucket.key === '2026-03-05'
    );

    expect(march1Bucket).toEqual(
      expect.objectContaining({
        created: 1,
      })
    );
    expect(march3Bucket).toEqual(
      expect.objectContaining({
        created: 1,
        solved: 1,
      })
    );
    expect(march5Bucket).toEqual(
      expect.objectContaining({
        closed: 1,
      })
    );

    const mailboxFilteredTickets = await request(app)
      .get(
        `/api/reports/tickets?${query}&mailboxId=${seeded.mailboxId}`
      )
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(mailboxFilteredTickets.status).toBe(200);
    expect(mailboxFilteredTickets.body.summary.createdTicketsInRange).toBe(2);
    expect(mailboxFilteredTickets.body.breakdowns.mailbox).toEqual([
      expect.objectContaining({ label: 'Escalations', count: 2 }),
    ]);

    const slaResponse = await request(app)
      .get(`/api/reports/sla?${query}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(slaResponse.status).toBe(200);
    expect(slaResponse.body.report).toBe('sla');
    expect(slaResponse.body.overview).toEqual(
      expect.objectContaining({
        applicableTickets: 3,
        breachedTickets: 1,
        nonBreachedTickets: 2,
        complianceRate: 66.67,
        firstResponseStatusCounts: expect.objectContaining({
          pending: 1,
          met: 1,
          breached: 1,
        }),
        resolutionStatusCounts: expect.objectContaining({
          running: 1,
          met: 1,
          breached: 1,
        }),
      })
    );
    expect(slaResponse.body.breakdowns.byPriority).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'high', breachedTickets: 0 }),
        expect.objectContaining({ key: 'normal', breachedTickets: 0 }),
        expect.objectContaining({ key: 'urgent', breachedTickets: 1 }),
      ])
    );
    expect(slaResponse.body.breakdowns.byMailbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Escalations', breachedTickets: 1 }),
      ])
    );
  });

  maybeDbTest('team report enforces owner admin access and returns assignee workload', async () => {
    const { owner, viewerWorkspaceToken } = await setupReportWorkspace();
    const query = `from=${REPORT_FROM}&to=${REPORT_TO}&groupBy=day`;

    const viewerForbidden = await request(app)
      .get(`/api/reports/team?${query}`)
      .set('Authorization', `Bearer ${viewerWorkspaceToken}`);

    expect(viewerForbidden.status).toBe(403);
    expect(viewerForbidden.body.messageKey).toBe('errors.auth.forbiddenRole');

    const ownerResponse = await request(app)
      .get(`/api/reports/team?${query}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.messageKey).toBe('success.ok');
    expect(ownerResponse.body.report).toBe('team');
    expect(ownerResponse.body.visibility).toBe('owner_admin');
    expect(ownerResponse.body.summary).toEqual(
      expect.objectContaining({
        assigneeCount: 2,
        totalAssignedTicketsInRange: 2,
        assignedActiveLoad: 1,
        unassignedActiveLoad: 0,
        currentAssignedActiveLoad: 2,
        currentUnassignedActiveLoad: 0,
        solvedTicketsInRange: 1,
        closedTicketsInRange: 0,
      })
    );
    expect(ownerResponse.body.workload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignee: expect.objectContaining({ label: 'Agent User' }),
          totalAssignedTickets: 1,
          activeAssignedLoad: 1,
          currentActiveAssignedLoad: 2,
          solvedTicketsInRange: 0,
          statusCounts: expect.objectContaining({
            open: 1,
            pending: 0,
            waitingOnCustomer: 0,
          }),
          currentStatusCounts: expect.objectContaining({
            open: 1,
            pending: 0,
            waitingOnCustomer: 1,
          }),
        }),
        expect.objectContaining({
          assignee: expect.objectContaining({ label: 'Owner User' }),
          totalAssignedTickets: 1,
          activeAssignedLoad: 0,
          currentActiveAssignedLoad: 0,
          solvedTicketsInRange: 1,
        }),
      ])
    );
  });
});
