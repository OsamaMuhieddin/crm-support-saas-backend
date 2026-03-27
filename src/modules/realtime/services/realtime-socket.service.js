import {
  buildRealtimeErrorAckFromError,
  sendSocketAck,
} from '../../../infra/realtime/contracts.js';
import { logRealtimeDebug, logRealtimeWarn } from '../../../infra/realtime/logger.js';
import {
  sessionRoomName,
  userRoomName,
} from '../../../infra/realtime/rooms.js';
import { refreshRealtimeSocketAuthContext } from '../../../infra/realtime/socket-auth.js';
import {
  cleanupDisconnectedSocketCollaboration,
  clearTicketSoftClaim,
  resetTicketCollaborationRuntime,
  setTicketPresence,
  setTicketSoftClaim,
  startTicketTyping,
  stopTicketTyping,
} from './ticket-collaboration.service.js';
import {
  subscribeTicketRoom,
  subscribeWorkspaceRoom,
  unsubscribeTicketRoom,
  unsubscribeWorkspaceRoom,
} from './realtime-subscriptions.service.js';

const bindAckHandler = (socket, handler) => async (payload = {}, ack) => {
  try {
    await refreshRealtimeSocketAuthContext(socket);

    const response = await handler({
      socket,
      payload,
    });

    sendSocketAck(ack, response);
  } catch (error) {
    const ackPayload = buildRealtimeErrorAckFromError(error);
    sendSocketAck(ack, ackPayload);

    if (String(ackPayload.messageKey || '').startsWith('errors.auth.')) {
      logRealtimeDebug('Disconnecting stale realtime socket after auth error.', {
        socketId: socket.id,
        messageKey: ackPayload.messageKey,
      });

      socket.disconnect(true);
      return;
    }

    logRealtimeDebug('Rejected realtime socket action.', {
      socketId: socket.id,
      messageKey: ackPayload.messageKey,
    });
  }
};

export const registerRealtimeSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    socket.join(userRoomName(socket.data.auth.userId));
    socket.join(sessionRoomName(socket.data.auth.sessionId));

    socket.on(
      'workspace.subscribe',
      bindAckHandler(socket, subscribeWorkspaceRoom)
    );
    socket.on(
      'workspace.unsubscribe',
      bindAckHandler(socket, unsubscribeWorkspaceRoom)
    );
    socket.on('ticket.subscribe', bindAckHandler(socket, subscribeTicketRoom));
    socket.on(
      'ticket.unsubscribe',
      bindAckHandler(socket, unsubscribeTicketRoom)
    );
    socket.on(
      'ticket.presence.set',
      bindAckHandler(socket, setTicketPresence)
    );
    socket.on(
      'ticket.typing.start',
      bindAckHandler(socket, startTicketTyping)
    );
    socket.on('ticket.typing.stop', bindAckHandler(socket, stopTicketTyping));
    socket.on(
      'ticket.soft_claim.set',
      bindAckHandler(socket, setTicketSoftClaim)
    );
    socket.on(
      'ticket.soft_claim.clear',
      bindAckHandler(socket, clearTicketSoftClaim)
    );
    socket.on('disconnect', () => {
      cleanupDisconnectedSocketCollaboration({
        socket,
      }).catch((error) => {
        logRealtimeWarn('Failed to cleanup realtime collaboration state on disconnect.', {
          socketId: socket.id,
          error: error?.message || 'unknown',
        });
      });
    });
  });
};

export const resetRealtimeSocketHandlersRuntime = () => {
  resetTicketCollaborationRuntime();
};
