import { logRealtimeDebug, logRealtimeWarn } from './logger.js';
import { sessionRoomName } from './rooms.js';
import { getRealtimeServer } from './server-state.js';

export const disconnectRealtimeSessionSockets = async ({ sessionId } = {}) => {
  const normalizedSessionId = String(sessionId || '').trim();

  if (!normalizedSessionId) {
    return 0;
  }

  const io = getRealtimeServer();

  if (!io) {
    return 0;
  }

  const room = sessionRoomName(normalizedSessionId);

  try {
    const sockets = await io.in(room).fetchSockets();

    if (sockets.length === 0) {
      return 0;
    }

    logRealtimeDebug('Disconnecting realtime session sockets.', {
      sessionId: normalizedSessionId,
      sockets: sockets.length,
    });

    io.in(room).disconnectSockets(true);
    return sockets.length;
  } catch (error) {
    logRealtimeWarn('Failed to disconnect realtime session sockets.', {
      sessionId: normalizedSessionId,
      error: error?.message || 'unknown',
    });

    return 0;
  }
};
