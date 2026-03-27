import request from 'supertest';
import { io as createSocketClient } from 'socket.io-client';
import app from '../src/app.js';
import { realtimeConfig } from '../src/config/realtime.config.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { createHttpServer } from '../src/server.js';
import { shutdownRealtime } from '../src/infra/realtime/index.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
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
  email = nextEmail('realtime-collaboration-user'),
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
    email: nextEmail(`realtime-collaboration-${roleKey}`),
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

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForActionThrottle = () =>
  waitMs(realtimeConfig.collaboration.actionThrottleMs + 25);

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

describe('Realtime collaboration behaviors', () => {
  maybeDbTest(
    'ticket subscribe emits a collaboration snapshot, presence updates are room-scoped, and same-state refreshes stay quiet',
    async () => {
      const owner = await createVerifiedUser();
      const observer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime presence ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let observerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        observerClient = await connectRealtimeClient({
          baseUrl,
          token: observer.accessToken,
        });

        const ownerSnapshotPromise = waitForSocketEvent(
          ownerClient,
          'ticket.presence.snapshot'
        );
        const observerSnapshotPromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.snapshot'
        );

        const [ownerSubscribeAck, observerSubscribeAck, ownerSnapshot] =
          await Promise.all([
            emitWithAck(ownerClient, 'ticket.subscribe', {
              ticketId: created.body.ticket._id,
            }),
            emitWithAck(observerClient, 'ticket.subscribe', {
              ticketId: created.body.ticket._id,
            }),
            ownerSnapshotPromise,
          ]);

        await observerSnapshotPromise;

        expect(ownerSubscribeAck.ok).toBe(true);
        expect(observerSubscribeAck.ok).toBe(true);
        expect(ownerSnapshot).toEqual(
          expect.objectContaining({
            event: 'ticket.presence.snapshot',
            workspaceId: owner.workspaceId,
            actorUserId: null,
            data: {
              ticketId: created.body.ticket._id,
              presence: [],
              typing: [],
              softClaim: null,
            },
          })
        );

        const presenceChangedPromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const presenceAck = await emitWithAck(ownerClient, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'viewing',
        });
        const presenceChanged = await presenceChangedPromise;

        expect(presenceAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.ticket.presence.updated',
            data: expect.objectContaining({
              ticketId: created.body.ticket._id,
              state: 'viewing',
            }),
          })
        );
        expect(presenceChanged).toEqual(
          expect.objectContaining({
            event: 'ticket.presence.changed',
            workspaceId: owner.workspaceId,
            actorUserId: owner.userId,
            data: expect.objectContaining({
              ticketId: created.body.ticket._id,
              presence: [
                expect.objectContaining({
                  userId: owner.userId,
                  state: 'viewing',
                  user: expect.objectContaining({
                    _id: owner.userId,
                    roleKey: WORKSPACE_ROLES.OWNER,
                  }),
                }),
              ],
            }),
          })
        );

        const noDuplicatePresence = expectNoSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const refreshAck = await emitWithAck(ownerClient, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'viewing',
        });

        expect(refreshAck.ok).toBe(true);
        await noDuplicatePresence;
        await waitForActionThrottle();

        const replyingChangedPromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        await emitWithAck(ownerClient, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'replying',
        });
        const replyingChanged = await replyingChangedPromise;

        expect(replyingChanged.data.presence).toEqual([
          expect.objectContaining({
            userId: owner.userId,
            state: 'replying',
          }),
        ]);

        const clearedPresencePromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const unsubscribeAck = await emitWithAck(ownerClient, 'ticket.unsubscribe', {
          ticketId: created.body.ticket._id,
        });
        const clearedPresence = await clearedPresencePromise;

        expect(unsubscribeAck.ok).toBe(true);
        expect(clearedPresence.data).toEqual({
          ticketId: created.body.ticket._id,
          presence: [],
        });
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, observerClient],
        });
      }
    }
  );

  maybeDbTest(
    'typing start, stop, and expiry behave as ephemeral ticket-room signals',
    async () => {
      const owner = await createVerifiedUser();
      const observer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime typing ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let observerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        observerClient = await connectRealtimeClient({
          baseUrl,
          token: observer.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.snapshot'),
          emitWithAck(observerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const typingStartedPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        const typingStartAck = await emitWithAck(ownerClient, 'ticket.typing.start', {
          ticketId: created.body.ticket._id,
          mode: 'public_reply',
        });
        const typingStarted = await typingStartedPromise;

        expect(typingStartAck.ok).toBe(true);
        expect(typingStarted.data.typing).toEqual([
          expect.objectContaining({
            userId: owner.userId,
            mode: 'public_reply',
          }),
        ]);
        const noDuplicateTyping = expectNoSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        const typingRefreshAck = await emitWithAck(ownerClient, 'ticket.typing.start', {
          ticketId: created.body.ticket._id,
          mode: 'public_reply',
        });

        expect(typingRefreshAck.ok).toBe(true);
        await noDuplicateTyping;
        await waitForActionThrottle();

        const typingStoppedPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        const typingStopAck = await emitWithAck(ownerClient, 'ticket.typing.stop', {
          ticketId: created.body.ticket._id,
        });
        const typingStopped = await typingStoppedPromise;

        expect(typingStopAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.ticket.typing.stopped',
          })
        );
        expect(typingStopped.data).toEqual({
          ticketId: created.body.ticket._id,
          typing: [],
        });

        const typingRestartedPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        await emitWithAck(ownerClient, 'ticket.typing.start', {
          ticketId: created.body.ticket._id,
          mode: 'internal_note',
        });
        const typingRestarted = await typingRestartedPromise;

        expect(typingRestarted.data.typing).toEqual([
          expect.objectContaining({
            userId: owner.userId,
            mode: 'internal_note',
          }),
        ]);

        const typingExpiredPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        await waitMs(realtimeConfig.collaboration.typingTtlMs + 350);
        const typingExpired = await typingExpiredPromise;

        expect(typingExpired.data).toEqual({
          ticketId: created.body.ticket._id,
          typing: [],
        });
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, observerClient],
        });
      }
    }
  );

  maybeDbTest(
    'soft claim is advisory, can be overwritten, and expires without changing ticket truth',
    async () => {
      const owner = await createVerifiedUser();
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
          subject: 'Realtime soft claim ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let agentClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        agentClient = await connectRealtimeClient({
          baseUrl,
          token: agent.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(agentClient, 'ticket.presence.snapshot'),
          emitWithAck(agentClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const ownerClaimPromise = waitForSocketEvent(
          agentClient,
          'ticket.soft_claim.changed'
        );
        const ownerClaimAck = await emitWithAck(
          ownerClient,
          'ticket.soft_claim.set',
          {
            ticketId: created.body.ticket._id,
          }
        );
        const ownerClaim = await ownerClaimPromise;

        expect(ownerClaimAck.ok).toBe(true);
        expect(ownerClaim.data).toEqual(
          expect.objectContaining({
            ticketId: created.body.ticket._id,
            softClaim: expect.objectContaining({
              userId: owner.userId,
            }),
          })
        );
        const noDuplicateSoftClaim = expectNoSocketEvent(
          agentClient,
          'ticket.soft_claim.changed'
        );
        const ownerClaimRefreshAck = await emitWithAck(
          ownerClient,
          'ticket.soft_claim.set',
          {
            ticketId: created.body.ticket._id,
          }
        );

        expect(ownerClaimRefreshAck.ok).toBe(true);
        await noDuplicateSoftClaim;
        await waitForActionThrottle();

        const agentClaimPromise = waitForSocketEvent(
          ownerClient,
          'ticket.soft_claim.changed'
        );
        const agentClaimAck = await emitWithAck(
          agentClient,
          'ticket.soft_claim.set',
          {
            ticketId: created.body.ticket._id,
          }
        );
        const agentClaim = await agentClaimPromise;

        expect(agentClaimAck.ok).toBe(true);
        expect(agentClaim.data).toEqual(
          expect.objectContaining({
            ticketId: created.body.ticket._id,
            softClaim: expect.objectContaining({
              userId: agent.userId,
            }),
          })
        );

        const ownerUpdate = await updateTicketRequest({
          accessToken: owner.accessToken,
          ticketId: created.body.ticket._id,
          body: {
            subject: 'Still writable under soft claim',
          },
        });

        expect(ownerUpdate.status).toBe(200);
        expect(ownerUpdate.body.ticket.subject).toBe(
          'Still writable under soft claim'
        );

        const softClaimExpiredPromise = waitForSocketEvent(
          ownerClient,
          'ticket.soft_claim.changed'
        );
        await waitMs(realtimeConfig.collaboration.softClaimTtlMs + 350);
        const softClaimExpired = await softClaimExpiredPromise;

        expect(softClaimExpired.data).toEqual({
          ticketId: created.body.ticket._id,
          softClaim: null,
        });

        const persistedTicket = await Ticket.findById(created.body.ticket._id)
          .lean()
          .select('_id subject softClaim presence typing');

        expect(persistedTicket.subject).toBe('Still writable under soft claim');
        expect(persistedTicket.softClaim).toBeUndefined();
        expect(persistedTicket.presence).toBeUndefined();
        expect(persistedTicket.typing).toBeUndefined();
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, agentClient],
        });
      }
    }
  );

  maybeDbTest(
    'collaboration actions require ticket subscription and preserve tenant boundaries',
    async () => {
      const owner = await createVerifiedUser();
      const foreignOwner = await createVerifiedUser();
      const [ownContact, foreignContact] = await Promise.all([
        createContactRecord({ workspaceId: owner.workspaceId }),
        createContactRecord({ workspaceId: foreignOwner.workspaceId }),
      ]);
      const [ownTicket, foreignTicket] = await Promise.all([
        createTicketRequest({
          accessToken: owner.accessToken,
          body: {
            subject: 'Realtime action own ticket',
            contactId: String(ownContact._id),
          },
        }),
        createTicketRequest({
          accessToken: foreignOwner.accessToken,
          body: {
            subject: 'Realtime action foreign ticket',
            contactId: String(foreignContact._id),
          },
        }),
      ]);

      expect(ownTicket.status).toBe(200);
      expect(foreignTicket.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        const missingSubscriptionAck = await emitWithAck(
          ownerClient,
          'ticket.presence.set',
          {
            ticketId: ownTicket.body.ticket._id,
            state: 'viewing',
          }
        );

        expect(missingSubscriptionAck).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.realtime.ticketSubscriptionRequired',
            messageKey: 'errors.realtime.ticketSubscriptionRequired',
          })
        );

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: ownTicket.body.ticket._id,
          }),
        ]);

        const foreignTicketAck = await emitWithAck(
          ownerClient,
          'ticket.presence.set',
          {
            ticketId: foreignTicket.body.ticket._id,
            state: 'viewing',
          }
        );

        expect(foreignTicketAck).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.ticket.notFound',
            messageKey: 'errors.ticket.notFound',
          })
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient],
        });
      }
    }
  );

  maybeDbTest(
    'disconnect cleanup removes presence, typing, and soft claim for remaining subscribers',
    async () => {
      const owner = await createVerifiedUser();
      const observer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime disconnect cleanup ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let observerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        observerClient = await connectRealtimeClient({
          baseUrl,
          token: observer.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.snapshot'),
          emitWithAck(observerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.changed'),
          emitWithAck(ownerClient, 'ticket.presence.set', {
            ticketId: created.body.ticket._id,
            state: 'viewing',
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.typing.changed'),
          emitWithAck(ownerClient, 'ticket.typing.start', {
            ticketId: created.body.ticket._id,
            mode: 'public_reply',
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.soft_claim.changed'),
          emitWithAck(ownerClient, 'ticket.soft_claim.set', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const cleanupPresencePromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const cleanupTypingPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        const cleanupSoftClaimPromise = waitForSocketEvent(
          observerClient,
          'ticket.soft_claim.changed'
        );

        await closeSocketClient(ownerClient);
        ownerClient = null;

        const [cleanupPresence, cleanupTyping, cleanupSoftClaim] =
          await Promise.all([
            cleanupPresencePromise,
            cleanupTypingPromise,
            cleanupSoftClaimPromise,
          ]);

        expect(cleanupPresence.data).toEqual({
          ticketId: created.body.ticket._id,
          presence: [],
        });
        expect(cleanupTyping.data).toEqual({
          ticketId: created.body.ticket._id,
          typing: [],
        });
        expect(cleanupSoftClaim.data).toEqual({
          ticketId: created.body.ticket._id,
          softClaim: null,
        });
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, observerClient],
        });
      }
    }
  );

  maybeDbTest(
    'ticket unsubscribe clears presence, typing, and soft claim without leaving stale ticket-room state',
    async () => {
      const owner = await createVerifiedUser();
      const observer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime unsubscribe cleanup ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let observerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        observerClient = await connectRealtimeClient({
          baseUrl,
          token: observer.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.snapshot'),
          emitWithAck(observerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.changed'),
          emitWithAck(ownerClient, 'ticket.presence.set', {
            ticketId: created.body.ticket._id,
            state: 'viewing',
          }),
        ]);
        await waitForActionThrottle();
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.typing.changed'),
          emitWithAck(ownerClient, 'ticket.typing.start', {
            ticketId: created.body.ticket._id,
            mode: 'public_reply',
          }),
        ]);
        await waitForActionThrottle();
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.soft_claim.changed'),
          emitWithAck(ownerClient, 'ticket.soft_claim.set', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const cleanupPresencePromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const cleanupTypingPromise = waitForSocketEvent(
          observerClient,
          'ticket.typing.changed'
        );
        const cleanupSoftClaimPromise = waitForSocketEvent(
          observerClient,
          'ticket.soft_claim.changed'
        );

        const unsubscribeAck = await emitWithAck(ownerClient, 'ticket.unsubscribe', {
          ticketId: created.body.ticket._id,
        });
        const [cleanupPresence, cleanupTyping, cleanupSoftClaim] =
          await Promise.all([
            cleanupPresencePromise,
            cleanupTypingPromise,
            cleanupSoftClaimPromise,
          ]);

        expect(unsubscribeAck.ok).toBe(true);
        expect(cleanupPresence.data).toEqual({
          ticketId: created.body.ticket._id,
          presence: [],
        });
        expect(cleanupTyping.data).toEqual({
          ticketId: created.body.ticket._id,
          typing: [],
        });
        expect(cleanupSoftClaim.data).toEqual({
          ticketId: created.body.ticket._id,
          softClaim: null,
        });
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, observerClient],
        });
      }
    }
  );

  maybeDbTest(
    'collaboration action spam is modestly throttled without broadcasting a conflicting state change',
    async () => {
      const owner = await createVerifiedUser();
      const observer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime throttle ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let ownerClient = null;
      let observerClient = null;

      try {
        ownerClient = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });
        observerClient = await connectRealtimeClient({
          baseUrl,
          token: observer.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(ownerClient, 'ticket.presence.snapshot'),
          emitWithAck(ownerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);
        await Promise.all([
          waitForSocketEvent(observerClient, 'ticket.presence.snapshot'),
          emitWithAck(observerClient, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const viewingChangedPromise = waitForSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const viewingAck = await emitWithAck(ownerClient, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'viewing',
        });
        const viewingChanged = await viewingChangedPromise;

        expect(viewingAck.ok).toBe(true);
        expect(viewingChanged.data.presence).toEqual([
          expect.objectContaining({
            userId: owner.userId,
            state: 'viewing',
          }),
        ]);

        const noReplyingBroadcast = expectNoSocketEvent(
          observerClient,
          'ticket.presence.changed'
        );
        const throttledAck = await emitWithAck(ownerClient, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'replying',
        });

        expect(throttledAck).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.realtime.rateLimited',
            messageKey: 'errors.realtime.rateLimited',
            data: expect.objectContaining({
              details: expect.objectContaining({
                throttleMs: realtimeConfig.collaboration.actionThrottleMs,
              }),
            }),
          })
        );
        await noReplyingBroadcast;
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [ownerClient, observerClient],
        });
      }
    }
  );
});
