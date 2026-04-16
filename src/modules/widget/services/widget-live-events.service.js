import { TICKET_CHANNEL } from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE } from '../../../constants/ticket-message-type.js';
import { realtimePublisher } from '../../../infra/realtime/index.js';
import { toObjectIdIfValid } from '../../../shared/utils/object-id.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { Widget } from '../models/widget.model.js';
import { WidgetSession } from '../models/widget-session.model.js';
import {
  buildPublicMessageView,
  loadPublicWidgetSessionSnapshot,
} from './widget-session-view.service.js';

const WIDGET_LIVE_TICKET_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  widgetId: 1,
  channel: 1,
};

const loadWidgetTicketScope = async ({ workspaceId, ticketId }) =>
  Ticket.findOne({
    _id: toObjectIdIfValid(ticketId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
    channel: TICKET_CHANNEL.WIDGET,
  })
    .select(WIDGET_LIVE_TICKET_PROJECTION)
    .lean();

const loadBoundWidgetSessions = async ({ workspaceId, ticketId }) =>
  WidgetSession.find({
    workspaceId: toObjectIdIfValid(workspaceId),
    ticketId: toObjectIdIfValid(ticketId),
    invalidatedAt: null,
    deletedAt: null,
  }).select(
    '_id workspaceId widgetId ticketId recoveryVerifiedAt createdAt updatedAt'
  );

const loadActiveWidgetContext = async ({ workspaceId, widgetId }) => {
  const widget = await Widget.findOne({
    _id: toObjectIdIfValid(widgetId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
    isActive: true,
  })
    .select('_id workspaceId mailboxId')
    .lean();

  if (!widget) {
    return null;
  }

  const mailbox = await Mailbox.findOne({
    _id: widget.mailboxId,
    workspaceId: widget.workspaceId,
    deletedAt: null,
    isActive: true,
  })
    .select('_id')
    .lean();

  if (!mailbox) {
    return null;
  }

  return widget;
};

const emitWidgetConversationUpdatedToSession = async ({
  session,
  actorUserId = null,
}) => {
  const snapshot = await loadPublicWidgetSessionSnapshot({
    workspaceId: session.workspaceId,
    widgetId: session.widgetId,
    session,
    syncSession: false,
  });

  return realtimePublisher.emitToWidgetSession({
    widgetSessionId: session._id,
    workspaceId: null,
    actorUserId: null,
    event: 'widget.conversation.updated',
    data: {
      conversation: snapshot.conversation,
    },
  });
};

const isWidgetPublicMessageType = (messageType) =>
  messageType === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE ||
  messageType === TICKET_MESSAGE_TYPE.PUBLIC_REPLY;

export const publishWidgetMessageCreated = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
  messageRecord,
}) => {
  if (!isWidgetPublicMessageType(messageRecord?.type)) {
    return null;
  }

  const ticket = await loadWidgetTicketScope({
    workspaceId,
    ticketId,
  });

  if (!ticket) {
    return null;
  }

  const widget = await loadActiveWidgetContext({
    workspaceId: ticket.workspaceId,
    widgetId: ticket.widgetId,
  });

  if (!widget) {
    return null;
  }

  const sessions = await loadBoundWidgetSessions({
    workspaceId: ticket.workspaceId,
    ticketId: ticket._id,
  });

  if (sessions.length === 0) {
    return null;
  }

  const publicMessage = buildPublicMessageView(messageRecord);

  await Promise.all(
    sessions.map(async (session) => {
      const snapshot = await loadPublicWidgetSessionSnapshot({
        workspaceId: session.workspaceId,
        widgetId: session.widgetId,
        session,
        syncSession: false,
      });

      realtimePublisher.emitToWidgetSession({
        widgetSessionId: session._id,
        workspaceId: null,
        actorUserId: null,
        event: 'widget.message.created',
        data: {
          message: publicMessage,
          conversation: {
            state: snapshot.conversation.state,
            ticketStatus: snapshot.conversation.ticketStatus,
            lastMessageAt: snapshot.conversation.lastMessageAt,
            messageCount: snapshot.conversation.messageCount,
            publicMessageCount: snapshot.conversation.publicMessageCount,
          },
        },
      });

      realtimePublisher.emitToWidgetSession({
        widgetSessionId: session._id,
        workspaceId: null,
        actorUserId: null,
        event: 'widget.conversation.updated',
        data: {
          conversation: snapshot.conversation,
        },
      });
    })
  );

  return publicMessage;
};

export const publishWidgetConversationUpdated = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) => {
  const ticket = await loadWidgetTicketScope({
    workspaceId,
    ticketId,
  });

  if (!ticket) {
    return null;
  }

  const widget = await loadActiveWidgetContext({
    workspaceId: ticket.workspaceId,
    widgetId: ticket.widgetId,
  });

  if (!widget) {
    return null;
  }

  const sessions = await loadBoundWidgetSessions({
    workspaceId: ticket.workspaceId,
    ticketId: ticket._id,
  });

  if (sessions.length === 0) {
    return null;
  }

  await Promise.all(
    sessions.map((session) =>
      emitWidgetConversationUpdatedToSession({
        session,
        actorUserId,
      })
    )
  );

  return true;
};
