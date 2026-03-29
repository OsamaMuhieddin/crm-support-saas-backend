import { io as createSocketClient } from 'socket.io-client';

const baseUrl =
  process.env.REALTIME_BASE_URL ||
  process.env.APP_BASE_URL ||
  'http://127.0.0.1:5000';
const accessToken = process.env.REALTIME_ACCESS_TOKEN;
const ticketId = process.env.REALTIME_TICKET_ID || null;
const presenceState = process.env.REALTIME_PRESENCE_STATE || 'viewing';

if (!accessToken) {
  console.error('REALTIME_ACCESS_TOKEN is required.');
  process.exit(1);
}

const requestJson = async (path, token) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      `Request failed: ${response.status} ${JSON.stringify(body, null, 2)}`
    );
  }

  return body;
};

const emitWithAck = (client, event, payload = {}) =>
  new Promise((resolve) => {
    client.emit(event, payload, resolve);
  });

const main = async () => {
  const bootstrap = await requestJson('/api/realtime/bootstrap', accessToken);
  const workspaceId = bootstrap.realtime.auth.workspaceId;
  const socketPath = bootstrap.realtime.socketPath;

  console.log('Realtime bootstrap:', {
    workspaceId,
    socketPath,
    features: bootstrap.realtime.features,
    redis: bootstrap.realtime.redis,
  });

  const client = createSocketClient(baseUrl, {
    path: socketPath,
    transports: ['websocket'],
    auth: {
      token: accessToken,
    },
    reconnection: false,
    forceNew: true,
    timeout: 5000,
  });

  const closeAndExit = (code = 0) => {
    client.close();
    process.exit(code);
  };

  client.on('connect', async () => {
    console.log(`Connected socket: ${client.id}`);

    const workspaceAck = await emitWithAck(client, 'workspace.subscribe', {
      workspaceId,
    });
    console.log('workspace.subscribe ack:', workspaceAck);

    if (ticketId) {
      const snapshotPromise = new Promise((resolve) => {
        client.once('ticket.presence.snapshot', resolve);
      });

      const ticketAck = await emitWithAck(client, 'ticket.subscribe', {
        ticketId,
      });
      console.log('ticket.subscribe ack:', ticketAck);
      console.log('ticket.presence.snapshot:', await snapshotPromise);

      const presenceAck = await emitWithAck(client, 'ticket.presence.set', {
        ticketId,
        state: presenceState,
      });
      console.log('ticket.presence.set ack:', presenceAck);
    }
  });

  client.on('connect_error', (error) => {
    console.error('Socket connect_error:', error.message, error.data || null);
    closeAndExit(1);
  });

  client.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
  });

  client.onAny((event, payload) => {
    console.log(`[socket] ${event}`, payload);
  });

  process.on('SIGINT', () => closeAndExit(0));
  process.on('SIGTERM', () => closeAndExit(0));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
