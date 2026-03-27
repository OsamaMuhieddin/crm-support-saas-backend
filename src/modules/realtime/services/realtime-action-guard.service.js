import { realtimeConfig } from '../../../config/realtime.config.js';
import { createError } from '../../../shared/errors/createError.js';
import { logRealtimeDebug } from '../../../infra/realtime/logger.js';

const recentActionEntries = new Map();

const buildActionKey = ({ socketId, eventName, ticketId }) =>
  `${String(socketId)}:${String(eventName)}:${String(ticketId || '')}`;

const isWithinThrottleWindow = ({ timestamp, now, throttleMs }) =>
  throttleMs > 0 && now - timestamp < throttleMs;

export const assertRealtimeActionAllowed = ({
  socketId,
  eventName,
  ticketId,
  fingerprint = '',
}) => {
  const throttleMs = realtimeConfig.collaboration.actionThrottleMs;

  if (throttleMs <= 0) {
    return {
      duplicateWithinThrottleWindow: false,
    };
  }

  const now = Date.now();
  const key = buildActionKey({
    socketId,
    eventName,
    ticketId,
  });
  const previous = recentActionEntries.get(key);

  if (
    previous &&
    isWithinThrottleWindow({
      timestamp: previous.timestamp,
      now,
      throttleMs,
    })
  ) {
    if (previous.fingerprint === fingerprint) {
      return {
        duplicateWithinThrottleWindow: true,
      };
    }

    logRealtimeDebug('Rate limited realtime collaboration action.', {
      socketId,
      eventName,
      ticketId,
      throttleMs,
    });

    throw createError('errors.realtime.rateLimited', 429, {
      throttleMs,
    });
  }

  recentActionEntries.set(key, {
    fingerprint,
    timestamp: now,
  });

  return {
    duplicateWithinThrottleWindow: false,
  };
};

export const clearRealtimeActionGuardForSocket = ({ socketId }) => {
  const normalizedSocketId = String(socketId || '');

  for (const key of recentActionEntries.keys()) {
    if (key.startsWith(`${normalizedSocketId}:`)) {
      recentActionEntries.delete(key);
    }
  }
};

export const resetRealtimeActionGuardRuntime = () => {
  recentActionEntries.clear();
};
