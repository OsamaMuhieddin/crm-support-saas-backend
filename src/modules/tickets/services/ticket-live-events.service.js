import { deriveTicketSlaState } from '../../sla/services/sla-ticket-runtime.service.js';
import { realtimePublisher } from '../../../infra/realtime/index.js';
import {
  ticketRoomName,
  workspaceRoomName,
} from '../../../infra/realtime/rooms.js';
import { Ticket } from '../models/ticket.model.js';
import {
  loadTicketReferenceBundle,
  loadWorkspaceMemberUserSummaryMap,
} from './ticket-reference.service.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';
import {
  publishWidgetConversationUpdated,
  publishWidgetMessageCreated,
} from '../../widget/services/widget-live-events.service.js';

const LIVE_TICKET_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  mailboxId: 1,
  number: 1,
  subject: 1,
  status: 1,
  priority: 1,
  channel: 1,
  categoryId: 1,
  tagIds: 1,
  contactId: 1,
  organizationId: 1,
  assigneeId: 1,
  conversationId: 1,
  messageCount: 1,
  publicMessageCount: 1,
  internalNoteCount: 1,
  attachmentCount: 1,
  participantCount: 1,
  lastMessageAt: 1,
  lastCustomerMessageAt: 1,
  lastPublicReplyAt: 1,
  lastInternalNoteAt: 1,
  lastMessageType: 1,
  lastMessagePreview: 1,
  statusChangedAt: 1,
  assignedAt: 1,
  closedAt: 1,
  sla: 1,
  createdAt: 1,
  updatedAt: 1,
};

const buildLiveTicketSlaView = ({ sla = {}, now = new Date() }) => {
  const derived = deriveTicketSlaState({
    sla,
    now,
  });

  return {
    policyId: sla?.policyId ? normalizeObjectId(sla.policyId) : null,
    policyName: sla?.policyName || null,
    businessHoursId: sla?.businessHoursId
      ? normalizeObjectId(sla.businessHoursId)
      : null,
    businessHoursName: sla?.businessHoursName || null,
    firstResponseDueAt: sla?.firstResponseDueAt || null,
    resolutionDueAt: sla?.resolutionDueAt || null,
    firstResponseAt: sla?.firstResponseAt || null,
    resolvedAt: sla?.resolvedAt || null,
    resolutionRemainingBusinessMinutes:
      sla?.resolutionRemainingBusinessMinutes ?? null,
    isFirstResponseBreached: derived.isFirstResponseBreached,
    isResolutionBreached: derived.isResolutionBreached,
    firstResponseStatus: derived.firstResponseStatus,
    resolutionStatus: derived.resolutionStatus,
    isApplicable: derived.isApplicable,
    isBreached: derived.isBreached,
  };
};

const buildLiveTicketView = ({ ticket, references, now = new Date() }) => ({
  _id: normalizeObjectId(ticket._id),
  workspaceId: normalizeObjectId(ticket.workspaceId),
  mailboxId: ticket.mailboxId ? normalizeObjectId(ticket.mailboxId) : null,
  number: Number(ticket.number),
  subject: ticket.subject,
  status: ticket.status,
  priority: ticket.priority,
  channel: ticket.channel,
  categoryId: ticket.categoryId ? normalizeObjectId(ticket.categoryId) : null,
  tagIds: (ticket.tagIds || []).map((tagId) => normalizeObjectId(tagId)),
  contactId: ticket.contactId ? normalizeObjectId(ticket.contactId) : null,
  organizationId: ticket.organizationId
    ? normalizeObjectId(ticket.organizationId)
    : null,
  assigneeId: ticket.assigneeId ? normalizeObjectId(ticket.assigneeId) : null,
  conversationId: ticket.conversationId
    ? normalizeObjectId(ticket.conversationId)
    : null,
  messageCount: Number(ticket.messageCount || 0),
  publicMessageCount: Number(ticket.publicMessageCount || 0),
  internalNoteCount: Number(ticket.internalNoteCount || 0),
  attachmentCount: Number(ticket.attachmentCount || 0),
  participantCount: Number(ticket.participantCount || 0),
  lastMessageAt: ticket.lastMessageAt || null,
  lastCustomerMessageAt: ticket.lastCustomerMessageAt || null,
  lastPublicReplyAt: ticket.lastPublicReplyAt || null,
  lastInternalNoteAt: ticket.lastInternalNoteAt || null,
  lastMessageType: ticket.lastMessageType || null,
  lastMessagePreview: ticket.lastMessagePreview || null,
  statusChangedAt: ticket.statusChangedAt || null,
  assignedAt: ticket.assignedAt || null,
  closedAt: ticket.closedAt || null,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  sla: buildLiveTicketSlaView({
    sla: ticket.sla,
    now,
  }),
  mailbox: references.mailboxesById.get(String(ticket.mailboxId)) || null,
  contact: references.contactsById.get(String(ticket.contactId)) || null,
  organization: ticket.organizationId
    ? references.organizationsById.get(String(ticket.organizationId)) || null
    : null,
  assignee: ticket.assigneeId
    ? references.assigneesById.get(String(ticket.assigneeId)) || null
    : null,
  category: ticket.categoryId
    ? references.categoriesById.get(String(ticket.categoryId)) || null
    : null,
  tags: (ticket.tagIds || [])
    .map((tagId) => references.tagsById.get(String(tagId)) || null)
    .filter(Boolean),
  conversation: ticket.conversationId
    ? references.conversationsById.get(String(ticket.conversationId)) || null
    : null,
});

