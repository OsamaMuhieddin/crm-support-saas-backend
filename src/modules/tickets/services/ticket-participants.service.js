import { Ticket } from '../models/ticket.model.js';
import { TicketParticipant } from '../models/ticket-participant.model.js';
import {
  buildAssigneeSummaryView,
  loadWorkspaceMemberUserSummaryMap,
  resolveTicketParticipantUserForWrite,
} from './ticket-reference.service.js';
import { findTicketInWorkspaceOrThrow } from './ticket-query.service.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';
import { publishTicketParticipantChanged } from './ticket-live-events.service.js';

const syncTicketParticipantCount = async ({ workspaceId, ticketId }) => {
  const participantCount = await TicketParticipant.countDocuments({
    workspaceId,
    ticketId,
    deletedAt: null,
  });

  await Ticket.updateOne(
    {
      _id: ticketId,
      workspaceId,
      deletedAt: null,
    },
    {
      $set: {
        participantCount,
      },
    }
  );

  return participantCount;
};

const buildParticipantView = ({ participant, user }) => ({
  _id: normalizeObjectId(participant._id),
  userId: normalizeObjectId(participant.userId),
  type: participant.type,
  createdAt: participant.createdAt,
  updatedAt: participant.updatedAt,
  user: user || null,
});

export const listTicketParticipants = async ({ workspaceId, ticketId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticketObjectId = toObjectIdIfValid(ticketId);

  await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    lean: true,
    projection: '_id workspaceId participantCount',
  });

  const participants = await TicketParticipant.find({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    deletedAt: null,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  const participantsByUserId = await loadWorkspaceMemberUserSummaryMap({
    workspaceId: workspaceObjectId,
    userIds: participants.map((participant) => participant.userId),
  });

  return {
    participants: participants.map((participant) =>
      buildParticipantView({
        participant,
        user: participantsByUserId.get(String(participant.userId)) || null,
      })
    ),
  };
};

export const saveTicketParticipant = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
  payload,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticketObjectId = toObjectIdIfValid(ticketId);
  const participantUserId = toObjectIdIfValid(payload.userId);

  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    lean: true,
    projection: '_id workspaceId participantCount',
  });

  const participantTarget = await resolveTicketParticipantUserForWrite({
    workspaceId: workspaceObjectId,
    userId: participantUserId,
  });

  let participant = await TicketParticipant.findOne({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    userId: participantUserId,
  }).sort({ deletedAt: 1, updatedAt: -1 });

  if (!participant) {
    participant = await TicketParticipant.create({
      workspaceId: workspaceObjectId,
      ticketId: ticketObjectId,
      userId: participantUserId,
      type: payload.type,
    });
  } else {
    if (participant.deletedAt === null && participant.type === payload.type) {
      return {
        participant: buildParticipantView({
          participant: participant.toObject(),
          user: buildAssigneeSummaryView(participantTarget),
        }),
        ticketSummary: {
          _id: normalizeObjectId(ticketObjectId),
          participantCount: Number(ticket.participantCount || 0),
        },
      };
    }

    participant.type = payload.type;
    participant.deletedAt = null;
    participant.deletedByUserId = null;
    await participant.save();
  }

  const participantCount = await syncTicketParticipantCount({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
  });

  const result = {
    participant: buildParticipantView({
      participant: participant.toObject(),
      user: buildAssigneeSummaryView(participantTarget),
    }),
    ticketSummary: {
      _id: normalizeObjectId(ticketObjectId),
      participantCount,
    },
  };

  await publishTicketParticipantChanged({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    actorUserId,
    action: 'saved',
    participant: result.participant,
    affectedUserId: participantUserId,
  });

  return result;
};

export const removeTicketParticipant = async ({
  workspaceId,
  ticketId,
  userId,
  deletedByUserId,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticketObjectId = toObjectIdIfValid(ticketId);
  const participantUserId = toObjectIdIfValid(userId);

  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    lean: true,
    projection: '_id workspaceId participantCount',
  });

  const participant = await TicketParticipant.findOne({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    userId: participantUserId,
    deletedAt: null,
  });

  if (!participant) {
    return {
      ticketSummary: {
        _id: normalizeObjectId(ticketObjectId),
        participantCount: Number(ticket.participantCount || 0),
      },
    };
  }

  participant.deletedAt = new Date();
  participant.deletedByUserId = deletedByUserId
    ? toObjectIdIfValid(deletedByUserId)
    : null;
  await participant.save();

  const participantCount = await syncTicketParticipantCount({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
  });

  const result = {
    ticketSummary: {
      _id: normalizeObjectId(ticketObjectId),
      participantCount,
    },
  };

  await publishTicketParticipantChanged({
    workspaceId: workspaceObjectId,
    ticketId: ticketObjectId,
    actorUserId: deletedByUserId,
    action: 'removed',
    participant: null,
    affectedUserId: participantUserId,
  });

  return result;
};
