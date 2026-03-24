import request from 'supertest';
import app from '../src/app.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_PRIORITY } from '../src/constants/ticket-priority.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { addBusinessMinutes } from '../src/modules/sla/utils/business-time.helpers.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

let sequence = 0;

const nextValue = (prefix) => {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
};

const nextEmail = (prefix) => `${nextValue(prefix)}@example.com`;

const alwaysOpenWeeklySchedule = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isOpen: true,
  windows: [{ start: '00:00', end: '23:59' }],
}));

const defaultRulesByPriority = {
  low: {
    firstResponseMinutes: 120,
    resolutionMinutes: 480,
  },
  normal: {
    firstResponseMinutes: 60,
    resolutionMinutes: 240,
  },
  high: {
    firstResponseMinutes: 30,
    resolutionMinutes: 180,
  },
  urgent: {
    firstResponseMinutes: 15,
    resolutionMinutes: 60,
  },
};

const overrideRulesByPriority = {
  low: {
    firstResponseMinutes: 90,
    resolutionMinutes: 300,
  },
  normal: {
    firstResponseMinutes: 45,
    resolutionMinutes: 150,
  },
  high: {
    firstResponseMinutes: 20,
    resolutionMinutes: 90,
  },
  urgent: {
    firstResponseMinutes: 5,
    resolutionMinutes: 45,
  },
};

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
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
  email = nextEmail('ticket-sla-owner'),
  password = 'Password123!',
  name = 'Test User',
} = {}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code,
  });
  expect(verify.status).toBe(200);

  return {
    email,
    password,
    userId: verify.body.user._id,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
  };
};

const createInviteWithToken = async ({
  workspaceId,
  accessToken,
  email,
  roleKey,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return {
    response,
    token: extractInviteTokenFromLogs(logs),
  };
};

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey }) => {
  const member = await createVerifiedUser({
    email: nextEmail(`ticket-sla-${roleKey}`),
  });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey,
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app)
    .post('/api/workspaces/invites/accept')
    .send({
      token: invite.token,
      email: member.email,
    });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.email,
    password: member.password,
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });

  expect(switched.status).toBe(200);

  return {
    accessToken: switched.body.accessToken,
    userId: member.userId,
  };
};

const createContactRecord = async ({
  workspaceId,
  fullName = nextValue('SLA Contact'),
}) =>
  Contact.create({
    workspaceId,
    fullName,
    email: nextEmail('ticket-sla-contact'),
    phone: '+963955555555',
  });

const createBusinessHours = async ({
  accessToken,
  name = nextValue('SLA Hours'),
  timezone = 'UTC',
  weeklySchedule = alwaysOpenWeeklySchedule,
}) =>
  request(app)
    .post('/api/sla/business-hours')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      timezone,
      weeklySchedule,
    });

const createSlaPolicy = async ({
  accessToken,
  businessHoursId,
  name = nextValue('SLA Policy'),
  rulesByPriority = defaultRulesByPriority,
}) =>
  request(app)
    .post('/api/sla/policies')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      businessHoursId,
      rulesByPriority,
    });

const setDefaultSlaPolicy = async ({ accessToken, policyId }) =>
  request(app)
    .post(`/api/sla/policies/${policyId}/set-default`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({});

const createMailbox = async ({
  accessToken,
  name,
  emailAddress,
  slaPolicyId,
}) =>
  request(app)
    .post('/api/mailboxes')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      emailAddress,
      ...(slaPolicyId ? { slaPolicyId } : {}),
    });

