import { TICKET_CHANNEL } from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE } from '../../../constants/ticket-message-type.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import {
  generateSecureToken,
  hashValue,
} from '../../../shared/utils/security.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { Message } from '../../tickets/models/message.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { WidgetSession } from '../models/widget-session.model.js';

const SESSION_TOKEN_PREFIX = 'wgs_';
const PUBLIC_CONVERSATION_MESSAGE_LIMIT = 100;
export const WIDGET_SESSION_INVALIDATION_REASON = Object.freeze({
  RECOVERY_CONTINUE: 'recovery_continue',
  RECOVERY_START_NEW: 'recovery_start_new',
});

const TICKET_PUBLIC_STATE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  mailboxId: 1,
  status: 1,
  channel: 1,
  contactId: 1,
  widgetId: 1,
  widgetSessionId: 1,
  messageCount: 1,
  publicMessageCount: 1,
  lastMessageAt: 1,
  closedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

const PUBLIC_MESSAGE_PROJECTION = {
  _id: 1,
  type: 1,
  direction: 1,
  bodyText: 1,
  createdAt: 1,
};

export const normalizeWidgetSessionToken = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const generateWidgetSessionToken = () =>
  `${SESSION_TOKEN_PREFIX}${generateSecureToken(24)}`;

export const buildPublicSessionView = ({ token, session }) => ({
  token,
  recoveryVerified: Boolean(session.recoveryVerifiedAt),
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

export const buildPublicMessageView = (message) => ({
  _id: normalizeObjectId(message._id),
  type: message.type,
  direction: message.direction || null,
  sender:
    message.type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY ? 'agent' : 'customer',
  bodyText: message.bodyText,
  createdAt: message.createdAt,
});

export const buildEmptyConversationView = () => ({
  state: 'idle',
  ticketStatus: null,
  lastMessageAt: null,
  messageCount: 0,
  publicMessageCount: 0,
  messages: [],
});

export const buildConversationView = ({ ticket, messages }) => {
  if (!ticket) {
    return buildEmptyConversationView();
  }

  return {
    state: ticket.status === TICKET_STATUS.CLOSED ? 'closed' : 'active',
    ticketStatus: ticket.status,
    lastMessageAt: ticket.lastMessageAt || null,
    messageCount: Number(ticket.messageCount || 0),
    publicMessageCount: Number(ticket.publicMessageCount || 0),
    messages,
  };
};

export const buildPublicMessageActionView = ({ ticket, messageRecord }) => ({
  message: buildPublicMessageView(messageRecord),
  conversation: {
    state: ticket.status === TICKET_STATUS.CLOSED ? 'closed' : 'active',
    ticketStatus: ticket.status,
    lastMessageAt: ticket.lastMessageAt || null,
    messageCount: Number(ticket.messageCount || 0),
    publicMessageCount: Number(ticket.publicMessageCount || 0),
  },
});

export const findWidgetSessionByToken = async ({
  workspaceId,
  widgetId,
  sessionToken,
}) => {
  const normalizedToken = normalizeWidgetSessionToken(sessionToken);
  if (!normalizedToken) {
    return null;
  }

  return WidgetSession.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    publicSessionKeyHash: hashValue(normalizedToken),
    invalidatedAt: null,
    deletedAt: null,
  });
};

export const findWidgetSessionByTokenHash = async ({ sessionToken }) => {
  const normalizedToken = normalizeWidgetSessionToken(sessionToken);
  if (!normalizedToken) {
    return null;
  }

  return WidgetSession.findOne({
    publicSessionKeyHash: hashValue(normalizedToken),
    invalidatedAt: null,
    deletedAt: null,
  });
};

const buildInvalidateSessionQuery = ({
  workspaceId,
  widgetId = null,
  ticketId = null,
  sessionIds = [],
  excludeSessionIds = [],
}) => {
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    invalidatedAt: null,
    deletedAt: null,
  };

  if (widgetId) {
    query.widgetId = toObjectIdIfValid(widgetId);
  }

  if (ticketId) {
    query.ticketId = toObjectIdIfValid(ticketId);
  }

  const normalizedSessionIds = [
    ...new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .map((sessionId) => normalizeObjectId(sessionId))
        .filter(Boolean)
    ),
  ];
  const normalizedExcludeIds = [
    ...new Set(
      (Array.isArray(excludeSessionIds) ? excludeSessionIds : [])
        .map((sessionId) => normalizeObjectId(sessionId))
        .filter(Boolean)
    ),
  ];

  if (normalizedSessionIds.length > 0 && normalizedExcludeIds.length > 0) {
    query._id = {
      $in: normalizedSessionIds.map((sessionId) => toObjectIdIfValid(sessionId)),
      $nin: normalizedExcludeIds.map((sessionId) =>
        toObjectIdIfValid(sessionId)
      ),
    };
  } else if (normalizedSessionIds.length > 0) {
    query._id = {
      $in: normalizedSessionIds.map((sessionId) => toObjectIdIfValid(sessionId)),
    };
  } else if (normalizedExcludeIds.length > 0) {
    query._id = {
      $nin: normalizedExcludeIds.map((sessionId) =>
        toObjectIdIfValid(sessionId)
      ),
    };
  }

  return query;
};

