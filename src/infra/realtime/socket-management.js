import { logRealtimeDebug, logRealtimeWarn } from './logger.js';
import { sessionRoomName, widgetSessionRoomName } from './rooms.js';
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

export const disconnectRealtimeSessionSocketsBatch = async ({
  sessionIds = [],
} = {}) => {
  const normalizedSessionIds = [
    ...new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .map((sessionId) => String(sessionId || '').trim())
        .filter(Boolean)
    ),
  ];

  if (normalizedSessionIds.length === 0) {
    return 0;
  }

  const disconnectedCounts = await Promise.all(
    normalizedSessionIds.map((sessionId) =>
      disconnectRealtimeSessionSockets({
        sessionId,
      })
    )
  );

  return disconnectedCounts.reduce(
    (total, current) => total + Number(current || 0),
    0
  );
};

export const disconnectRealtimeWidgetSessionSockets = async ({
  widgetSessionId,
} = {}) => {
  const normalizedWidgetSessionId = String(widgetSessionId || '').trim();

  if (!normalizedWidgetSessionId) {
    return 0;
  }

  const io = getRealtimeServer();

  if (!io) {
    return 0;
  }

  const room = widgetSessionRoomName(normalizedWidgetSessionId);

  try {
    const sockets = await io.in(room).fetchSockets();

    if (sockets.length === 0) {
      return 0;
    }

    logRealtimeDebug('Disconnecting widget realtime session sockets.', {
      widgetSessionId: normalizedWidgetSessionId,
      sockets: sockets.length,
    });

    io.in(room).disconnectSockets(true);
    return sockets.length;
  } catch (error) {
    logRealtimeWarn('Failed to disconnect widget realtime session sockets.', {
      widgetSessionId: normalizedWidgetSessionId,
      error: error?.message || 'unknown',
    });

    return 0;
  }
};

export const disconnectRealtimeWidgetSessionSocketsBatch = async ({
  widgetSessionIds = [],
} = {}) => {
  const normalizedWidgetSessionIds = [
    ...new Set(
      (Array.isArray(widgetSessionIds) ? widgetSessionIds : [])
        .map((widgetSessionId) => String(widgetSessionId || '').trim())
        .filter(Boolean)
    ),
  ];

  if (normalizedWidgetSessionIds.length === 0) {
    return 0;
  }

  const disconnectedCounts = await Promise.all(
    normalizedWidgetSessionIds.map((widgetSessionId) =>
      disconnectRealtimeWidgetSessionSockets({
        widgetSessionId,
      })
    )
  );

  return disconnectedCounts.reduce(
    (total, current) => total + Number(current || 0),
    0
  );
};
