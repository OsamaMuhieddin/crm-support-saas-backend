import request from 'supertest';
import app from '../src/app.js';
import { t } from '../src/i18n/index.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_PARTICIPANT_TYPE } from '../src/constants/ticket-participant-type.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { selfAssignTicket } from '../src/modules/tickets/services/tickets.service.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

let sequence = 0;

const nextValue = (prefix) => {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
};

const nextEmail = (prefix) => `${nextValue(prefix)}@example.com`;

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
  email = nextEmail('ticket-ops-owner'),
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
    email: nextEmail(`ticket-ops-${roleKey}`),
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
  expect(switched.body.accessToken).toBeTruthy();

  return {
    accessToken: switched.body.accessToken,
    email: member.email,
    userId: member.userId,
  };
};

const createContactRecord = async ({
  workspaceId,
  fullName = nextValue('Ops Contact'),
}) =>
  Contact.create({
    workspaceId,
    fullName,
    email: nextEmail('ops-contact'),
    phone: '+963955555555',
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

const expectValidationError = (response, field, messageKey) => {
  expect(response.status).toBe(422);
  expect(response.body.messageKey).toBe('errors.validation.failed');
  expect(response.body.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field,
        messageKey,
      }),
    ])
  );
};

describe('Ticket assignment, lifecycle, and participants endpoints', () => {
  maybeDbTest(
    'selfAssignTicket validates the current user as an operational assignee',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Self assign integrity',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      await expect(
        selfAssignTicket({
          workspaceId: owner.workspaceId,
          ticketId: created.body.ticket._id,
          currentUserId: viewer.userId,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.ticket.assigneeNotFound',
      });
    }
  );

  maybeDbTest(
    'supports owner/admin assignment, self-assign, unassign, and create-time assignee open state',
    async () => {
      const owner = await createVerifiedUser();
      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Assignment controls',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);
      expect(created.body.ticket.status).toBe(TICKET_STATUS.NEW);
      expect(created.body.ticket.assigneeId).toBeNull();

      const ownerAssign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: agent.userId });

      expect(ownerAssign.status).toBe(200);
      expect(ownerAssign.body.messageKey).toBe('success.ticket.assigned');
      expect(ownerAssign.body.ticket.assigneeId).toBe(agent.userId);
      expect(ownerAssign.body.ticket.assignedAt).toBeTruthy();
      expect(ownerAssign.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(ownerAssign.body.ticket).not.toHaveProperty('contact');

      const adminUnassign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/unassign`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({});

      expect(adminUnassign.status).toBe(200);
      expect(adminUnassign.body.messageKey).toBe('success.ticket.unassigned');
      expect(adminUnassign.body.ticket.assigneeId).toBeNull();
      expect(adminUnassign.body.ticket.assignedAt).toBeNull();
      expect(adminUnassign.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(adminUnassign.body.ticket).not.toHaveProperty('mailbox');

      const agentSelfAssign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({});

      expect(agentSelfAssign.status).toBe(200);
      expect(agentSelfAssign.body.messageKey).toBe(
        'success.ticket.selfAssigned'
      );
      expect(agentSelfAssign.body.ticket.assigneeId).toBe(agent.userId);
      expect(agentSelfAssign.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(agentSelfAssign.body.ticket).not.toHaveProperty('conversation');

      const agentSelfAssignAgain = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({});

      expect(agentSelfAssignAgain.status).toBe(200);
      expect(agentSelfAssignAgain.body.ticket.assigneeId).toBe(agent.userId);

      const agentUnassign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/unassign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({});

      expect(agentUnassign.status).toBe(200);
      expect(agentUnassign.body.ticket.assigneeId).toBeNull();
      expect(agentUnassign.body.ticket.assignedAt).toBeNull();

      const secondTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Admin assignment path',
          contactId: String(contact._id),
        },
      });
      expect(secondTicket.status).toBe(200);

      const adminAssign = await request(app)
        .post(`/api/tickets/${secondTicket.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ assigneeId: agent.userId });

      expect(adminAssign.status).toBe(200);
      expect(adminAssign.body.ticket.assigneeId).toBe(agent.userId);
      expect(adminAssign.body.ticket.status).toBe(TICKET_STATUS.OPEN);

      const createdWithAssignee = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Create with assignee',
          contactId: String(contact._id),
          assigneeId: admin.userId,
        },
      });

      expect(createdWithAssignee.status).toBe(200);
      expect(createdWithAssignee.body.ticket.assigneeId).toBe(admin.userId);
      expect(createdWithAssignee.body.ticket.assignedAt).toBeTruthy();
      expect(createdWithAssignee.body.ticket.status).toBe(TICKET_STATUS.OPEN);
    }
  );

  maybeDbTest(
    'supports explicit lifecycle actions, resolved markers, and reopen-driven message behavior',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Lifecycle controls',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const reopenFromNew = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/reopen`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(reopenFromNew.status).toBe(409);
      expect(reopenFromNew.body.messageKey).toBe(
        'errors.ticket.reopenNotAllowed'
      );
      expect(reopenFromNew.body.message).toBe(
        t('errors.ticket.reopenNotAllowed', 'en', {
          from: { key: 'ticketStatus.new' },
          allowedFromOne: { key: 'ticketStatus.solved' },
          allowedFromTwo: { key: 'ticketStatus.closed' },
        })
      );

      const pending = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status: TICKET_STATUS.PENDING });

      expect(pending.status).toBe(200);
      expect(pending.body.messageKey).toBe('success.ticket.statusUpdated');
      expect(pending.body.ticket.status).toBe(TICKET_STATUS.PENDING);
      expect(pending.body.ticket.statusChangedAt).toBeTruthy();
      expect(pending.body.ticket).not.toHaveProperty('mailbox');

      const waiting = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status: TICKET_STATUS.WAITING_ON_CUSTOMER });

      expect(waiting.status).toBe(200);
      expect(waiting.body.ticket.status).toBe(
        TICKET_STATUS.WAITING_ON_CUSTOMER
      );

      const solved = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/solve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(solved.status).toBe(200);
      expect(solved.body.messageKey).toBe('success.ticket.solved');
      expect(solved.body.ticket.status).toBe(TICKET_STATUS.SOLVED);
      expect(solved.body.ticket.sla.resolvedAt).toBeTruthy();

      const reopenFromSolved = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/reopen`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(reopenFromSolved.status).toBe(200);
      expect(reopenFromSolved.body.messageKey).toBe('success.ticket.reopened');
      expect(reopenFromSolved.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(reopenFromSolved.body.ticket.sla.resolvedAt).toBeNull();

      const solvedAgain = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/solve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(solvedAgain.status).toBe(200);
      expect(solvedAgain.body.ticket.status).toBe(TICKET_STATUS.SOLVED);
      expect(solvedAgain.body.ticket.sla.resolvedAt).toBeTruthy();

      const closed = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/close`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(closed.status).toBe(200);
      expect(closed.body.messageKey).toBe('success.ticket.closed');
      expect(closed.body.ticket.status).toBe(TICKET_STATUS.CLOSED);
      expect(closed.body.ticket.closedAt).toBeTruthy();
      expect(closed.body.ticket.sla.resolvedAt).toBeTruthy();

      const solveWhileClosed = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/solve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(solveWhileClosed.status).toBe(409);
      expect(solveWhileClosed.body.messageKey).toBe(
        'errors.ticket.solveNotAllowed'
      );
      expect(solveWhileClosed.body.message).toBe(
        t('errors.ticket.solveNotAllowed', 'en', {
          from: { key: 'ticketStatus.closed' },
        })
      );

      const blockedWhileClosed = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'Cannot reply while closed',
        },
      });

      expect(blockedWhileClosed.status).toBe(409);
      expect(blockedWhileClosed.body.messageKey).toBe(
        'errors.ticket.closedMessageNotAllowed'
      );
      expect(blockedWhileClosed.body.message).toBe(
        t('errors.ticket.closedMessageNotAllowed', 'en', {
          status: { key: 'ticketStatus.closed' },
          type: { key: 'ticketMessageType.public_reply' },
          allowedType: { key: 'ticketMessageType.internal_note' },
        })
      );

      const reopenFromClosed = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/reopen`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(reopenFromClosed.status).toBe(200);
      expect(reopenFromClosed.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(reopenFromClosed.body.ticket.closedAt).toBeNull();
      expect(reopenFromClosed.body.ticket.sla.resolvedAt).toBeNull();

      const publicReplyAfterReopen = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'Allowed again after reopen',
        },
      });

      expect(publicReplyAfterReopen.status).toBe(200);
      expect(publicReplyAfterReopen.body.ticketSummary.status).toBe(
        TICKET_STATUS.WAITING_ON_CUSTOMER
      );
    }
  );

  maybeDbTest(
    'supports participant list, add, upsert, remove, and participant counts',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Participant metadata',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const initialList = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(initialList.status).toBe(200);
      expect(initialList.body.participants).toEqual([]);

      const addViewer = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          userId: viewer.userId,
          type: TICKET_PARTICIPANT_TYPE.WATCHER,
        });

      expect(addViewer.status).toBe(200);
      expect(addViewer.body.messageKey).toBe('success.ticket.participantSaved');
      expect(addViewer.body.participant.userId).toBe(viewer.userId);
      expect(addViewer.body.participant.type).toBe(
        TICKET_PARTICIPANT_TYPE.WATCHER
      );
      expect(addViewer.body.participant.user.roleKey).toBe(
        WORKSPACE_ROLES.VIEWER
      );
      expect(addViewer.body.ticketSummary.participantCount).toBe(1);

      const upsertViewer = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          userId: viewer.userId,
          type: TICKET_PARTICIPANT_TYPE.COLLABORATOR,
        });

      expect(upsertViewer.status).toBe(200);
      expect(upsertViewer.body.participant.type).toBe(
        TICKET_PARTICIPANT_TYPE.COLLABORATOR
      );
      expect(upsertViewer.body.ticketSummary.participantCount).toBe(1);

      const listAfterUpsert = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(listAfterUpsert.status).toBe(200);
      expect(listAfterUpsert.body.participants).toHaveLength(1);
      expect(listAfterUpsert.body.participants[0]).toEqual(
        expect.objectContaining({
          userId: viewer.userId,
          type: TICKET_PARTICIPANT_TYPE.COLLABORATOR,
        })
      );
      expect(listAfterUpsert.body.participants[0]).not.toHaveProperty(
        'workspaceId'
      );
      expect(listAfterUpsert.body.participants[0]).not.toHaveProperty(
        'ticketId'
      );

      const removeViewer = await request(app)
        .delete(
          `/api/tickets/${created.body.ticket._id}/participants/${viewer.userId}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(removeViewer.status).toBe(200);
      expect(removeViewer.body.messageKey).toBe(
        'success.ticket.participantRemoved'
      );
      expect(removeViewer.body.ticketSummary.participantCount).toBe(0);

      const finalList = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(finalList.status).toBe(200);
      expect(finalList.body.participants).toEqual([]);
    }
  );

  maybeDbTest(
    'enforces assignment, lifecycle, participant, and patch guardrails without leaking workspace data',
    async () => {
      const owner = await createVerifiedUser();
      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const outsider = await createVerifiedUser();

      const ownerContact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const outsiderContact = await createContactRecord({
        workspaceId: outsider.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Operational guardrails',
          contactId: String(ownerContact._id),
        },
      });
      expect(created.status).toBe(200);

      const viewerAssign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ assigneeId: agent.userId });
      expect(viewerAssign.status).toBe(403);
      expect(viewerAssign.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerUnassign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/unassign`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({});
      expect(viewerUnassign.status).toBe(403);
      expect(viewerUnassign.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerSelfAssign = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({});
      expect(viewerSelfAssign.status).toBe(403);
      expect(viewerSelfAssign.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const viewerParticipantWrite = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({
          userId: viewer.userId,
          type: TICKET_PARTICIPANT_TYPE.WATCHER,
        });
      expect(viewerParticipantWrite.status).toBe(403);
      expect(viewerParticipantWrite.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const invalidAssignId = await request(app)
        .post('/api/tickets/not-a-valid-id/assign')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: agent.userId });
      expectValidationError(
        invalidAssignId,
        'id',
        'errors.validation.invalidId'
      );

      const agentAssignOther = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({ assigneeId: admin.userId });
      expect(agentAssignOther.status).toBe(403);
      expect(agentAssignOther.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const agentAssignSelfViaAssignEndpoint = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({ assigneeId: agent.userId });
      expect(agentAssignSelfViaAssignEndpoint.status).toBe(403);
      expect(agentAssignSelfViaAssignEndpoint.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const assignViewer = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: viewer.userId });
      expect(assignViewer.status).toBe(404);
      expect(assignViewer.body.messageKey).toBe(
        'errors.ticket.assigneeNotFound'
      );

      const assignForeignUser = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: outsider.userId });
      expect(assignForeignUser.status).toBe(404);
      expect(assignForeignUser.body.messageKey).toBe(
        'errors.ticket.assigneeNotFound'
      );

      const foreignTicket = await createTicketRequest({
        accessToken: outsider.accessToken,
        body: {
          subject: 'Foreign workspace ticket',
          contactId: String(outsiderContact._id),
        },
      });
      expect(foreignTicket.status).toBe(200);

      const foreignTicketAssign = await request(app)
        .post(`/api/tickets/${foreignTicket.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: agent.userId });
      expect(foreignTicketAssign.status).toBe(404);
      expect(foreignTicketAssign.body.messageKey).toBe(
        'errors.ticket.notFound'
      );

      const foreignTicketParticipants = await request(app)
        .get(`/api/tickets/${foreignTicket.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(foreignTicketParticipants.status).toBe(404);
      expect(foreignTicketParticipants.body.messageKey).toBe(
        'errors.ticket.notFound'
      );

      const foreignParticipantUser = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          userId: outsider.userId,
          type: TICKET_PARTICIPANT_TYPE.WATCHER,
        });
      expect(foreignParticipantUser.status).toBe(404);
      expect(foreignParticipantUser.body.messageKey).toBe(
        'errors.ticket.participantUserNotFound'
      );

      const assignAdmin = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ assigneeId: admin.userId });
      expect(assignAdmin.status).toBe(200);

      const agentStealAttempt = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({});
      expect(agentStealAttempt.status).toBe(409);
      expect(agentStealAttempt.body.messageKey).toBe(
        'errors.ticket.selfAssignNotAvailable'
      );

      const invalidClose = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/close`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(invalidClose.status).toBe(409);
      expect(invalidClose.body.messageKey).toBe(
        'errors.ticket.closeNotAllowed'
      );
      expect(invalidClose.body.message).toBe(
        t('errors.ticket.closeNotAllowed', 'en', {
          from: { key: 'ticketStatus.open' },
          requiredFrom: { key: 'ticketStatus.solved' },
        })
      );

      const solved = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/solve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(solved.status).toBe(200);

      const invalidTransition = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status: TICKET_STATUS.PENDING });
      expect(invalidTransition.status).toBe(409);
      expect(invalidTransition.body.messageKey).toBe(
        'errors.ticket.invalidStatusTransition'
      );
      expect(invalidTransition.body.message).toBe(
        t('errors.ticket.invalidStatusTransition', 'en', {
          from: { key: 'ticketStatus.solved' },
          to: { key: 'ticketStatus.pending' },
        })
      );

      const invalidParticipantType = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/participants`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          userId: viewer.userId,
          type: 'lead',
        });
      expectValidationError(
        invalidParticipantType,
        'type',
        'errors.validation.invalidEnum'
      );

      const patchStatusRejected = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          status: TICKET_STATUS.CLOSED,
        });
      expectValidationError(
        patchStatusRejected,
        'status',
        'errors.validation.unknownField'
      );

      const selfAssignUnexpectedBody = await request(app)
        .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          assigneeId: admin.userId,
        });
      expectValidationError(
        selfAssignUnexpectedBody,
        'assigneeId',
        'errors.validation.unknownField'
      );
    }
  );
});
