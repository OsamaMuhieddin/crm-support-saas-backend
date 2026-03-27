import { randomUUID } from 'node:crypto';

export const buildRealtimeAck = ({
  ok = true,
  code = ok ? 'success.ok' : 'errors.unknown',
  messageKey = ok ? 'success.ok' : 'errors.unknown',
  data = null,
} = {}) => ({
  ok: Boolean(ok),
  code,
  messageKey,
  data,
});

export const buildRealtimeErrorAck = ({
  code = 'errors.unknown',
  messageKey = code,
  data = null,
} = {}) =>
  buildRealtimeAck({
    ok: false,
    code,
    messageKey,
    data,
  });

export const buildRealtimeEventEnvelope = ({
  event,
  data = null,
  workspaceId = null,
  actorUserId = null,
  eventId = randomUUID(),
  occurredAt = new Date().toISOString(),
}) => ({
  event,
  eventId,
  occurredAt,
  workspaceId,
  actorUserId,
  data,
});

export const buildRealtimeErrorAckFromError = (error) => {
  const messageKey = error?.messageKey || 'errors.unknown';
  const payload = {};

  if (error?.args && typeof error.args === 'object') {
    payload.args = error.args;
  }

  if (Array.isArray(error?.data)) {
    payload.errors = error.data;
  } else if (error?.data !== undefined && error?.data !== null) {
    payload.details = error.data;
  }

  return buildRealtimeErrorAck({
    code: messageKey,
    messageKey,
    data: Object.keys(payload).length > 0 ? payload : null,
  });
};

export const createSocketIoErrorFromError = (error) => {
  const messageKey = error?.messageKey || 'errors.unknown';
  const socketError = new Error(messageKey);
  socketError.data = buildRealtimeErrorAckFromError(error);
  return socketError;
};

export const sendSocketAck = (ack, payload) => {
  if (typeof ack === 'function') {
    ack(payload);
  }
};
