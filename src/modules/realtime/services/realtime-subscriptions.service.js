import mongoose from 'mongoose';
import { findTicketInWorkspaceOrThrow } from '../../tickets/services/ticket-query.service.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildRealtimeAck } from '../../../infra/realtime/contracts.js';
import {
  ticketRoomName,
  widgetSessionRoomName,
  workspaceRoomName,
} from '../../../infra/realtime/rooms.js';
import { initializePublicWidgetSession } from '../../widget/services/widget-public.service.js';
import {
  clearSocketTicketCollaboration,
  emitTicketCollaborationSnapshot,
} from './ticket-collaboration.service.js';

const assertObjectIdOrThrow = (value, field) => {
  const normalized = String(value || '').trim();

  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    throw createError('errors.validation.invalidId', 422, {
      field,
    });
  }

  return normalized;
};

const resolveWorkspaceSubscriptionId = ({ authWorkspaceId, payload }) => {
  const requestedWorkspaceId = payload?.workspaceId;

  if (requestedWorkspaceId === undefined || requestedWorkspaceId === null) {
    return String(authWorkspaceId);
  }

  const normalizedWorkspaceId = assertObjectIdOrThrow(
    requestedWorkspaceId,
    'workspaceId'
  );

  if (String(normalizedWorkspaceId) !== String(authWorkspaceId)) {
    throw createError('errors.auth.forbiddenTenant', 403);
  }

  return normalizedWorkspaceId;
};

const buildSubscriptionAck = ({
  scope,
  action,
  room,
  workspaceId,
  ticketId = null,
}) =>
  buildRealtimeAck({
    ok: true,
    code: `realtime.${scope}.${action}`,
    messageKey: 'success.ok',
    data: {
      scope,
      room,
      workspaceId: String(workspaceId),
      ticketId: ticketId ? String(ticketId) : null,
    },
  });

export const subscribeWorkspaceRoom = async ({ socket, payload }) => {
  const workspaceId = resolveWorkspaceSubscriptionId({
    authWorkspaceId: socket.data.auth.workspaceId,
    payload,
  });
  const room = workspaceRoomName(workspaceId);

  await socket.join(room);

  return buildSubscriptionAck({
    scope: 'workspace',
    action: 'subscribed',
    room,
    workspaceId,
  });
};

export const unsubscribeWorkspaceRoom = async ({ socket, payload }) => {
  const workspaceId = resolveWorkspaceSubscriptionId({
    authWorkspaceId: socket.data.auth.workspaceId,
    payload,
  });
  const room = workspaceRoomName(workspaceId);

  await socket.leave(room);

  return buildSubscriptionAck({
    scope: 'workspace',
    action: 'unsubscribed',
    room,
    workspaceId,
  });
};

const loadReadableTicketOrThrow = async ({ workspaceId, ticketId }) => {
  await findTicketInWorkspaceOrThrow({
    workspaceId,
    ticketId,
    lean: true,
    projection: '_id workspaceId',
  });
};

export const subscribeTicketRoom = async ({ socket, payload }) => {
  const workspaceId = String(socket.data.auth.workspaceId);
  const ticketId = assertObjectIdOrThrow(payload?.ticketId, 'ticketId');

  await loadReadableTicketOrThrow({
    workspaceId,
    ticketId,
  });

  const room = ticketRoomName(ticketId);
  await socket.join(room);
  await emitTicketCollaborationSnapshot({
    socket,
    ticketId,
  });

  return buildSubscriptionAck({
    scope: 'ticket',
    action: 'subscribed',
    room,
    workspaceId,
    ticketId,
  });
};

export const unsubscribeTicketRoom = async ({ socket, payload }) => {
  const workspaceId = String(socket.data.auth.workspaceId);
  const ticketId = assertObjectIdOrThrow(payload?.ticketId, 'ticketId');

  await loadReadableTicketOrThrow({
    workspaceId,
    ticketId,
  });

  const room = ticketRoomName(ticketId);
  await socket.leave(room);
  await clearSocketTicketCollaboration({
    socket,
    ticketId,
  });

  return buildSubscriptionAck({
    scope: 'ticket',
    action: 'unsubscribed',
    room,
    workspaceId,
    ticketId,
  });
};

const assertWidgetRealtimeSocketOrThrow = (socket) => {
  if (socket?.data?.realtimeAuthType !== 'widget') {
    throw createError('errors.auth.invalidToken', 401);
  }
};

export const subscribeWidgetRoom = async ({ socket }) => {
  assertWidgetRealtimeSocketOrThrow(socket);

  const room = widgetSessionRoomName(socket.data.auth.widgetSessionId);
  await socket.join(room);

  const snapshot = await initializePublicWidgetSession({
    publicKey: socket.data.auth.widgetPublicKey,
    sessionToken: socket.data.widgetSessionToken,
  });

  return buildRealtimeAck({
    ok: true,
    code: 'realtime.widget.subscribed',
    messageKey: 'success.ok',
    data: {
      scope: 'widget',
      widgetPublicKey: socket.data.auth.widgetPublicKey,
      snapshot,
    },
  });
};

export const unsubscribeWidgetRoom = async ({ socket }) => {
  assertWidgetRealtimeSocketOrThrow(socket);

  await socket.leave(widgetSessionRoomName(socket.data.auth.widgetSessionId));

  return buildRealtimeAck({
    ok: true,
    code: 'realtime.widget.unsubscribed',
    messageKey: 'success.ok',
    data: {
      scope: 'widget',
      widgetPublicKey: socket.data.auth.widgetPublicKey,
    },
  });
};
