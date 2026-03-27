import { buildRealtimeEventEnvelope } from './contracts.js';
import { getRealtimeServer } from './server-state.js';
import { ticketRoomName, userRoomName, workspaceRoomName } from './rooms.js';

const buildRoomEmitter = ({ io, rooms = [] }) => {
  let emitter = io;

  for (const room of rooms.filter(Boolean)) {
    emitter = emitter.to(room);
  }

  return emitter;
};

const emitEvent = ({
  event,
  data = null,
  rooms = [],
  workspaceId = null,
  actorUserId = null,
}) => {
  const io = getRealtimeServer();

  if (!io || !event || rooms.filter(Boolean).length === 0) {
    return null;
  }

  const envelope = buildRealtimeEventEnvelope({
    event,
    data,
    workspaceId,
    actorUserId,
  });

  buildRoomEmitter({ io, rooms }).emit(event, envelope);

  return envelope;
};

const emitToRoom = ({ room, event, data = null, workspaceId, actorUserId }) =>
  emitEvent({
    rooms: [room],
    event,
    data,
    workspaceId,
    actorUserId,
  });

export const realtimePublisher = {
  emitEvent,
  emitToRoom,
  emitToRooms({ rooms = [], event, data = null, workspaceId, actorUserId }) {
    return emitEvent({
      rooms,
      event,
      data,
      workspaceId,
      actorUserId,
    });
  },
  emitToWorkspace({ workspaceId, event, data = null, actorUserId = null }) {
    return emitToRoom({
      room: workspaceRoomName(workspaceId),
      event,
      data,
      workspaceId,
      actorUserId,
    });
  },
  emitToTicket({
    ticketId,
    event,
    data = null,
    workspaceId = null,
    actorUserId = null,
  }) {
    return emitToRoom({
      room: ticketRoomName(ticketId),
      event,
      data,
      workspaceId,
      actorUserId,
    });
  },
  emitToUser({ userId, event, data = null, workspaceId = null, actorUserId }) {
    return emitToRoom({
      room: userRoomName(userId),
      event,
      data,
      workspaceId,
      actorUserId,
    });
  },
};

export { emitEvent as emitRealtimeEvent, emitToRoom as emitRealtimeToRoom };