const createTicketRequest = async ({ accessToken, body }) =>
  request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const createTicketMessageRequest = async ({ accessToken, ticketId, body }) =>
  request(app)
    .post(`/api/tickets/${ticketId}/messages`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const setupWorkspaceSla = async ({
  accessToken,
  rulesByPriority = defaultRulesByPriority,
}) => {
  const businessHours = await createBusinessHours({ accessToken });
  expect(businessHours.status).toBe(200);

  const policy = await createSlaPolicy({
    accessToken,
    businessHoursId: businessHours.body.businessHours._id,
    rulesByPriority,
  });
  expect(policy.status).toBe(200);

  return {
    businessHours,
    policy,
  };
};

describe('Ticket SLA runtime behavior', () => {
  maybeDbTest(
    'ticket creation snapshots mailbox override or workspace default SLA while no-SLA create stays backward compatible',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const defaultSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
      });
      const setDefault = await setDefaultSlaPolicy({
        accessToken: owner.accessToken,
        policyId: defaultSla.policy.body.policy._id,
      });
      expect(setDefault.status).toBe(200);

      const workspaceDefaultTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Workspace default SLA ticket',
          contactId: String(contact._id),
          priority: TICKET_PRIORITY.HIGH,
        },
      });

      expect(workspaceDefaultTicket.status).toBe(200);
      expect(workspaceDefaultTicket.body.ticket.sla.policySource).toBe(
        'workspace_default'
      );
      expect(workspaceDefaultTicket.body.ticket.sla.policyName).toBe(
        defaultSla.policy.body.policy.name
      );
      expect(workspaceDefaultTicket.body.ticket.sla.businessHoursName).toBe(
        defaultSla.businessHours.body.businessHours.name
      );
      expect(
        workspaceDefaultTicket.body.ticket.sla.firstResponseTargetMinutes
      ).toBe(30);
      expect(
        workspaceDefaultTicket.body.ticket.sla.resolutionTargetMinutes
      ).toBe(180);
      expect(workspaceDefaultTicket.body.ticket.sla.firstResponseStatus).toBe(
        'pending'
      );
      expect(workspaceDefaultTicket.body.ticket.sla.resolutionStatus).toBe(
        'running'
      );

      const expectedDefaultDueAt = addBusinessMinutes({
        startAt: new Date(workspaceDefaultTicket.body.ticket.createdAt),
        minutes: 30,
        businessHours: {
          timezone: 'UTC',
          weeklySchedule: alwaysOpenWeeklySchedule,
        },
      });
      expect(workspaceDefaultTicket.body.ticket.sla.firstResponseDueAt).toBe(
        expectedDefaultDueAt.toISOString()
      );

      const overrideSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
        rulesByPriority: overrideRulesByPriority,
      });
      const overrideMailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: nextValue('Override Queue'),
        emailAddress: `${nextValue('override')}@example.com`,
        slaPolicyId: overrideSla.policy.body.policy._id,
      });
      expect(overrideMailbox.status).toBe(200);

      const mailboxOverrideTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Mailbox override SLA ticket',
          mailboxId: overrideMailbox.body.mailbox._id,
          contactId: String(contact._id),
          priority: TICKET_PRIORITY.URGENT,
        },
      });

      expect(mailboxOverrideTicket.status).toBe(200);
      expect(mailboxOverrideTicket.body.ticket.sla.policySource).toBe(
        'mailbox'
      );
      expect(mailboxOverrideTicket.body.ticket.sla.policyName).toBe(
        overrideSla.policy.body.policy.name
      );
      expect(mailboxOverrideTicket.body.ticket.sla.businessHoursName).toBe(
        overrideSla.businessHours.body.businessHours.name
      );
      expect(
        mailboxOverrideTicket.body.ticket.sla.firstResponseTargetMinutes
      ).toBe(5);
      expect(
        mailboxOverrideTicket.body.ticket.sla.resolutionTargetMinutes
      ).toBe(45);

      const ownerWithoutSla = await createVerifiedUser();
      const noSlaContact = await createContactRecord({
        workspaceId: ownerWithoutSla.workspaceId,
      });
      const noSlaTicket = await createTicketRequest({
        accessToken: ownerWithoutSla.accessToken,
        body: {
          subject: 'No SLA still works',
          contactId: String(noSlaContact._id),
        },
      });

      expect(noSlaTicket.status).toBe(200);
      expect(noSlaTicket.body.ticket.sla.isApplicable).toBe(false);
      expect(noSlaTicket.body.ticket.sla.firstResponseStatus).toBe(
        'not_applicable'
      );
      expect(noSlaTicket.body.ticket.sla.resolutionStatus).toBe(
        'not_applicable'
      );
    }
  );

  maybeDbTest(
    'message flow satisfies first response, pauses and resumes resolution, and late public replies breach correctly',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const defaultSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
      });
      await setDefaultSlaPolicy({
        accessToken: owner.accessToken,
        policyId: defaultSla.policy.body.policy._id,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Message SLA behavior',
          contactId: String(contact._id),
        },
      });
      expect(created.status).toBe(200);

      const internalNote = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'Internal-only note',
        },
      });
      expect(internalNote.status).toBe(200);

      const detailAfterInternal = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(detailAfterInternal.status).toBe(200);
      expect(detailAfterInternal.body.ticket.sla.firstResponseAt).toBeNull();
      expect(detailAfterInternal.body.ticket.sla.firstResponseStatus).toBe(
        'pending'
      );

      const publicReply = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'First public reply',
        },
      });

      expect(publicReply.status).toBe(200);
      expect(publicReply.body.ticketSummary.status).toBe(
        TICKET_STATUS.WAITING_ON_CUSTOMER
      );
      expect(publicReply.body.ticketSummary.sla.policyName).toBe(
        defaultSla.policy.body.policy.name
      );
      expect(publicReply.body.ticketSummary.sla.businessHoursName).toBe(
        defaultSla.businessHours.body.businessHours.name
      );
      expect(publicReply.body.ticketSummary.sla.firstResponseAt).toBeTruthy();
      expect(publicReply.body.ticketSummary.sla.firstResponseStatus).toBe(
        'met'
      );
      expect(publicReply.body.ticketSummary.sla.resolutionStatus).toBe(
        'paused'
      );

      const detailAfterPublicReply = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(detailAfterPublicReply.status).toBe(200);
      expect(detailAfterPublicReply.body.ticket.sla.policyName).toBe(
        defaultSla.policy.body.policy.name
      );
      expect(detailAfterPublicReply.body.ticket.sla.businessHoursName).toBe(
        defaultSla.businessHours.body.businessHours.name
      );
      expect(detailAfterPublicReply.body.ticket.sla.isResolutionPaused).toBe(
        true
      );
      expect(detailAfterPublicReply.body.ticket.sla.resolutionDueAt).toBeNull();

      const customerMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: 'Customer resumed work',
        },
      });

      expect(customerMessage.status).toBe(200);
      expect(customerMessage.body.ticketSummary.status).toBe(
        TICKET_STATUS.OPEN
      );
      expect(customerMessage.body.ticketSummary.sla.resolutionStatus).toBe(
        'running'
      );
      expect(
        customerMessage.body.ticketSummary.sla.resolutionDueAt
      ).toBeTruthy();

      const lateReplyTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Late first response ticket',
          contactId: String(contact._id),
        },
      });
      expect(lateReplyTicket.status).toBe(200);

      await Ticket.updateOne(
        {
          _id: lateReplyTicket.body.ticket._id,
          workspaceId: owner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            'sla.firstResponseDueAt': new Date(Date.now() - 60 * 1000),
          },
        }
      );

      const latePublicReply = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: lateReplyTicket.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'Late reply',
        },
      });

      expect(latePublicReply.status).toBe(200);
      expect(
        latePublicReply.body.ticketSummary.sla.isFirstResponseBreached
      ).toBe(true);
      expect(latePublicReply.body.ticketSummary.sla.firstResponseStatus).toBe(
        'breached'
      );
    }
  );

  maybeDbTest(
    'ticket patch recalculates the SLA snapshot when priority or mailbox changes before any messages exist',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const defaultSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
      });
      await setDefaultSlaPolicy({
        accessToken: owner.accessToken,
        policyId: defaultSla.policy.body.policy._id,
      });

      const overrideSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
        rulesByPriority: overrideRulesByPriority,
      });
      const overrideMailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: nextValue('Patch Override Queue'),
        emailAddress: `${nextValue('patch-override')}@example.com`,
        slaPolicyId: overrideSla.policy.body.policy._id,
      });
      expect(overrideMailbox.status).toBe(200);

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Patch SLA snapshot ticket',
          contactId: String(contact._id),
          priority: TICKET_PRIORITY.LOW,
        },
      });
      expect(created.status).toBe(200);
      expect(created.body.ticket.messageCount).toBe(0);
      expect(created.body.ticket.sla.policySource).toBe('workspace_default');
      expect(created.body.ticket.sla.firstResponseTargetMinutes).toBe(120);
      expect(created.body.ticket.sla.resolutionTargetMinutes).toBe(480);

      const updatePriority = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          priority: TICKET_PRIORITY.URGENT,
        });

      expect(updatePriority.status).toBe(200);
      expect(updatePriority.body.ticket.priority).toBe(TICKET_PRIORITY.URGENT);
      expect(updatePriority.body.ticket.sla.policySource).toBe(
        'workspace_default'
      );
      expect(updatePriority.body.ticket.sla.policyName).toBe(
        defaultSla.policy.body.policy.name
      );
      expect(updatePriority.body.ticket.sla.firstResponseTargetMinutes).toBe(
        15
      );
      expect(updatePriority.body.ticket.sla.resolutionTargetMinutes).toBe(60);

      const updateMailbox = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          mailboxId: overrideMailbox.body.mailbox._id,
        });

      expect(updateMailbox.status).toBe(200);
      expect(updateMailbox.body.ticket.mailboxId).toBe(
        overrideMailbox.body.mailbox._id
      );
      expect(updateMailbox.body.ticket.conversation.mailboxId).toBe(
        overrideMailbox.body.mailbox._id
      );
      expect(updateMailbox.body.ticket.sla.policySource).toBe('mailbox');
      expect(updateMailbox.body.ticket.sla.policyId).toBe(
        overrideSla.policy.body.policy._id
      );
      expect(updateMailbox.body.ticket.sla.policyName).toBe(
        overrideSla.policy.body.policy.name
      );
      expect(updateMailbox.body.ticket.sla.businessHoursName).toBe(
        overrideSla.businessHours.body.businessHours.name
      );
      expect(updateMailbox.body.ticket.sla.firstResponseTargetMinutes).toBe(5);
      expect(updateMailbox.body.ticket.sla.resolutionTargetMinutes).toBe(45);

      const storedTicket = await Ticket.findById(created.body.ticket._id).lean();
      expect(String(storedTicket.mailboxId)).toBe(
        overrideMailbox.body.mailbox._id
      );
      expect(String(storedTicket.sla.policyId)).toBe(
        overrideSla.policy.body.policy._id
      );
      expect(storedTicket.sla.policyName).toBe(
        overrideSla.policy.body.policy.name
      );
      expect(storedTicket.sla.firstResponseTargetMinutes).toBe(5);
      expect(storedTicket.sla.resolutionTargetMinutes).toBe(45);
    }
  );

  maybeDbTest(
    'lifecycle actions keep solve as the SLA success point, pause waiting_on_customer, keep pending active, and reopen from remaining time',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const defaultSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
      });
      await setDefaultSlaPolicy({
        accessToken: owner.accessToken,
        policyId: defaultSla.policy.body.policy._id,
      });

      const statusTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Status-driven SLA behavior',
          contactId: String(contact._id),
        },
      });
      expect(statusTicket.status).toBe(200);

      const waiting = await request(app)
        .post(`/api/tickets/${statusTicket.body.ticket._id}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status: TICKET_STATUS.WAITING_ON_CUSTOMER });
      expect(waiting.status).toBe(200);
      expect(waiting.body.ticket.sla.policyName).toBe(
        defaultSla.policy.body.policy.name
      );
      expect(waiting.body.ticket.sla.businessHoursName).toBe(
        defaultSla.businessHours.body.businessHours.name
      );
      expect(waiting.body.ticket.sla.resolutionStatus).toBe('paused');
      expect(waiting.body.ticket.sla.isResolutionPaused).toBe(true);

      const pending = await request(app)
        .post(`/api/tickets/${statusTicket.body.ticket._id}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status: TICKET_STATUS.PENDING });
      expect(pending.status).toBe(200);
      expect(pending.body.ticket.sla.resolutionStatus).toBe('running');
      expect(pending.body.ticket.sla.isResolutionPaused).toBe(false);

      const lateSolveTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Late solve ticket',
          contactId: String(contact._id),
        },
      });
      expect(lateSolveTicket.status).toBe(200);

      await Ticket.updateOne(
        {
          _id: lateSolveTicket.body.ticket._id,
          workspaceId: owner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            'sla.resolutionDueAt': new Date(Date.now() - 60 * 1000),
          },
        }
      );

      const solvedLate = await request(app)
        .post(`/api/tickets/${lateSolveTicket.body.ticket._id}/solve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(solvedLate.status).toBe(200);
      expect(solvedLate.body.ticket.status).toBe(TICKET_STATUS.SOLVED);
      expect(solvedLate.body.ticket.sla.resolvedAt).toBeTruthy();
      expect(solvedLate.body.ticket.sla.isResolutionBreached).toBe(true);
      expect(solvedLate.body.ticket.sla.resolutionStatus).toBe('breached');

      const closedLate = await request(app)
        .post(`/api/tickets/${lateSolveTicket.body.ticket._id}/close`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(closedLate.status).toBe(200);
      expect(closedLate.body.ticket.status).toBe(TICKET_STATUS.CLOSED);
      expect(closedLate.body.ticket.sla.resolvedAt).toBeTruthy();
      expect(closedLate.body.ticket.sla.resolutionStatus).toBe('breached');

      const reopenTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Reopen keeps remaining business time',
          contactId: String(contact._id),
        },
      });
      expect(reopenTicket.status).toBe(200);

      await Ticket.updateOne(
        {
          _id: reopenTicket.body.ticket._id,
          workspaceId: owner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            status: TICKET_STATUS.SOLVED,
            'sla.resolvedAt': new Date(),
            'sla.resolutionConsumedBusinessMinutes': 210,
            'sla.resolutionRemainingBusinessMinutes': 30,
            'sla.resolutionRemainingMinutes': 30,
            'sla.isResolutionPaused': false,
            'sla.resolutionPausedAt': null,
            'sla.resolutionRunningSince': null,
          },
        }
      );

      const reopened = await request(app)
        .post(`/api/tickets/${reopenTicket.body.ticket._id}/reopen`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(reopened.status).toBe(200);
      expect(reopened.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(reopened.body.ticket.sla.resolvedAt).toBeNull();

      const reopenDetail = await request(app)
        .get(`/api/tickets/${reopenTicket.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(reopenDetail.status).toBe(200);
      expect(reopenDetail.body.ticket.sla.reopenCount).toBe(1);
      expect(
        reopenDetail.body.ticket.sla.resolutionRemainingBusinessMinutes
      ).toBe(30);
      expect(reopenDetail.body.ticket.sla.resolutionStatus).toBe('running');
      expect(reopenDetail.body.ticket.sla.resolutionDueAt).toBeTruthy();
    }
  );

  maybeDbTest(
    'detail/list derive breached SLA state without hidden writes and summary stays workspace-scoped and readable by viewers',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const otherOwner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const otherContact = await createContactRecord({
        workspaceId: otherOwner.workspaceId,
      });

      const ownerSla = await setupWorkspaceSla({
        accessToken: owner.accessToken,
      });
      await setDefaultSlaPolicy({
        accessToken: owner.accessToken,
        policyId: ownerSla.policy.body.policy._id,
      });

      const otherOwnerSla = await setupWorkspaceSla({
        accessToken: otherOwner.accessToken,
      });
      await setDefaultSlaPolicy({
        accessToken: otherOwner.accessToken,
        policyId: otherOwnerSla.policy.body.policy._id,
      });

      const overdueTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Overdue unresolved ticket',
          contactId: String(contact._id),
        },
      });
      expect(overdueTicket.status).toBe(200);

      await Ticket.updateOne(
        {
          _id: overdueTicket.body.ticket._id,
          workspaceId: owner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            'sla.firstResponseDueAt': new Date(Date.now() - 5 * 60 * 1000),
            'sla.resolutionDueAt': new Date(Date.now() - 5 * 60 * 1000),
            'sla.isFirstResponseBreached': false,
            'sla.isResolutionBreached': false,
          },
        }
      );

      const pausedTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Paused ticket for summary',
          contactId: String(contact._id),
        },
      });
      expect(pausedTicket.status).toBe(200);

      const pausedReply = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: pausedTicket.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'Agent paused the clock',
        },
      });
      expect(pausedReply.status).toBe(200);

      const otherWorkspaceOverdue = await createTicketRequest({
        accessToken: otherOwner.accessToken,
        body: {
          subject: 'Other workspace overdue ticket',
          contactId: String(otherContact._id),
        },
      });
      expect(otherWorkspaceOverdue.status).toBe(200);

      await Ticket.updateOne(
        {
          _id: otherWorkspaceOverdue.body.ticket._id,
          workspaceId: otherOwner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            'sla.resolutionDueAt': new Date(Date.now() - 5 * 60 * 1000),
          },
        }
      );

      const detail = await request(app)
        .get(`/api/tickets/${overdueTicket.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.ticket.sla.firstResponseStatus).toBe('breached');
      expect(detail.body.ticket.sla.resolutionStatus).toBe('breached');
      expect(detail.body.ticket.sla.isBreached).toBe(true);

      const list = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(list.status).toBe(200);
      expect(
        list.body.tickets.find(
          (ticket) => ticket._id === overdueTicket.body.ticket._id
        ).sla.policyName
      ).toBe(ownerSla.policy.body.policy.name);
      expect(
        list.body.tickets.find(
          (ticket) => ticket._id === overdueTicket.body.ticket._id
        ).sla.firstResponseStatus
      ).toBe('breached');
      expect(
        list.body.tickets.find(
          (ticket) => ticket._id === overdueTicket.body.ticket._id
        ).sla.resolutionStatus
      ).toBe('breached');
      expect(
        list.body.tickets.find(
          (ticket) => ticket._id === pausedTicket.body.ticket._id
        ).sla.resolutionStatus
      ).toBe('paused');

      const rawTicketAfterReads = await Ticket.findById(
        overdueTicket.body.ticket._id
      ).lean();
      expect(rawTicketAfterReads.sla.isFirstResponseBreached).toBe(false);
      expect(rawTicketAfterReads.sla.isResolutionBreached).toBe(false);

      const summaryAsViewer = await request(app)
        .get('/api/sla/summary')
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(summaryAsViewer.status).toBe(200);
      expect(
        summaryAsViewer.body.summary.runtime.ticketLifecycleIntegrated
      ).toBe(true);
      expect(summaryAsViewer.body.summary.runtime.breachedTicketCount).toBe(1);
      expect(summaryAsViewer.body.summary.runtime.firstResponse.breached).toBe(
        1
      );
      expect(summaryAsViewer.body.summary.runtime.resolution.breached).toBe(1);
      expect(summaryAsViewer.body.summary.runtime.resolution.paused).toBe(1);
    }
  );
});