const buildNoticeTicketView = (ticket) => ({
  _id: ticket._id,
  number: ticket.number,
  subject: ticket.subject,
  status: ticket.status,
  priority: ticket.priority,
  assigneeId: ticket.assigneeId,
  assignedAt: ticket.assignedAt,
});

const loadLiveTicketView = async ({ workspaceId, ticketId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticket = await Ticket.findOne({
    _id: toObjectIdIfValid(ticketId),
    workspaceId: workspaceObjectId,
    deletedAt: null,
  })
    .select(LIVE_TICKET_PROJECTION)
    .lean();

  if (!ticket) {
    return null;
  }

  const references = await loadTicketReferenceBundle({
    workspaceId: workspaceObjectId,
    tickets: [ticket],
  });

  return buildLiveTicketView({
    ticket,
    references,
  });
};

const publishSafely = async (label, callback) => {
  try {
    return await callback();
  } catch (error) {
    console.error(`Failed to publish realtime ${label}:`, error);
    return null;
  }
};

const buildTicketRooms = (ticket) => [
  workspaceRoomName(ticket.workspaceId),
  ticketRoomName(ticket._id),
];

const loadUserSummaries = async ({ workspaceId, userIds = [] }) => {
  const safeUserIds = [...new Set((userIds || []).filter(Boolean))];

  if (safeUserIds.length === 0) {
    return new Map();
  }

  return loadWorkspaceMemberUserSummaryMap({
    workspaceId: toObjectIdIfValid(workspaceId),
    userIds: safeUserIds.map((userId) => toObjectIdIfValid(userId)),
  });
};

const emitUserNotice = ({
  userId,
  workspaceId,
  actorUserId = null,
  noticeType,
  ticket,
  extra = null,
}) => {
  if (!userId) {
    return null;
  }

  return realtimePublisher.emitToUser({
    userId,
    workspaceId,
    actorUserId,
    event: 'user.notice',
    data: {
      noticeType,
      ticket: buildNoticeTicketView(ticket),
      ...(extra && typeof extra === 'object' ? extra : {}),
    },
  });
};

export const publishTicketCreated = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishSafely('ticket.created', async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    realtimePublisher.emitToRooms({
      rooms: buildTicketRooms(ticket),
      event: 'ticket.created',
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      data: {
        ticket,
      },
    });

    if (
      ticket.assigneeId &&
      ticket.assigneeId !== normalizeObjectId(actorUserId)
    ) {
      emitUserNotice({
        userId: ticket.assigneeId,
        workspaceId: ticket.workspaceId,
        actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
        noticeType: 'ticket_assigned',
        ticket,
      });
    }

    return ticket;
  });

export const publishTicketUpdated = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishSafely('ticket.updated', async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    return realtimePublisher.emitToRooms({
      rooms: buildTicketRooms(ticket),
      event: 'ticket.updated',
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      data: {
        ticket,
      },
    });
  });

const publishAssignmentNoticeSet = async ({
  ticket,
  previousAssigneeId = null,
  actorUserId = null,
  assignmentMode = 'assign',
}) => {
  const normalizedActorUserId = actorUserId
    ? normalizeObjectId(actorUserId)
    : null;
  const currentAssigneeId = ticket.assigneeId || null;
  const userSummaries = await loadUserSummaries({
    workspaceId: ticket.workspaceId,
    userIds: [previousAssigneeId, currentAssigneeId],
  });
  const previousAssignee = previousAssigneeId
    ? userSummaries.get(String(previousAssigneeId)) || null
    : null;
  const assignee = currentAssigneeId
    ? userSummaries.get(String(currentAssigneeId)) || ticket.assignee || null
    : null;

  realtimePublisher.emitToRooms({
    rooms: buildTicketRooms(ticket),
    event: currentAssigneeId ? 'ticket.assigned' : 'ticket.unassigned',
    workspaceId: ticket.workspaceId,
    actorUserId: normalizedActorUserId,
    data: {
      ticket,
      assignee,
      previousAssigneeId: previousAssigneeId
        ? normalizeObjectId(previousAssigneeId)
        : null,
      previousAssignee,
      assignmentMode,
    },
  });

  if (
    currentAssigneeId &&
    String(currentAssigneeId) !== String(normalizedActorUserId || '')
  ) {
    emitUserNotice({
      userId: currentAssigneeId,
      workspaceId: ticket.workspaceId,
      actorUserId: normalizedActorUserId,
      noticeType: 'ticket_assigned',
      ticket,
    });
  }

  if (
    previousAssigneeId &&
    String(previousAssigneeId) !== String(normalizedActorUserId || '') &&
    String(previousAssigneeId) !== String(currentAssigneeId || '')
  ) {
    emitUserNotice({
      userId: previousAssigneeId,
      workspaceId: ticket.workspaceId,
      actorUserId: normalizedActorUserId,
      noticeType: 'ticket_unassigned',
      ticket,
    });
  }
};