export const invalidateWidgetSessions = async ({
  workspaceId,
  widgetId = null,
  ticketId = null,
  sessionIds = [],
  excludeSessionIds = [],
  reason = null,
}) => {
  const hasSessionIds =
    Array.isArray(sessionIds) && sessionIds.filter(Boolean).length > 0;
  const hasTicketId = Boolean(ticketId);

  if (!hasSessionIds && !hasTicketId) {
    return [];
  }

  const query = buildInvalidateSessionQuery({
    workspaceId,
    widgetId,
    ticketId,
    sessionIds,
    excludeSessionIds,
  });

  const sessions = await WidgetSession.find(query).select('_id').lean();

  if (sessions.length === 0) {
    return [];
  }

  const invalidatedAt = new Date();
  const matchedSessionIds = sessions.map((session) =>
    normalizeObjectId(session._id)
  );

  await WidgetSession.updateMany(
    {
      _id: {
        $in: matchedSessionIds.map((sessionId) => toObjectIdIfValid(sessionId)),
      },
      workspaceId: toObjectIdIfValid(workspaceId),
      invalidatedAt: null,
      deletedAt: null,
    },
    {
      $set: {
        invalidatedAt,
        invalidationReason: reason || null,
        publicSessionKeyHash: null,
      },
    }
  );

  return matchedSessionIds;
};

export const loadCurrentSessionTicket = async ({
  workspaceId,
  widgetId,
  session,
}) => {
  if (session.ticketId) {
    const pointedTicket = await Ticket.findOne({
      _id: toObjectIdIfValid(session.ticketId),
      workspaceId: toObjectIdIfValid(workspaceId),
      deletedAt: null,
      channel: TICKET_CHANNEL.WIDGET,
      widgetId: toObjectIdIfValid(widgetId),
    })
      .select(TICKET_PUBLIC_STATE_PROJECTION)
      .lean();

    if (pointedTicket) {
      return pointedTicket;
    }
  }

  const baseQuery = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
    channel: TICKET_CHANNEL.WIDGET,
    widgetId: toObjectIdIfValid(widgetId),
    widgetSessionId: toObjectIdIfValid(session._id),
  };

  return Ticket.findOne(baseQuery)
    .sort({ updatedAt: -1, _id: -1 })
    .select(TICKET_PUBLIC_STATE_PROJECTION)
    .lean();
};

export const loadCurrentConversationMessages = async ({
  workspaceId,
  ticketId,
}) => {
  if (!ticketId) {
    return [];
  }

  const messages = await Message.find({
    workspaceId: toObjectIdIfValid(workspaceId),
    ticketId: toObjectIdIfValid(ticketId),
    deletedAt: null,
    type: {
      $in: [
        TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
        TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
      ],
    },
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(PUBLIC_CONVERSATION_MESSAGE_LIMIT)
    .select(PUBLIC_MESSAGE_PROJECTION)
    .lean();

  return messages.map((message) => buildPublicMessageView(message));
};

export const syncSessionTicketPointers = async ({ session, ticket = null }) => {
  session.ticketId = ticket?._id || null;
  session.closedAt = ticket?.status === TICKET_STATUS.CLOSED ? ticket.closedAt : null;
  session.lastSeenAt = new Date();
  await session.save();
};

export const loadPublicWidgetSessionSnapshot = async ({
  workspaceId,
  widgetId,
  session,
  sessionToken = null,
  syncSession = false,
}) => {
  const ticket = await loadCurrentSessionTicket({
    workspaceId,
    widgetId,
    session,
  });
  const messages = await loadCurrentConversationMessages({
    workspaceId,
    ticketId: ticket?._id || null,
  });

  if (syncSession) {
    await syncSessionTicketPointers({
      session,
      ticket,
    });
  }

  return {
    ticket,
    session: buildPublicSessionView({
      token: sessionToken,
      session,
    }),
    conversation: buildConversationView({
      ticket,
      messages,
    }),
  };
};
