import request from 'supertest';
import jwt from 'jsonwebtoken';
import { io as createSocketClient } from 'socket.io-client';
import app from '../src/app.js';
import { realtimeConfig } from '../src/config/realtime.config.js';
import {
  realtimePublisher,
  shutdownRealtime,
} from '../src/infra/realtime/index.js';
import { createHttpServer } from '../src/server.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { TicketCounter } from '../src/modules/tickets/models/ticket-counter.model.js';
import { Session } from '../src/modules/users/models/session.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

let sequence = 0;
const isRedisEnabled = process.env.REDIS_ENABLED === 'true';
const isRealtimeRedisAdapterEnabled =
  process.env.REALTIME_REDIS_ADAPTER_ENABLED === 'true';

const nextValue = (prefix) => {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
};

const nextEmail = (prefix) => `${nextValue(prefix)}@example.com`;
const deriveUserName = ({ email, fallback = 'Realtime User' }) => {
  const localPart = String(email || '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  return localPart || fallback;
};

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = undefined,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({
      email,
      password,
      name: name || deriveUserName({ email }),
    })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs),
  };
};

const createVerifiedUser = async ({
  email = nextEmail('realtime-user'),
  password = 'Password123!',
  name = undefined,
} = {}) => {
  const signup = await signupAndCaptureOtp({
    email,
    password,
    name: name || deriveUserName({ email }),
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

const loginUser = async ({ email, password }) => {
  const response = await request(app).post('/api/auth/login').send({
    email,
    password,
  });

  expect(response.status).toBe(200);

  return {
    accessToken: response.body.tokens.accessToken,
    refreshToken: response.body.tokens.refreshToken,
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

const expectRealtimeConnectError = async ({ baseUrl, token }) =>
  new Promise((resolve) => {
    const client = createSocketClient(baseUrl, {
      path: realtimeConfig.path,
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });

    client.on('connect_error', (error) => {
      client.close();
      resolve(error);
    });
  });

const emitWithAck = (client, event, payload = {}) =>
  new Promise((resolve) => {
    client.emit(event, payload, resolve);
  });

const waitForSocketEvent = (client, event) =>
  new Promise((resolve) => {
    client.once(event, resolve);
  });

const waitForDisconnect = (client) =>
  new Promise((resolve) => {
    client.once('disconnect', resolve);
  });

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

const createTicketRecord = async ({ workspaceId, contactId, subject }) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('_id defaultMailboxId')
    .lean();

  return Ticket.create({
    workspaceId,
    mailboxId: workspace.defaultMailboxId,
    number: await TicketCounter.allocateNextNumber(workspaceId),
    subject,
    contactId,
  });
};

describe('Realtime collaboration foundation', () => {
  maybeDbTest(
    'socket auth succeeds, room subscriptions acknowledge cleanly, and the publisher emits room envelopes',
    async () => {
      const owner = await createVerifiedUser();
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let client = null;

      try {
        client = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        const subscribeAck = await emitWithAck(client, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });

        expect(subscribeAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.workspace.subscribed',
            messageKey: 'success.ok',
          })
        );
        expect(subscribeAck.data).toEqual(
          expect.objectContaining({
            scope: 'workspace',
            workspaceId: owner.workspaceId,
            room: `workspace:${owner.workspaceId}`,
          })
        );

        const unsubscribeAck = await emitWithAck(
          client,
          'workspace.unsubscribe',
          {
            workspaceId: owner.workspaceId,
          }
        );

        expect(unsubscribeAck.ok).toBe(true);
        expect(unsubscribeAck.code).toBe('realtime.workspace.unsubscribed');

        await emitWithAck(client, 'workspace.subscribe', {
          workspaceId: owner.workspaceId,
        });

        const eventPromise = waitForSocketEvent(client, 'realtime.test');
        const emittedEnvelope = realtimePublisher.emitToWorkspace({
          workspaceId: owner.workspaceId,
          event: 'realtime.test',
          data: {
            ping: true,
          },
        });

        expect(emittedEnvelope).toEqual(
          expect.objectContaining({
            event: 'realtime.test',
            data: {
              ping: true,
            },
          })
        );
        expect(emittedEnvelope.eventId).toBeTruthy();
        expect(emittedEnvelope.occurredAt).toBeTruthy();

        const receivedEnvelope = await eventPromise;

        expect(receivedEnvelope).toEqual(
          expect.objectContaining({
            event: 'realtime.test',
            data: {
              ping: true,
            },
          })
        );
        expect(receivedEnvelope.eventId).toBeTruthy();
        expect(receivedEnvelope.occurredAt).toBeTruthy();
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );

  maybeDbTest(
    'invalid access tokens are rejected during the socket handshake',
    async () => {
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      try {
        const error = await expectRealtimeConnectError({
          baseUrl,
          token: 'not-a-valid-access-token',
        });

        expect(error.message).toBe('errors.auth.invalidToken');
        expect(error.data).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.auth.invalidToken',
            messageKey: 'errors.auth.invalidToken',
          })
        );
      } finally {
        await stopRealtimeRuntime({ httpServer });
      }
    }
  );

  maybeDbTest(
    'revoked or behaviorally invalidated sessions are rejected during the socket handshake',
    async () => {
      const owner = await createVerifiedUser();
      const revokedPayload = jwt.decode(owner.accessToken);

      await Session.updateOne(
        {
          _id: revokedPayload.sid,
        },
        {
          $set: {
            revokedAt: new Date(),
          },
        }
      );

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      try {
        const revokedError = await expectRealtimeConnectError({
          baseUrl,
          token: owner.accessToken,
        });

        expect(revokedError.message).toBe('errors.auth.sessionRevoked');
        expect(revokedError.data.messageKey).toBe('errors.auth.sessionRevoked');
      } finally {
        await stopRealtimeRuntime({ httpServer });
      }
    }
  );

  maybeDbTest(
    'old workspace-scoped access tokens are rejected after the session workspace switches',
    async () => {
      const memberUser = await createVerifiedUser({
        email: nextEmail('realtime-member-primary'),
      });
      const targetOwner = await createVerifiedUser({
        email: nextEmail('realtime-member-target-owner'),
      });

      const invite = await createInviteWithToken({
        workspaceId: targetOwner.workspaceId,
        accessToken: targetOwner.accessToken,
        email: memberUser.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      expect(invite.response.status).toBe(200);
      expect(invite.token).toBeTruthy();

      const accept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: invite.token,
          email: memberUser.email,
        });

      expect(accept.status).toBe(200);

      const login = await request(app).post('/api/auth/login').send({
        email: memberUser.email,
        password: memberUser.password,
      });

      expect(login.status).toBe(200);

      const oldAccessToken = login.body.tokens.accessToken;

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let staleClient = null;

      try {
        staleClient = await connectRealtimeClient({
          baseUrl,
          token: oldAccessToken,
        });

        const disconnectPromise = waitForDisconnect(staleClient);
        const switchResponse = await request(app)
          .post('/api/workspaces/switch')
          .set('Authorization', `Bearer ${oldAccessToken}`)
          .send({
            workspaceId: targetOwner.workspaceId,
          });

        expect(switchResponse.status).toBe(200);
        expect(switchResponse.body.accessToken).toBeTruthy();

        const error = await expectRealtimeConnectError({
          baseUrl,
          token: oldAccessToken,
        });
        const disconnectReason = await disconnectPromise;

        expect(error.message).toBe('errors.auth.sessionRevoked');
        expect(error.data.messageKey).toBe('errors.auth.sessionRevoked');
        expect(disconnectReason).toBe('io server disconnect');
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [staleClient],
        });
      }
    }
  );

  maybeDbTest(
    'logout disconnects realtime sockets for the current revoked session immediately',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-logout-owner'),
      });
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let client = null;

      try {
        client = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        const disconnectPromise = waitForDisconnect(client);
        const logoutResponse = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(logoutResponse.status).toBe(200);
        expect(logoutResponse.body.messageKey).toBe('success.auth.loggedOut');
        expect(await disconnectPromise).toBe('io server disconnect');
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );

  maybeDbTest(
    'logout-all disconnects realtime sockets for every revoked session immediately',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-logout-all-owner'),
      });
      const secondSession = await loginUser({
        email: owner.email,
        password: owner.password,
      });
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let firstClient = null;
      let secondClient = null;

      try {
        [firstClient, secondClient] = await Promise.all([
          connectRealtimeClient({
            baseUrl,
            token: owner.accessToken,
          }),
          connectRealtimeClient({
            baseUrl,
            token: secondSession.accessToken,
          }),
        ]);

        const firstDisconnectPromise = waitForDisconnect(firstClient);
        const secondDisconnectPromise = waitForDisconnect(secondClient);
        const logoutAllResponse = await request(app)
          .post('/api/auth/logout-all')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(logoutAllResponse.status).toBe(200);
        expect(logoutAllResponse.body.messageKey).toBe(
          'success.auth.loggedOutAll'
        );

        const [firstReason, secondReason] = await Promise.all([
          firstDisconnectPromise,
          secondDisconnectPromise,
        ]);

        expect(firstReason).toBe('io server disconnect');
        expect(secondReason).toBe('io server disconnect');
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [firstClient, secondClient],
        });
      }
    }
  );

  maybeDbTest(
    'change-password disconnects realtime sockets for all revoked sessions immediately',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-change-password-owner'),
      });
      const secondSession = await loginUser({
        email: owner.email,
        password: owner.password,
      });
      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let firstClient = null;
      let secondClient = null;

      try {
        [firstClient, secondClient] = await Promise.all([
          connectRealtimeClient({
            baseUrl,
            token: owner.accessToken,
          }),
          connectRealtimeClient({
            baseUrl,
            token: secondSession.accessToken,
          }),
        ]);

        const firstDisconnectPromise = waitForDisconnect(firstClient);
        const secondDisconnectPromise = waitForDisconnect(secondClient);
        const changePasswordResponse = await request(app)
          .post('/api/auth/change-password')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            currentPassword: owner.password,
            newPassword: 'Password456!',
          });

        expect(changePasswordResponse.status).toBe(200);
        expect(changePasswordResponse.body.messageKey).toBe(
          'success.auth.passwordChanged'
        );

        const [firstReason, secondReason] = await Promise.all([
          firstDisconnectPromise,
          secondDisconnectPromise,
        ]);

        expect(firstReason).toBe('io server disconnect');
        expect(secondReason).toBe('io server disconnect');
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [firstClient, secondClient],
        });
      }
    }
  );

  maybeDbTest(
    'reset-password disconnects realtime sockets for all revoked sessions immediately',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-reset-password-owner'),
      });
      const secondSession = await loginUser({
        email: owner.email,
        password: owner.password,
      });
      const forgot = await captureFallbackEmail(() =>
        request(app).post('/api/auth/forgot-password').send({
          email: owner.email,
        })
      );
      const resetCode = extractOtpCodeFromLogs(forgot.logs);

      expect(forgot.response.status).toBe(200);
      expect(resetCode).toBeTruthy();

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let firstClient = null;
      let secondClient = null;

      try {
        [firstClient, secondClient] = await Promise.all([
          connectRealtimeClient({
            baseUrl,
            token: owner.accessToken,
          }),
          connectRealtimeClient({
            baseUrl,
            token: secondSession.accessToken,
          }),
        ]);

        const firstDisconnectPromise = waitForDisconnect(firstClient);
        const secondDisconnectPromise = waitForDisconnect(secondClient);
        const resetResponse = await request(app).post('/api/auth/reset-password').send({
          email: owner.email,
          code: resetCode,
          newPassword: 'Password456!',
        });

        expect(resetResponse.status).toBe(200);
        expect(resetResponse.body.messageKey).toBe(
          'success.auth.passwordReset'
        );

        const [firstReason, secondReason] = await Promise.all([
          firstDisconnectPromise,
          secondDisconnectPromise,
        ]);

        expect(firstReason).toBe('io server disconnect');
        expect(secondReason).toBe('io server disconnect');
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [firstClient, secondClient],
        });
      }
    }
  );

  maybeDbTest(
    'inactive users and inactive members are rejected during the socket handshake',
    async () => {
      const suspendedUser = await createVerifiedUser({
        email: nextEmail('realtime-suspended-user'),
      });
      const suspendedMember = await createVerifiedUser({
        email: nextEmail('realtime-suspended-member'),
      });

      await Promise.all([
        User.updateOne(
          {
            _id: suspendedUser.userId,
          },
          {
            $set: {
              status: 'suspended',
            },
          }
        ),
        WorkspaceMember.updateOne(
          {
            workspaceId: suspendedMember.workspaceId,
            userId: suspendedMember.userId,
            deletedAt: null,
          },
          {
            $set: {
              status: 'suspended',
            },
          }
        ),
      ]);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      try {
        const [userError, memberError] = await Promise.all([
          expectRealtimeConnectError({
            baseUrl,
            token: suspendedUser.accessToken,
          }),
          expectRealtimeConnectError({
            baseUrl,
            token: suspendedMember.accessToken,
          }),
        ]);

        expect(userError.message).toBe('errors.auth.userSuspended');
        expect(userError.data.messageKey).toBe('errors.auth.userSuspended');
        expect(memberError.message).toBe('errors.auth.forbiddenTenant');
        expect(memberError.data.messageKey).toBe('errors.auth.forbiddenTenant');
      } finally {
        await stopRealtimeRuntime({ httpServer });
      }
    }
  );

  maybeDbTest(
    'workspace subscription rejects cross-workspace room requests even for authenticated sockets',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-workspace-owner'),
      });
      const foreignOwner = await createVerifiedUser({
        email: nextEmail('realtime-workspace-foreign-owner'),
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let client = null;

      try {
        client = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        const ack = await emitWithAck(client, 'workspace.subscribe', {
          workspaceId: foreignOwner.workspaceId,
        });

        expect(ack).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.auth.forbiddenTenant',
            messageKey: 'errors.auth.forbiddenTenant',
          })
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );

  maybeDbTest(
    'ticket subscription is tenant-safe and only joins tickets readable in the authenticated workspace',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-ticket-owner'),
      });
      const foreignOwner = await createVerifiedUser({
        email: nextEmail('realtime-ticket-foreign-owner'),
      });

      const [ownContact, foreignContact] = await Promise.all([
        createContactRecord({ workspaceId: owner.workspaceId }),
        createContactRecord({ workspaceId: foreignOwner.workspaceId }),
      ]);

      const [ownTicket, foreignTicket] = await Promise.all([
        createTicketRecord({
          workspaceId: owner.workspaceId,
          contactId: ownContact._id,
          subject: 'Realtime readable ticket',
        }),
        createTicketRecord({
          workspaceId: foreignOwner.workspaceId,
          contactId: foreignContact._id,
          subject: 'Realtime foreign ticket',
        }),
      ]);

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      let client = null;

      try {
        client = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        const ownAck = await emitWithAck(client, 'ticket.subscribe', {
          ticketId: String(ownTicket._id),
        });

        expect(ownAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.ticket.subscribed',
            messageKey: 'success.ok',
          })
        );
        expect(ownAck.data).toEqual(
          expect.objectContaining({
            scope: 'ticket',
            workspaceId: owner.workspaceId,
            ticketId: String(ownTicket._id),
            room: `ticket:${ownTicket._id}`,
          })
        );

        const foreignAck = await emitWithAck(client, 'ticket.subscribe', {
          ticketId: String(foreignTicket._id),
        });

        expect(foreignAck).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'errors.ticket.notFound',
            messageKey: 'errors.ticket.notFound',
          })
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );

  maybeDbTest(
    'realtime bootstrap endpoint returns the authenticated workspace summary and runtime flags',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-bootstrap-owner'),
      });

      const response = await request(app)
        .get('/api/realtime/bootstrap')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.messageKey).toBe('success.ok');
      expect(response.body.realtime).toEqual(
        expect.objectContaining({
          enabled: true,
          socketPath: realtimeConfig.path,
          transports: realtimeConfig.transports,
          auth: expect.objectContaining({
            userId: owner.userId,
            workspaceId: owner.workspaceId,
            roleKey: WORKSPACE_ROLES.OWNER,
          }),
          features: expect.objectContaining({
            roomSubscriptions: true,
            businessEvents: true,
            presence: true,
            typing: true,
            softClaim: true,
          }),
          collaboration: expect.objectContaining({
            requiresTicketSubscription: true,
            presenceTtlMs: realtimeConfig.collaboration.presenceTtlMs,
            typingTtlMs: realtimeConfig.collaboration.typingTtlMs,
            softClaimTtlMs: realtimeConfig.collaboration.softClaimTtlMs,
            actionThrottleMs: realtimeConfig.collaboration.actionThrottleMs,
          }),
          redis: expect.objectContaining({
            enabled: isRedisEnabled,
            adapterEnabled: isRealtimeRedisAdapterEnabled,
            connected: false,
            adapterConnected: false,
          }),
        })
      );
      expect(response.body.realtime.user._id).toBe(owner.userId);
      expect(response.body.realtime.workspace._id).toBe(owner.workspaceId);
    }
  );

  maybeDbTest(
    'realtime bootstrap reflects the active Redis runtime mode after live collaboration initializes',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('realtime-bootstrap-runtime-owner'),
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Realtime bootstrap runtime ticket',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let client = null;

      try {
        client = await connectRealtimeClient({
          baseUrl,
          token: owner.accessToken,
        });

        await Promise.all([
          waitForSocketEvent(client, 'ticket.presence.snapshot'),
          emitWithAck(client, 'ticket.subscribe', {
            ticketId: created.body.ticket._id,
          }),
        ]);

        const presenceAck = await emitWithAck(client, 'ticket.presence.set', {
          ticketId: created.body.ticket._id,
          state: 'viewing',
        });

        expect(presenceAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.ticket.presence.updated',
          })
        );

        const response = await request(app)
          .get('/api/realtime/bootstrap')
          .set('Authorization', `Bearer ${owner.accessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.realtime.redis).toEqual(
          expect.objectContaining({
            enabled: isRedisEnabled,
            connected: isRedisEnabled,
            adapterEnabled: isRealtimeRedisAdapterEnabled,
            adapterConnected:
              isRedisEnabled && isRealtimeRedisAdapterEnabled,
          })
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );
});