export const publishTicketAssignmentChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
  previousAssigneeId = null,
  assignmentMode = 'assign',
}) =>
  publishSafely('ticket.assignment_changed', async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    await publishAssignmentNoticeSet({
      ticket,
      previousAssigneeId,
      actorUserId,
      assignmentMode,
    });

    return ticket;
  });

const publishTicketStateEvent = async ({
  label,
  workspaceId,
  ticketId,
  actorUserId = null,
  event,
}) =>
  publishSafely(label, async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    const envelope = realtimePublisher.emitToRooms({
      rooms: buildTicketRooms(ticket),
      event,
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      data: {
        ticket,
      },
    });

    await publishWidgetConversationUpdated({
      workspaceId: ticket.workspaceId,
      ticketId: ticket._id,
      actorUserId,
    });

    return envelope;
  });

export const publishTicketStatusChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishTicketStateEvent({
    label: 'ticket.status_changed',
    workspaceId,
    ticketId,
    actorUserId,
    event: 'ticket.status_changed',
  });

export const publishTicketSolved = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishTicketStateEvent({
    label: 'ticket.solved',
    workspaceId,
    ticketId,
    actorUserId,
    event: 'ticket.solved',
  });

export const publishTicketClosed = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishTicketStateEvent({
    label: 'ticket.closed',
    workspaceId,
    ticketId,
    actorUserId,
    event: 'ticket.closed',
  });

export const publishTicketReopened = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) =>
  publishTicketStateEvent({
    label: 'ticket.reopened',
    workspaceId,
    ticketId,
    actorUserId,
    event: 'ticket.reopened',
  });

export const publishTicketMessageCreated = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
  messageRecord,
  conversation,
}) =>
  publishSafely('message.created', async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    realtimePublisher.emitToTicket({
      ticketId: ticket._id,
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      event: 'message.created',
      data: {
        ticket,
        conversation,
        message: messageRecord,
      },
    });

    const envelope = realtimePublisher.emitToRooms({
      rooms: buildTicketRooms(ticket),
      event: 'conversation.updated',
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      data: {
        ticket,
        conversation,
      },
    });

    await publishWidgetMessageCreated({
      workspaceId: ticket.workspaceId,
      ticketId: ticket._id,
      actorUserId,
      messageRecord,
    });

    return envelope;
  });

export const publishTicketParticipantChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
  action,
  participant = null,
  affectedUserId = null,
}) =>
  publishSafely('ticket.participant_changed', async () => {
    const ticket = await loadLiveTicketView({
      workspaceId,
      ticketId,
    });

    if (!ticket) {
      return null;
    }

    realtimePublisher.emitToRooms({
      rooms: buildTicketRooms(ticket),
      event: 'ticket.participant_changed',
      workspaceId: ticket.workspaceId,
      actorUserId: actorUserId ? normalizeObjectId(actorUserId) : null,
      data: {
        action,
        ticket,
        participant,
        affectedUserId: affectedUserId
          ? normalizeObjectId(affectedUserId)
          : null,
      },
    });

    const normalizedActorUserId = actorUserId
      ? normalizeObjectId(actorUserId)
      : null;
    const normalizedAffectedUserId = affectedUserId
      ? normalizeObjectId(affectedUserId)
      : participant?.userId || null;

    if (
      normalizedAffectedUserId &&
      String(normalizedAffectedUserId) !== String(normalizedActorUserId || '')
    ) {
      emitUserNotice({
        userId: normalizedAffectedUserId,
        workspaceId: ticket.workspaceId,
        actorUserId: normalizedActorUserId,
        noticeType:
          action === 'removed'
            ? 'ticket_participant_removed'
            : 'ticket_participant_added',
        ticket,
        extra: participant?.type ? { participantType: participant.type } : null,
      });
    }

    return ticket;
  });
