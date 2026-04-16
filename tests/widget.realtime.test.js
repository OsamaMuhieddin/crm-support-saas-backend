import request from 'supertest';
import { io as createSocketClient } from 'socket.io-client';
import app from '../src/app.js';
import { realtimeConfig } from '../src/config/realtime.config.js';
import { createHttpServer } from '../src/server.js';
import { shutdownRealtime } from '../src/infra/realtime/index.js';
import { WidgetSession } from '../src/modules/widget/models/widget-session.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';
import { hashValue } from '../src/shared/utils/security.js';
import {
  captureFallbackEmail,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { setWorkspaceBillingPlanForTests } from './helpers/billing.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const deriveUserName = ({ email, fallback = 'Widget Realtime User' }) => {
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
  email,
  password = 'Password123!',
  name = undefined,
}) => {
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

  await setWorkspaceBillingPlanForTests({
    workspaceId: verify.body.user.defaultWorkspaceId,
    planKey: 'business',
  });

  return {
    email,
    password,
    userId: verify.body.user._id,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
  };
};

const createMailbox = async ({
  accessToken,
  name,
  emailAddress,
}) =>
  request(app)
    .post('/api/mailboxes')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      emailAddress,
    });

const createWidget = async ({
  accessToken,
  name,
  mailboxId,
}) =>
  request(app)
    .post('/api/widgets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      mailboxId,
    });

const initializePublicWidgetSession = async ({
  publicKey,
  sessionToken = undefined,
}) => {
  const body = {};

  if (sessionToken !== undefined) {
    body.sessionToken = sessionToken;
  }

  return request(app).post(`/api/widgets/public/${publicKey}/session`).send(body);
};

const createPublicWidgetMessage = async ({
  publicKey,
  sessionToken,
  email = undefined,
  message,
}) => {
  const body = {
    sessionToken,
    message,
  };

  if (email !== undefined) {
    body.email = email;
  }

  return request(app).post(`/api/widgets/public/${publicKey}/messages`).send(body);
};

const requestPublicWidgetRecovery = async ({ publicKey, email }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/request`)
    .send({ email });

const verifyPublicWidgetRecovery = async ({ publicKey, email, code }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/verify`)
    .send({ email, code });

const continuePublicWidgetRecovery = async ({ publicKey, recoveryToken }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/continue`)
    .send({ recoveryToken });

const startNewPublicWidgetRecovery = async ({ publicKey, recoveryToken }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/start-new`)
    .send({ recoveryToken });

const createAgentReply = async ({
  accessToken,
  ticketId,
  bodyText,
}) =>
  request(app)
    .post(`/api/tickets/${ticketId}/messages`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      type: 'public_reply',
      bodyText,
    });

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

