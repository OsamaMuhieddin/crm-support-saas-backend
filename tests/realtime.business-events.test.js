import request from 'supertest';
import { io as createSocketClient } from 'socket.io-client';
import { jest } from '@jest/globals';
import app from '../src/app.js';
import { realtimeConfig } from '../src/config/realtime.config.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_PARTICIPANT_TYPE } from '../src/constants/ticket-participant-type.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { createHttpServer } from '../src/server.js';
import {
  realtimePublisher,
  shutdownRealtime,
} from '../src/infra/realtime/index.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
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

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Realtime User',
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
  email = nextEmail('realtime-events-user'),
  password = 'Password123!',
  name = 'Realtime User',
} = {}) => {
  const signup = await signupAndCaptureOtp({
    email,
    password,
    name,
  });

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
    email: nextEmail(`realtime-events-${roleKey}`),
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

const createContactRecord = async ({ workspaceId }) =>
  Contact.create({
    workspaceId,
    fullName: nextValue('Realtime Contact'),
    email: nextEmail('realtime-contact'),
    phone: '+963955555555',
  });

const createTicketRequest = async ({ accessToken, body }) =>
  request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const updateTicketRequest = async ({ accessToken, ticketId, body }) =>
  request(app)
    .patch(`/api/tickets/${ticketId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const createTicketMessageRequest = async ({ accessToken, ticketId, body }) =>
  request(app)
    .post(`/api/tickets/${ticketId}/messages`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const startRealtimeRuntime = async () => {
  const httpServer = await createHttpServer();

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();

  return {
    httpServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
};

const connectRealtimeClient = async ({ baseUrl, token }) =>
  new Promise((resolve, reject) => {
    const client = createSocketClient(baseUrl, {
      path: realtimeConfig.path,
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });

    const cleanup = () => {
      client.off('connect', handleConnect);
      client.off('connect_error', handleError);
    };

    const handleConnect = () => {
      cleanup();
      resolve(client);
    };

    const handleError = (error) => {
      cleanup();
      client.close();
      reject(error);
    };

    client.on('connect', handleConnect);
    client.on('connect_error', handleError);
  });

const emitWithAck = (client, event, payload = {}) =>
  new Promise((resolve) => {
    client.emit(event, payload, resolve);
  });

const waitForSocketEvent = (client, event) =>
  new Promise((resolve) => {
    client.once(event, resolve);
  });

const expectNoSocketEvent = async (client, event, timeoutMs = 250) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, handleEvent);
      resolve();
    }, timeoutMs);

    const handleEvent = (payload) => {
      clearTimeout(timer);
      client.off(event, handleEvent);
      reject(new Error(`Unexpected ${event}: ${JSON.stringify(payload)}`));
    };

    client.on(event, handleEvent);
  });

const closeSocketClient = async (client) => {
  if (!client) {
    return;
  }

  client.close();
  await new Promise((resolve) => setTimeout(resolve, 25));
};

const stopRealtimeRuntime = async ({ httpServer, clients = [] } = {}) => {
  await Promise.allSettled(clients.filter(Boolean).map(closeSocketClient));
  await shutdownRealtime();

  if (httpServer?.listening) {
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });
  }
};

describe('Realtime business events', () => {
  maybeDbTest(
    'ticket create without initialMessage does not publish message or conversation live events',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const emitToRoomsSpy = jest.spyOn(realtimePublisher, 'emitToRooms');
      const emitToTicketSpy = jest.spyOn(realtimePublisher, 'emitToTicket');

      try {
        const created = await createTicketRequest({
          accessToken: owner.accessToken,
          body: {
            subject: 'Realtime create without initial message',
            contactId: String(contact._id),
          },
        });

        expect(created.status).toBe(200);

        expect(
          emitToRoomsSpy.mock.calls.filter(
            ([payload]) => payload?.event === 'ticket.created'
          )
        ).toHaveLength(1);
        expect(
          emitToTicketSpy.mock.calls.filter(
            ([payload]) => payload?.event === 'message.created'
          )
        ).toHaveLength(0);
        expect(
          emitToRoomsSpy.mock.calls.filter(
            ([payload]) => payload?.event === 'conversation.updated'
          )
        ).toHaveLength(0);
      } finally {
        emitToRoomsSpy.mockRestore();
        emitToTicketSpy.mockRestore();
      }
    }
  );

  maybeDbTest(
    'ticket create with initialMessage publishes ticket created plus message and conversation events once in order',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const emitToRoomsSpy = jest.spyOn(realtimePublisher, 'emitToRooms');
      const emitToTicketSpy = jest.spyOn(realtimePublisher, 'emitToTicket');

      try {
        const created = await createTicketRequest({
          accessToken: owner.accessToken,
          body: {
            subject: 'Realtime create with initial message',
            contactId: String(contact._id),
            initialMessage: {
              type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
              bodyText: 'Initial customer message body',
            },
          },
        });

        expect(created.status).toBe(200);

        const ticketCreatedCalls = emitToRoomsSpy.mock.calls.filter(
          ([payload]) => payload?.event === 'ticket.created'
        );
        const conversationUpdatedCalls = emitToRoomsSpy.mock.calls.filter(
          ([payload]) => payload?.event === 'conversation.updated'
        );
        const messageCreatedCalls = emitToTicketSpy.mock.calls.filter(
          ([payload]) => payload?.event === 'message.created'
        );

        expect(ticketCreatedCalls).toHaveLength(1);
        expect(messageCreatedCalls).toHaveLength(1);
        expect(conversationUpdatedCalls).toHaveLength(1);

        expect(messageCreatedCalls[0][0]).toEqual(
          expect.objectContaining({
            event: 'message.created',
            workspaceId: owner.workspaceId,
            data: expect.objectContaining({
              message: expect.objectContaining({
                bodyText: 'Initial customer message body',
                type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
              }),
              conversation: expect.objectContaining({
                messageCount: 1,
                lastMessageType: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
              }),
            }),
          })
        );
        expect(conversationUpdatedCalls[0][0]).toEqual(
          expect.objectContaining({
            event: 'conversation.updated',
            workspaceId: owner.workspaceId,
            data: expect.objectContaining({
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                status: TICKET_STATUS.OPEN,
                messageCount: 1,
                lastMessageType: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
              }),
              conversation: expect.objectContaining({
                messageCount: 1,
                lastMessageType: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
              }),
            }),
          })
        );

        const ticketCreatedIndex = emitToRoomsSpy.mock.calls.findIndex(
          ([payload]) => payload?.event === 'ticket.created'
        );
        const conversationUpdatedIndex = emitToRoomsSpy.mock.calls.findIndex(
          ([payload]) => payload?.event === 'conversation.updated'
        );
        const messageCreatedIndex = emitToTicketSpy.mock.calls.findIndex(
          ([payload]) => payload?.event === 'message.created'
        );

        const ticketCreatedOrder =
          emitToRoomsSpy.mock.invocationCallOrder[ticketCreatedIndex];
        const conversationUpdatedOrder =
          emitToRoomsSpy.mock.invocationCallOrder[conversationUpdatedIndex];
        const messageCreatedOrder =
          emitToTicketSpy.mock.invocationCallOrder[messageCreatedIndex];

        expect(ticketCreatedOrder).toBeLessThan(messageCreatedOrder);
        expect(messageCreatedOrder).toBeLessThan(conversationUpdatedOrder);
      } finally {
        emitToRoomsSpy.mockRestore();
        emitToTicketSpy.mockRestore();
      }
    }
  );

  maybeDbTest(
    'ticket create and ticket update emit only inside the owning workspace and ticket rooms',
    async () => {
      const owner = await createVerifiedUser();
      const foreignOwner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let workspaceClient = null;
      let ticketClient = null;
      let foreignWorkspaceClient = null;

      try {
        workspaceClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        foreignWorkspaceClient = await connectRealtimeClient({
          baseUrl,
          token: foreignOwner.accessToken,
        });

        await emitWithAck(workspaceClient, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });
        await emitWithAck(foreignWorkspaceClient, 'workspace.subscribe', {
          workspaceId: foreignOwner.workspaceId,
        });

        const createdEventPromise = waitForSocketEvent(
          workspaceClient,
          'ticket.created'
        );
        const noForeignCreate = expectNoSocketEvent(
          foreignWorkspaceClient,
          'ticket.created'
        );

        const created = await createTicketRequest({
          accessToken: owner.accessToken,
          body: {
            subject: 'Realtime create event',
            contactId: String(contact._id),
          },
        });

        expect(created.status).toBe(200);

        const createdEvent = await createdEventPromise;
        await noForeignCreate;

        expect(createdEvent).toEqual(
          expect.objectContaining({
            event: 'ticket.created',
            workspaceId: owner.workspaceId,
            actorUserId: owner.userId,
          })
        );
        expect(createdEvent.data.ticket).toEqual(
          expect.objectContaining({
            _id: created.body.ticket._id,
            subject: 'Realtime create event',
            workspaceId: owner.workspaceId,
            messageCount: 0,
          })
        );

        ticketClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        await emitWithAck(ticketClient, 'ticket.subscribe', {
          ticketId: created.body.ticket._id,
        });

        const workspaceUpdatedPromise = waitForSocketEvent(
          workspaceClient,
          'ticket.updated'
        );
        const ticketUpdatedPromise = waitForSocketEvent(
          ticketClient,
          'ticket.updated'
        );
        const noForeignUpdate = expectNoSocketEvent(
          foreignWorkspaceClient,
          'ticket.updated'
        );

        const updated = await updateTicketRequest({
          accessToken: owner.accessToken,
          ticketId: created.body.ticket._id,
          body: {
            subject: 'Realtime update event',
          },
        });

        expect(updated.status).toBe(200);

        const [workspaceUpdatedEvent, ticketUpdatedEvent] = await Promise.all([
          workspaceUpdatedPromise,
          ticketUpdatedPromise,
        ]);
        await noForeignUpdate;

        for (const envelope of [workspaceUpdatedEvent, ticketUpdatedEvent]) {
          expect(envelope).toEqual(
            expect.objectContaining({
              event: 'ticket.updated',
              workspaceId: owner.workspaceId,
              actorUserId: owner.userId,
            })
          );
          expect(envelope.data.ticket).toEqual(
            expect.objectContaining({
              _id: created.body.ticket._id,
              subject: 'Realtime update event',
            })
          );
        }

        const noWorkspaceNoopUpdate = expectNoSocketEvent(
          workspaceClient,
          'ticket.updated'
        );
        const noTicketNoopUpdate = expectNoSocketEvent(
          ticketClient,
          'ticket.updated'
        );
        const noopUpdate = await updateTicketRequest({
          accessToken: owner.accessToken,
          ticketId: created.body.ticket._id,
          body: {
            subject: 'Realtime update event',
          },
        });

        expect(noopUpdate.status).toBe(200);
        expect(noopUpdate.body.ticket.subject).toBe('Realtime update event');
        await Promise.all([noWorkspaceNoopUpdate, noTicketNoopUpdate]);
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [workspaceClient, ticketClient, foreignWorkspaceClient],
        });
      }
    }
  );

  maybeDbTest(
    'assignment, unassignment, and self-assignment emit room events and only target the intended user notices',
    async () => {
      const owner = await createVerifiedUser();
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const otherAgent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime assignment event',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let workspaceClient = null;
      let ticketClient = null;
      let agentNoticeClient = null;
      let otherAgentNoticeClient = null;

      try {
        workspaceClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        ticketClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        agentNoticeClient = await connectRealtimeClient({
          baseUrl,
          token: agent.accessToken,
        });
        otherAgentNoticeClient = await connectRealtimeClient({
          baseUrl,
          token: otherAgent.accessToken,
        });

        await emitWithAck(workspaceClient, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });
        await emitWithAck(ticketClient, 'ticket.subscribe', {
          ticketId: created.body.ticket._id,
        });

        const assignWorkspacePromise = waitForSocketEvent(
          workspaceClient,
          'ticket.assigned'
        );
        const assignTicketPromise = waitForSocketEvent(
          ticketClient,
          'ticket.assigned'
        );
        const assignedNoticePromise = waitForSocketEvent(
          agentNoticeClient,
          'user.notice'
        );
        const noOtherAssignedNotice = expectNoSocketEvent(
          otherAgentNoticeClient,
          'user.notice'
        );

        const assigned = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/assign`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ assigneeId: agent.userId });

        expect(assigned.status).toBe(200);

        const [assignWorkspaceEvent, assignTicketEvent, assignedNotice] =
          await Promise.all([
            assignWorkspacePromise,
            assignTicketPromise,
            assignedNoticePromise,
          ]);
        await noOtherAssignedNotice;

        for (const envelope of [assignWorkspaceEvent, assignTicketEvent]) {
          expect(envelope).toEqual(
            expect.objectContaining({
              event: 'ticket.assigned',
              workspaceId: owner.workspaceId,
              actorUserId: owner.userId,
            })
          );
          expect(envelope.data).toEqual(
            expect.objectContaining({
              assignmentMode: 'assign',
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                assigneeId: agent.userId,
                status: TICKET_STATUS.OPEN,
              }),
            })
          );
        }

        expect(assignedNotice).toEqual(
          expect.objectContaining({
            event: 'user.notice',
            workspaceId: owner.workspaceId,
            actorUserId: owner.userId,
            data: expect.objectContaining({
              noticeType: 'ticket_assigned',
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                assigneeId: agent.userId,
              }),
            }),
          })
        );

        const unassignWorkspacePromise = waitForSocketEvent(
          workspaceClient,
          'ticket.unassigned'
        );
        const unassignTicketPromise = waitForSocketEvent(
          ticketClient,
          'ticket.unassigned'
        );
        const unassignedNoticePromise = waitForSocketEvent(
          agentNoticeClient,
          'user.notice'
        );

        const unassigned = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/unassign`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(unassigned.status).toBe(200);

        const [unassignWorkspaceEvent, unassignTicketEvent, unassignedNotice] =
          await Promise.all([
            unassignWorkspacePromise,
            unassignTicketPromise,
            unassignedNoticePromise,
          ]);

        for (const envelope of [unassignWorkspaceEvent, unassignTicketEvent]) {
          expect(envelope).toEqual(
            expect.objectContaining({
              event: 'ticket.unassigned',
              workspaceId: owner.workspaceId,
              actorUserId: owner.userId,
            })
          );
          expect(envelope.data.ticket).toEqual(
            expect.objectContaining({
              _id: created.body.ticket._id,
              assigneeId: null,
            })
          );
        }

        expect(unassignedNotice).toEqual(
          expect.objectContaining({
            event: 'user.notice',
            data: expect.objectContaining({
              noticeType: 'ticket_unassigned',
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                assigneeId: null,
              }),
            }),
          })
        );

        const selfAssignWorkspacePromise = waitForSocketEvent(
          workspaceClient,
          'ticket.assigned'
        );
        const selfAssignTicketPromise = waitForSocketEvent(
          ticketClient,
          'ticket.assigned'
        );
        const noSelfAssignNotice = expectNoSocketEvent(
          agentNoticeClient,
          'user.notice'
        );

        const selfAssigned = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/self-assign`)
          .set('Authorization', `Bearer ${agent.accessToken}`)
          .send({});

        expect(selfAssigned.status).toBe(200);

        const [selfAssignWorkspaceEvent, selfAssignTicketEvent] =
          await Promise.all([
            selfAssignWorkspacePromise,
            selfAssignTicketPromise,
          ]);
        await noSelfAssignNotice;

        for (const envelope of [
          selfAssignWorkspaceEvent,
          selfAssignTicketEvent,
        ]) {
          expect(envelope).toEqual(
            expect.objectContaining({
              event: 'ticket.assigned',
              workspaceId: owner.workspaceId,
              actorUserId: agent.userId,
            })
          );
          expect(envelope.data).toEqual(
            expect.objectContaining({
              assignmentMode: 'self_assign',
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                assigneeId: agent.userId,
              }),
            })
          );
        }
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [
            workspaceClient,
            ticketClient,
            agentNoticeClient,
            otherAgentNoticeClient,
          ],
        });
      }
    }
  );

  maybeDbTest(
    'status, solve, close, and reopen emit the expected lifecycle event names',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime lifecycle event',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let workspaceClient = null;
      let ticketClient = null;

      try {
        workspaceClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        ticketClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        await emitWithAck(workspaceClient, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });
        await emitWithAck(ticketClient, 'ticket.subscribe', {
          ticketId: created.body.ticket._id,
        });

        const statusChangedPromise = waitForSocketEvent(
          ticketClient,
          'ticket.status_changed'
        );

        const pending = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/status`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ status: TICKET_STATUS.PENDING });

        expect(pending.status).toBe(200);

        const statusChanged = await statusChangedPromise;
        expect(statusChanged).toEqual(
          expect.objectContaining({
            event: 'ticket.status_changed',
            workspaceId: owner.workspaceId,
            actorUserId: owner.userId,
          })
        );
        expect(statusChanged.data.ticket).toEqual(
          expect.objectContaining({
            _id: created.body.ticket._id,
            status: TICKET_STATUS.PENDING,
          })
        );

        const solvedPromise = waitForSocketEvent(ticketClient, 'ticket.solved');
        const solved = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/solve`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(solved.status).toBe(200);
        expect((await solvedPromise).data.ticket.status).toBe(
          TICKET_STATUS.SOLVED
        );

        const closedPromise = waitForSocketEvent(ticketClient, 'ticket.closed');
        const closed = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/close`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(closed.status).toBe(200);
        expect((await closedPromise).data.ticket.status).toBe(
          TICKET_STATUS.CLOSED
        );

        const reopenedPromise = waitForSocketEvent(
          ticketClient,
          'ticket.reopened'
        );
        const reopened = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/reopen`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(reopened.status).toBe(200);
        expect((await reopenedPromise).data.ticket.status).toBe(
          TICKET_STATUS.OPEN
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [workspaceClient, ticketClient],
        });
      }
    }
  );

  maybeDbTest(
    'message creation emits final message and conversation payloads after counters and status are updated',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime message event',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let workspaceClient = null;
      let ticketClient = null;

      try {
        workspaceClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        ticketClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        await emitWithAck(workspaceClient, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });
        await emitWithAck(ticketClient, 'ticket.subscribe', {
          ticketId: created.body.ticket._id,
        });

        const messageCreatedPromise = waitForSocketEvent(
          ticketClient,
          'message.created'
        );
        const workspaceConversationPromise = waitForSocketEvent(
          workspaceClient,
          'conversation.updated'
        );
        const ticketConversationPromise = waitForSocketEvent(
          ticketClient,
          'conversation.updated'
        );

        const messageResponse = await createTicketMessageRequest({
          accessToken: owner.accessToken,
          ticketId: created.body.ticket._id,
          body: {
            type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            bodyText: 'Realtime message body',
          },
        });

        expect(messageResponse.status).toBe(200);

        const [messageCreated, workspaceConversation, ticketConversation] =
          await Promise.all([
            messageCreatedPromise,
            workspaceConversationPromise,
            ticketConversationPromise,
          ]);

        expect(messageCreated).toEqual(
          expect.objectContaining({
            event: 'message.created',
            workspaceId: owner.workspaceId,
            actorUserId: owner.userId,
          })
        );
        expect(messageCreated.data).toEqual(
          expect.objectContaining({
            message: expect.objectContaining({
              bodyText: 'Realtime message body',
              type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            }),
            conversation: expect.objectContaining({
              messageCount: 1,
              lastMessageType: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            }),
            ticket: expect.objectContaining({
              _id: created.body.ticket._id,
              status: TICKET_STATUS.WAITING_ON_CUSTOMER,
              messageCount: 1,
              publicMessageCount: 1,
              lastMessageType: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            }),
          })
        );

        for (const envelope of [workspaceConversation, ticketConversation]) {
          expect(envelope).toEqual(
            expect.objectContaining({
              event: 'conversation.updated',
              workspaceId: owner.workspaceId,
              actorUserId: owner.userId,
            })
          );
          expect(envelope.data.ticket).toEqual(
            expect.objectContaining({
              _id: created.body.ticket._id,
              status: TICKET_STATUS.WAITING_ON_CUSTOMER,
              messageCount: 1,
            })
          );
          expect(envelope.data.conversation).toEqual(
            expect.objectContaining({
              messageCount: 1,
              lastMessageType: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            })
          );
        }
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [workspaceClient, ticketClient],
        });
      }
    }
  );

  maybeDbTest(
    'participant add and remove emit ticket participant events and user notices only for the affected member',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const outsider = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime participant event',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let workspaceClient = null;
      let ticketClient = null;
      let viewerNoticeClient = null;
      let outsiderNoticeClient = null;

      try {
        workspaceClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        ticketClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        viewerNoticeClient = await connectRealtimeClient({
          baseUrl,
          token: viewer.accessToken,
        });
        outsiderNoticeClient = await connectRealtimeClient({
          baseUrl,
          token: outsider.accessToken,
        });

        await emitWithAck(workspaceClient, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });
        await emitWithAck(ticketClient, 'ticket.subscribe', {
          ticketId: created.body.ticket._id,
        });

        const savedWorkspacePromise = waitForSocketEvent(
          workspaceClient,
          'ticket.participant_changed'
        );
        const savedTicketPromise = waitForSocketEvent(
          ticketClient,
          'ticket.participant_changed'
        );
        const addedNoticePromise = waitForSocketEvent(
          viewerNoticeClient,
          'user.notice'
        );
        const noOutsiderNotice = expectNoSocketEvent(
          outsiderNoticeClient,
          'user.notice'
        );

        const saved = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/participants`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            userId: viewer.userId,
            type: TICKET_PARTICIPANT_TYPE.WATCHER,
          });

        expect(saved.status).toBe(200);

        const [savedWorkspaceEvent, savedTicketEvent, addedNotice] =
          await Promise.all([
            savedWorkspacePromise,
            savedTicketPromise,
            addedNoticePromise,
          ]);
        await noOutsiderNotice;

        for (const envelope of [savedWorkspaceEvent, savedTicketEvent]) {
          expect(envelope.data).toEqual(
            expect.objectContaining({
              action: 'saved',
              affectedUserId: viewer.userId,
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                participantCount: 1,
              }),
              participant: expect.objectContaining({
                userId: viewer.userId,
                type: TICKET_PARTICIPANT_TYPE.WATCHER,
              }),
            })
          );
        }

        expect(addedNotice).toEqual(
          expect.objectContaining({
            event: 'user.notice',
            data: expect.objectContaining({
              noticeType: 'ticket_participant_added',
              participantType: TICKET_PARTICIPANT_TYPE.WATCHER,
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
              }),
            }),
          })
        );

        const noDuplicateWorkspaceParticipant = expectNoSocketEvent(
          workspaceClient,
          'ticket.participant_changed'
        );
        const noDuplicateTicketParticipant = expectNoSocketEvent(
          ticketClient,
          'ticket.participant_changed'
        );
        const noDuplicateNotice = expectNoSocketEvent(
          viewerNoticeClient,
          'user.notice'
        );
        const duplicateSave = await request(app)
          .post(`/api/tickets/${created.body.ticket._id}/participants`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            userId: viewer.userId,
            type: TICKET_PARTICIPANT_TYPE.WATCHER,
          });

        expect(duplicateSave.status).toBe(200);
        await Promise.all([
          noDuplicateWorkspaceParticipant,
          noDuplicateTicketParticipant,
          noDuplicateNotice,
        ]);

        const removedWorkspacePromise = waitForSocketEvent(
          workspaceClient,
          'ticket.participant_changed'
        );
        const removedTicketPromise = waitForSocketEvent(
          ticketClient,
          'ticket.participant_changed'
        );
        const removedNoticePromise = waitForSocketEvent(
          viewerNoticeClient,
          'user.notice'
        );

        const removed = await request(app)
          .delete(
            `/api/tickets/${created.body.ticket._id}/participants/${viewer.userId}`
          )
          .set('Authorization', `Bearer ${owner.accessToken}`);

        expect(removed.status).toBe(200);

        const [removedWorkspaceEvent, removedTicketEvent, removedNotice] =
          await Promise.all([
            removedWorkspacePromise,
            removedTicketPromise,
            removedNoticePromise,
          ]);

        for (const envelope of [removedWorkspaceEvent, removedTicketEvent]) {
          expect(envelope.data).toEqual(
            expect.objectContaining({
              action: 'removed',
              affectedUserId: viewer.userId,
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
                participantCount: 0,
              }),
              participant: null,
            })
          );
        }

        expect(removedNotice).toEqual(
          expect.objectContaining({
            event: 'user.notice',
            data: expect.objectContaining({
              noticeType: 'ticket_participant_removed',
              ticket: expect.objectContaining({
                _id: created.body.ticket._id,
              }),
            }),
          })
        );

        const noDuplicateRemoveWorkspace = expectNoSocketEvent(
          workspaceClient,
          'ticket.participant_changed'
        );
        const noDuplicateRemoveTicket = expectNoSocketEvent(
          ticketClient,
          'ticket.participant_changed'
        );
        const noDuplicateRemoveNotice = expectNoSocketEvent(
          viewerNoticeClient,
          'user.notice'
        );
        const duplicateRemove = await request(app)
          .delete(
            `/api/tickets/${created.body.ticket._id}/participants/${viewer.userId}`
          )
          .set('Authorization', `Bearer ${owner.accessToken}`);

        expect(duplicateRemove.status).toBe(200);
        await Promise.all([
          noDuplicateRemoveWorkspace,
          noDuplicateRemoveTicket,
          noDuplicateRemoveNotice,
        ]);
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [
            workspaceClient,
            ticketClient,
            viewerNoticeClient,
            outsiderNoticeClient,
          ],
        });
      }
    }
  );
});