const connectWidgetRealtimeClient = async ({ baseUrl, widgetSessionToken }) =>
  new Promise((resolve, reject) => {
    const client = createSocketClient(baseUrl, {
      path: realtimeConfig.path,
      transports: ['websocket'],
      auth: {
        widgetSessionToken,
      },
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

const expectRealtimeConnectError = async ({ baseUrl, widgetSessionToken }) =>
  new Promise((resolve) => {
    const client = createSocketClient(baseUrl, {
      path: realtimeConfig.path,
      transports: ['websocket'],
      auth: {
        widgetSessionToken,
      },
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });

    client.on('connect_error', (error) => {
      client.close();
      resolve(error);
    });
  });

const emitWithAck = (client, event, payload = {}, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ack: ${event}`));
    }, timeoutMs);

    client.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

const waitForSocketEvent = (client, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, handleEvent);
      reject(new Error(`Timed out waiting for socket event: ${event}`));
    }, timeoutMs);

    const handleEvent = (payload) => {
      clearTimeout(timer);
      client.off(event, handleEvent);
      resolve(payload);
    };

    client.on(event, handleEvent);
  });

const waitForDisconnect = (client, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('disconnect', handleDisconnect);
      reject(new Error('Timed out waiting for socket disconnect'));
    }, timeoutMs);

    const handleDisconnect = (reason) => {
      clearTimeout(timer);
      client.off('disconnect', handleDisconnect);
      resolve(reason);
    };

    client.on('disconnect', handleDisconnect);
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

const loadWidgetSessionByToken = async ({ workspaceId, token }) =>
  WidgetSession.findOne({
    workspaceId,
    publicSessionKeyHash: hashValue(token),
    deletedAt: null,
  }).lean();

describe('Widget public realtime', () => {
  maybeDbTest(
    'valid widget sessions connect and widget.subscribe returns the current public snapshot',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-auth-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Auth Mailbox',
        emailAddress: 'widget-realtime-auth-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Auth Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      expect(initialized.status).toBe(200);

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let client = null;

      try {
        client = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        const subscribeAck = await emitWithAck(client, 'widget.subscribe');

        expect(subscribeAck).toEqual(
          expect.objectContaining({
            ok: true,
            code: 'realtime.widget.subscribed',
            messageKey: 'success.ok',
          })
        );
        expect(subscribeAck.data).toEqual(
          expect.objectContaining({
            scope: 'widget',
            widgetPublicKey: widget.body.widget.publicKey,
            snapshot: expect.objectContaining({
              session: expect.objectContaining({
                token: initialized.body.session.token,
              }),
              conversation: expect.objectContaining({
                state: 'idle',
                messageCount: 0,
              }),
              realtime: expect.objectContaining({
                subscribeEvent: 'widget.subscribe',
              }),
            }),
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
    'invalid widget tokens and valid recovery tokens are both rejected for realtime auth',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-reject-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Reject Mailbox',
        emailAddress: 'widget-realtime-reject-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Reject Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: initialized.body.session.token,
        email: 'widget-realtime-reject@example.com',
        message: 'Recovery candidate message.',
      });

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-realtime-reject@example.com',
        })
      );
      const recoveryCode = extractOtpCodeFromLogs(recoveryRequest.logs);
      const recoveryVerify = await verifyPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        email: 'widget-realtime-reject@example.com',
        code: recoveryCode,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();

      try {
        const [invalidTokenError, recoveryTokenError] = await Promise.all([
          expectRealtimeConnectError({
            baseUrl,
            widgetSessionToken: 'not-a-valid-widget-session-token',
          }),
          expectRealtimeConnectError({
            baseUrl,
            widgetSessionToken: recoveryVerify.body.recovery.token,
          }),
        ]);

        expect(invalidTokenError.message).toBe('errors.auth.invalidToken');
        expect(invalidTokenError.data.messageKey).toBe('errors.auth.invalidToken');
        expect(recoveryTokenError.message).toBe('errors.auth.invalidToken');
        expect(recoveryTokenError.data.messageKey).toBe('errors.auth.invalidToken');
      } finally {
        await stopRealtimeRuntime({ httpServer });
      }
    }
  );

  maybeDbTest(
    'stale widget subscribe acks use the standard auth error shape and disconnect the socket',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-stale-ack-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Stale Ack Mailbox',
        emailAddress: 'widget-realtime-stale-ack-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Stale Ack Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      const session = await loadWidgetSessionByToken({
        workspaceId: owner.workspaceId,
        token: initialized.body.session.token,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let client = null;

      try {
        client = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        await WidgetSession.updateOne(
          {
            _id: session._id,
          },
          {
            $set: {
              invalidatedAt: new Date(),
              invalidationReason: 'test_stale_socket',
              publicSessionKeyHash: null,
            },
          }
        );

        const disconnectPromise = waitForDisconnect(client);
        const subscribeAck = await emitWithAck(client, 'widget.subscribe');

        expect(subscribeAck).toEqual({
          ok: false,
          code: 'errors.auth.invalidToken',
          messageKey: 'errors.auth.invalidToken',
          data: null,
        });
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
    'recovery continue disconnects and invalidates the replaced widget session token',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-recovery-replace-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Recovery Replace Mailbox',
        emailAddress: 'widget-realtime-recovery-replace-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Recovery Replace Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: initialized.body.session.token,
        email: 'widget-realtime-recovery-replace@example.com',
        message: 'Recover and replace this browser session.',
      });

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-realtime-recovery-replace@example.com',
        })
      );
      const recoveryCode = extractOtpCodeFromLogs(recoveryRequest.logs);

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let originalClient = null;
      let continuedClient = null;

      try {
        originalClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        await emitWithAck(originalClient, 'widget.subscribe');

        const disconnectPromise = waitForDisconnect(originalClient);
        const recoveryVerify = await verifyPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-realtime-recovery-replace@example.com',
          code: recoveryCode,
        });
        const continued = await continuePublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          recoveryToken: recoveryVerify.body.recovery.token,
        });

        expect(await disconnectPromise).toBe('io server disconnect');

        const staleError = await expectRealtimeConnectError({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });
        expect(staleError.message).toBe('errors.auth.invalidToken');
        expect(staleError.data.messageKey).toBe('errors.auth.invalidToken');

        continuedClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: continued.body.session.token,
        });

        const subscribeAck = await emitWithAck(
          continuedClient,
          'widget.subscribe'
        );
        expect(subscribeAck.ok).toBe(true);
        expect(subscribeAck.data.snapshot.session.token).toBe(
          continued.body.session.token
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [originalClient, continuedClient],
        });
      }
    }
  );

  maybeDbTest(
    'widget live events are scoped to the subscribed widget session and do not leak across sessions',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-events-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Events Mailbox',
        emailAddress: 'widget-realtime-events-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Realtime Events Widget',
        mailboxId: mailbox.body.mailbox._id,
      });

      const sessionAInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      const sessionBInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: sessionAInit.body.session.token,
        email: 'widget-realtime-events-a@example.com',
        message: 'Conversation A first message.',
      });
      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: sessionBInit.body.session.token,
        email: 'widget-realtime-events-b@example.com',
        message: 'Conversation B first message.',
      });

      const [sessionA, sessionB] = await Promise.all([
        loadWidgetSessionByToken({
          workspaceId: owner.workspaceId,
          token: sessionAInit.body.session.token,
        }),
        loadWidgetSessionByToken({
          workspaceId: owner.workspaceId,
          token: sessionBInit.body.session.token,
        }),
      ]);

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let clientA = null;
      let clientB = null;

      try {
        [clientA, clientB] = await Promise.all([
          connectWidgetRealtimeClient({
            baseUrl,
            widgetSessionToken: sessionAInit.body.session.token,
          }),
          connectWidgetRealtimeClient({
            baseUrl,
            widgetSessionToken: sessionBInit.body.session.token,
          }),
        ]);

        await Promise.all([
          emitWithAck(clientA, 'widget.subscribe'),
          emitWithAck(clientB, 'widget.subscribe'),
        ]);

        const messageCreatedPromise = waitForSocketEvent(
          clientA,
          'widget.message.created'
        );
        const conversationUpdatedPromise = waitForSocketEvent(
          clientA,
          'widget.conversation.updated'
        );
        const noLeakMessagePromise = expectNoSocketEvent(
          clientB,
          'widget.message.created'
        );
        const noLeakConversationPromise = expectNoSocketEvent(
          clientB,
          'widget.conversation.updated'
        );

        const reply = await createAgentReply({
          accessToken: owner.accessToken,
          ticketId: sessionA.ticketId,
          bodyText: 'Agent realtime reply for A.',
        });

        expect(reply.status).toBe(200);

        const [messageEnvelope, conversationEnvelope] = await Promise.all([
          messageCreatedPromise,
          conversationUpdatedPromise,
        ]);
        await Promise.all([noLeakMessagePromise, noLeakConversationPromise]);

        expect(messageEnvelope).toEqual(
          expect.objectContaining({
            event: 'widget.message.created',
            workspaceId: null,
            actorUserId: null,
            data: expect.objectContaining({
              message: expect.objectContaining({
                type: 'public_reply',
                bodyText: 'Agent realtime reply for A.',
                sender: 'agent',
              }),
              conversation: expect.objectContaining({
                messageCount: 2,
                ticketStatus: 'waiting_on_customer',
              }),
            }),
          })
        );
        expect(conversationEnvelope).toEqual(
          expect.objectContaining({
            event: 'widget.conversation.updated',
            workspaceId: null,
            actorUserId: null,
            data: expect.objectContaining({
              conversation: expect.objectContaining({
                state: 'active',
                messageCount: 2,
              }),
            }),
          })
        );

        const untouchedTicket = await Ticket.findById(sessionB.ticketId).lean();
        expect(untouchedTicket.messageCount).toBe(1);
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [clientA, clientB],
        });
      }
    }
  );

  maybeDbTest(
    'widget deactivation disconnects current widget sockets and blocks reconnect until reactivated',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-deactivate-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Deactivate Mailbox',
        emailAddress: 'widget-realtime-deactivate-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Deactivate Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let client = null;
      let reactivatedClient = null;

      try {
        client = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        await emitWithAck(client, 'widget.subscribe');

        const disconnectPromise = waitForDisconnect(client);
        const deactivateResponse = await request(app)
          .post(`/api/widgets/${widget.body.widget._id}/deactivate`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(deactivateResponse.status).toBe(200);
        expect(await disconnectPromise).toBe('io server disconnect');

        const inactiveError = await expectRealtimeConnectError({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });
        expect(inactiveError.message).toBe('errors.auth.invalidToken');
        expect(inactiveError.data.messageKey).toBe('errors.auth.invalidToken');

        const reactivateResponse = await request(app)
          .post(`/api/widgets/${widget.body.widget._id}/activate`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(reactivateResponse.status).toBe(200);

        reactivatedClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        const subscribeAck = await emitWithAck(
          reactivatedClient,
          'widget.subscribe'
        );
        expect(subscribeAck.ok).toBe(true);
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client, reactivatedClient],
        });
      }
    }
  );

  maybeDbTest(
    'inactive widget mailboxes suppress widget live events without widening widget session scope',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-mailbox-inactive-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Mailbox Inactive Mailbox',
        emailAddress: 'widget-realtime-mailbox-inactive-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Mailbox Inactive Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: initialized.body.session.token,
        email: 'widget-realtime-mailbox-inactive@example.com',
        message: 'Initial customer message before mailbox deactivation.',
      });

      const session = await loadWidgetSessionByToken({
        workspaceId: owner.workspaceId,
        token: initialized.body.session.token,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let client = null;

      try {
        client = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        await emitWithAck(client, 'widget.subscribe');

        const deactivateMailboxResponse = await request(app)
          .post(`/api/mailboxes/${mailbox.body.mailbox._id}/deactivate`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});
        expect(deactivateMailboxResponse.status).toBe(200);

        const reply = await createAgentReply({
          accessToken: owner.accessToken,
          ticketId: session.ticketId,
          bodyText: 'This reply should not emit to the widget client.',
        });
        expect(reply.status).toBe(200);

        await Promise.all([
          expectNoSocketEvent(client, 'widget.message.created'),
          expectNoSocketEvent(client, 'widget.conversation.updated'),
        ]);
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [client],
        });
      }
    }
  );

  maybeDbTest(
    'widget clients can reconnect with the same session token and resubscribe to the current snapshot',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-reconnect-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Reconnect Mailbox',
        emailAddress: 'widget-realtime-reconnect-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Reconnect Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const initialized = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: initialized.body.session.token,
        email: 'widget-realtime-reconnect@example.com',
        message: 'Reconnect first customer message.',
      });

      const session = await loadWidgetSessionByToken({
        workspaceId: owner.workspaceId,
        token: initialized.body.session.token,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let firstClient = null;
      let secondClient = null;

      try {
        firstClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });
        await emitWithAck(firstClient, 'widget.subscribe');
        await closeSocketClient(firstClient);
        firstClient = null;

        const reply = await createAgentReply({
          accessToken: owner.accessToken,
          ticketId: session.ticketId,
          bodyText: 'Reconnect agent reply.',
        });
        expect(reply.status).toBe(200);

        secondClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: initialized.body.session.token,
        });

        const subscribeAck = await emitWithAck(secondClient, 'widget.subscribe');

        expect(subscribeAck.ok).toBe(true);
        expect(subscribeAck.data.snapshot.conversation).toEqual(
          expect.objectContaining({
            messageCount: 2,
            ticketStatus: 'waiting_on_customer',
            messages: [
              expect.objectContaining({
                bodyText: 'Reconnect first customer message.',
              }),
              expect.objectContaining({
                bodyText: 'Reconnect agent reply.',
              }),
            ],
          })
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [firstClient, secondClient],
        });
      }
    }
  );

  maybeDbTest(
    'recovered continue sessions reconnect to the recovered ticket and start-new sessions switch cleanly to a new ticket',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-realtime-recovery-owner@example.com',
      });
      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Recovery Mailbox',
        emailAddress: 'widget-realtime-recovery-mailbox@example.com',
      });
      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Widget Recovery Widget',
        mailboxId: mailbox.body.mailbox._id,
      });

      const initial = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: initial.body.session.token,
        email: 'widget-realtime-recovery@example.com',
        message: 'Original recoverable conversation.',
      });

      const originalSession = await loadWidgetSessionByToken({
        workspaceId: owner.workspaceId,
        token: initial.body.session.token,
      });

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-realtime-recovery@example.com',
        })
      );
      const recoveryCode = extractOtpCodeFromLogs(recoveryRequest.logs);
      const recoveryVerify = await verifyPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        email: 'widget-realtime-recovery@example.com',
        code: recoveryCode,
      });
      const continued = await continuePublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        recoveryToken: recoveryVerify.body.recovery.token,
      });

      const continueSession = await loadWidgetSessionByToken({
        workspaceId: owner.workspaceId,
        token: continued.body.session.token,
      });

      const { httpServer, baseUrl } = await startRealtimeRuntime();
      let continueClient = null;
      let startNewClient = null;

      try {
        continueClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: continued.body.session.token,
        });

        await emitWithAck(continueClient, 'widget.subscribe');

        const continueMessagePromise = waitForSocketEvent(
          continueClient,
          'widget.message.created'
        );

        const oldReply = await createAgentReply({
          accessToken: owner.accessToken,
          ticketId: continueSession.ticketId,
          bodyText: 'Recovered continue reply.',
        });
        expect(oldReply.status).toBe(200);

        expect((await continueMessagePromise).data.message.bodyText).toBe(
          'Recovered continue reply.'
        );

        await request(app)
          .post(`/api/tickets/${originalSession.ticketId}/solve`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        await request(app)
          .post(`/api/tickets/${originalSession.ticketId}/close`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        await OtpCode.updateMany(
          {
            emailNormalized: 'widget-realtime-recovery@example.com',
            purpose: 'widgetRecovery',
          },
          {
            $set: {
              lastSentAt: new Date(Date.now() - 10 * 60 * 1000),
            },
          }
        );

        const secondRecoveryRequest = await captureFallbackEmail(() =>
          requestPublicWidgetRecovery({
            publicKey: widget.body.widget.publicKey,
            email: 'widget-realtime-recovery@example.com',
          })
        );
        const secondRecoveryCode = extractOtpCodeFromLogs(
          secondRecoveryRequest.logs
        );
        const secondRecoveryVerify = await verifyPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-realtime-recovery@example.com',
          code: secondRecoveryCode,
        });
        const continuedDisconnectPromise = waitForDisconnect(continueClient);
        const startedNew = await startNewPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          recoveryToken: secondRecoveryVerify.body.recovery.token,
        });

        expect(await continuedDisconnectPromise).toBe('io server disconnect');

        const staleContinueError = await expectRealtimeConnectError({
          baseUrl,
          widgetSessionToken: continued.body.session.token,
        });
        expect(staleContinueError.message).toBe('errors.auth.invalidToken');
        expect(staleContinueError.data.messageKey).toBe(
          'errors.auth.invalidToken'
        );

        await createPublicWidgetMessage({
          publicKey: widget.body.widget.publicKey,
          sessionToken: startedNew.body.session.token,
          message: 'New conversation after recovery start-new.',
        });

        const startNewSession = await loadWidgetSessionByToken({
          workspaceId: owner.workspaceId,
          token: startedNew.body.session.token,
        });

        startNewClient = await connectWidgetRealtimeClient({
          baseUrl,
          widgetSessionToken: startedNew.body.session.token,
        });

        const startNewSubscribeAck = await emitWithAck(
          startNewClient,
          'widget.subscribe'
        );

        expect(startNewSubscribeAck.data.snapshot.conversation).toEqual(
          expect.objectContaining({
            messageCount: 1,
            messages: [
              expect.objectContaining({
                bodyText: 'New conversation after recovery start-new.',
              }),
            ],
          })
        );
        expect(String(startNewSession.ticketId)).not.toBe(
          String(continueSession.ticketId)
        );

        const startNewMessagePromise = waitForSocketEvent(
          startNewClient,
          'widget.message.created'
        );

        const newReply = await createAgentReply({
          accessToken: owner.accessToken,
          ticketId: startNewSession.ticketId,
          bodyText: 'Recovered start-new reply.',
        });
        expect(newReply.status).toBe(200);

        expect((await startNewMessagePromise).data.message.bodyText).toBe(
          'Recovered start-new reply.'
        );
      } finally {
        await stopRealtimeRuntime({
          httpServer,
          clients: [continueClient, startNewClient],
        });
      }
    }
  );
});
