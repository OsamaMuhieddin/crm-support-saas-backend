import { TICKET_CHANNEL } from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE } from '../../../constants/ticket-message-type.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { hashValue } from '../../../shared/utils/security.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { Contact } from '../../customers/models/contact.model.js';
import { ContactIdentity } from '../../customers/models/contact-identity.model.js';
import {
  normalizeNullableEmailForWriteOrThrow,
  normalizeNullableString,
} from '../../customers/utils/customer.helpers.js';
import { Message } from '../../tickets/models/message.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { createTicket } from '../../tickets/services/tickets.service.js';
import { createTicketMessage } from '../../tickets/services/ticket-messages.service.js';
import { WidgetSession } from '../models/widget-session.model.js';
import {
  buildPublicMessageActionView,
  buildPublicSessionView,
  findWidgetSessionByToken,
  generateWidgetSessionToken,
  loadCurrentSessionTicket,
  loadPublicWidgetSessionSnapshot,
  normalizeWidgetSessionToken,
  syncSessionTicketPointers,
} from './widget-session-view.service.js';
import { buildPublicWidgetRealtimeView } from './widget-realtime.service.js';
import { findActivePublicWidgetByPublicKeyOrThrow } from './widget.service.js';

const GENERATED_CONTACT_NAME_PREFIX = 'Widget visitor';

const PUBLIC_MESSAGE_PROJECTION = {
  _id: 1,
  type: 1,
  direction: 1,
  bodyText: 1,
  createdAt: 1,
};

const buildSessionCreateSeed = ({
  contactId = null,
  organizationId = null,
  ticketId = null,
  recoveryVerifiedAt = null,
  recoveredFromSessionId = null,
} = {}) => ({
  contactId: contactId ? toObjectIdIfValid(contactId) : null,
  organizationId: organizationId ? toObjectIdIfValid(organizationId) : null,
  ticketId: ticketId ? toObjectIdIfValid(ticketId) : null,
  recoveryVerifiedAt: recoveryVerifiedAt || null,
  recoveredFromSessionId: recoveredFromSessionId
    ? toObjectIdIfValid(recoveredFromSessionId)
    : null,
});

const buildWidgetTicketSubject = ({ widget, visitorName, visitorEmail }) => {
  const segments = [
    normalizeNullableString(widget?.name),
    normalizeNullableString(visitorName) ||
      normalizeNullableString(visitorEmail),
  ].filter(Boolean);

  if (segments.length === 0) {
    return GENERATED_CONTACT_NAME_PREFIX;
  }

  return segments.join(' - ').slice(0, 240);
};

const isGeneratedContactName = (value) =>
  String(value || '').startsWith(GENERATED_CONTACT_NAME_PREFIX);

const buildFallbackContactName = ({ session, visitorName, visitorEmail }) =>
  normalizeNullableString(visitorName) ||
  normalizeNullableString(visitorEmail) ||
  `${GENERATED_CONTACT_NAME_PREFIX} ${String(session._id).slice(-6)}`;

const normalizeIncomingProfile = (payload = {}) => ({
  sessionToken: normalizeWidgetSessionToken(payload.sessionToken),
  name: normalizeNullableString(payload.name) || null,
  email:
    normalizeNullableEmailForWriteOrThrow({
      value: payload.email,
      field: 'email',
    }) || null,
  message: String(payload.message || '').trim(),
});

export const createWidgetSessionWithToken = async ({
  workspaceId,
  widgetId,
  sessionSeed = {},
}) => {
  const normalizedSeed = buildSessionCreateSeed(sessionSeed);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessionToken = generateWidgetSessionToken();

    try {
      const session = await WidgetSession.create({
        workspaceId: toObjectIdIfValid(workspaceId),
        widgetId: toObjectIdIfValid(widgetId),
        publicSessionKeyHash: hashValue(sessionToken),
        ...normalizedSeed,
        lastSeenAt: new Date(),
      });

      return {
        session,
        sessionToken,
      };
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  throw createError('errors.widget.sessionConflict', 409);
};

const findContactByEmail = async ({ workspaceId, email }) => {
  if (!email) {
    return null;
  }

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const identity = await ContactIdentity.findOne({
    workspaceId: workspaceObjectId,
    type: 'email',
    valueNormalized: email,
    deletedAt: null,
  })
    .select('contactId')
    .lean();

  if (identity?.contactId) {
    const identityContact = await Contact.findOne({
      _id: identity.contactId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    });

    if (identityContact) {
      return identityContact;
    }
  }

  return Contact.findOne({
    workspaceId: workspaceObjectId,
    emailNormalized: email,
    deletedAt: null,
  }).sort({ createdAt: 1, _id: 1 });
};

const ensureEmailIdentity = async ({ workspaceId, contactId, email }) => {
  if (!email) {
    return;
  }

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const contactObjectId = toObjectIdIfValid(contactId);
  const existingIdentity = await ContactIdentity.findOne({
    workspaceId: workspaceObjectId,
    contactId: contactObjectId,
    type: 'email',
    valueNormalized: email,
    deletedAt: null,
  })
    .select('_id')
    .lean();

  if (existingIdentity) {
    return;
  }

  try {
    await ContactIdentity.create({
      workspaceId: workspaceObjectId,
      contactId: contactObjectId,
      type: 'email',
      value: email,
      verifiedAt: null,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
};

const loadSessionContact = async ({ workspaceId, session }) => {
  if (!session.contactId) {
    return null;
  }

  return Contact.findOne({
    _id: session.contactId,
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  });
};

const resolveOrCreateSessionContact = async ({
  workspaceId,
  session,
  visitorName,
  visitorEmail,
}) => {
  let contact = await loadSessionContact({
    workspaceId,
    session,
  });

  if (contact) {
    let shouldSave = false;

    if (visitorName && isGeneratedContactName(contact.fullName)) {
      contact.fullName = visitorName;
      shouldSave = true;
    }

    if (visitorEmail && !contact.email) {
      const existingEmailContact = await findContactByEmail({
        workspaceId,
        email: visitorEmail,
      });

      if (
        !existingEmailContact ||
        String(existingEmailContact._id) === String(contact._id)
      ) {
        contact.email = visitorEmail;
        shouldSave = true;
      }
    }

    if (shouldSave) {
      await contact.save();
    }

    if (contact.email) {
      await ensureEmailIdentity({
        workspaceId,
        contactId: contact._id,
        email: contact.email,
      });
    }

    session.contactId = contact._id;
    session.organizationId = contact.organizationId || null;

    return contact;
  }

  if (visitorEmail) {
    contact = await findContactByEmail({
      workspaceId,
      email: visitorEmail,
    });
  }

  if (!contact) {
    contact = await Contact.create({
      workspaceId: toObjectIdIfValid(workspaceId),
      fullName: buildFallbackContactName({
        session,
        visitorName,
        visitorEmail,
      }),
      email: visitorEmail || null,
      organizationId: null,
    });
  }

  if (visitorEmail) {
    await ensureEmailIdentity({
      workspaceId,
      contactId: contact._id,
      email: visitorEmail,
    });
  }

  session.contactId = contact._id;
  session.organizationId = contact.organizationId || null;

  return contact;
};

const findEligibleTicketForSession = async ({
  workspaceId,
  widget,
  session,
}) => {
  const ticket = await loadCurrentSessionTicket({
    workspaceId,
    widgetId: widget._id,
    session,
  });

  if (!ticket) {
    return null;
  }

  if (String(ticket.mailboxId) !== String(widget.mailboxId)) {
    return null;
  }

  if (ticket.status === TICKET_STATUS.CLOSED) {
    return null;
  }

  return ticket;
};

const loadLatestCustomerMessage = async ({ workspaceId, ticketId }) => {
  const message = await Message.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    ticketId: toObjectIdIfValid(ticketId),
    deletedAt: null,
    type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
  })
    .sort({ createdAt: -1, _id: -1 })
    .select(PUBLIC_MESSAGE_PROJECTION)
    .lean();

  if (!message) {
    throw createError('errors.ticket.conversationInvariantFailed', 500);
  }

  return message;
};

export const initializePublicWidgetSession = async ({
  publicKey,
  sessionToken,
}) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });

  let session = await findWidgetSessionByToken({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    sessionToken,
  });
  let resolvedSessionToken = normalizeWidgetSessionToken(sessionToken);

  if (!session) {
    const created = await createWidgetSessionWithToken({
      workspaceId: widget.workspaceId,
      widgetId: widget._id,
    });
    session = created.session;
    resolvedSessionToken = created.sessionToken;
  } else {
    session.lastSeenAt = new Date();
    await session.save();
  }

  const snapshot = await loadPublicWidgetSessionSnapshot({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    session,
    sessionToken: resolvedSessionToken,
    syncSession: true,
  });

  return {
    session: snapshot.session,
    conversation: snapshot.conversation,
    realtime: buildPublicWidgetRealtimeView(),
  };
};

export const createPublicWidgetMessage = async ({ publicKey, payload }) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });
  const normalized = normalizeIncomingProfile(payload);
  const resolvedSessionToken = normalizeWidgetSessionToken(
    normalized.sessionToken
  );
  const session = await findWidgetSessionByToken({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    sessionToken: resolvedSessionToken,
  });

  if (!session) {
    throw createError('errors.widget.sessionNotFound', 404);
  }

  const contact = await resolveOrCreateSessionContact({
    workspaceId: widget.workspaceId,
    session,
    visitorName: normalized.name,
    visitorEmail: normalized.email,
  });
  let ticket = await findEligibleTicketForSession({
    workspaceId: widget.workspaceId,
    widget,
    session,
  });
  let messageRecord = null;

  if (!ticket) {
    const createdTicket = await createTicket({
      workspaceId: widget.workspaceId,
      createdByUserId: null,
      payload: {
        subject: buildWidgetTicketSubject({
          widget,
          visitorName: normalized.name,
          visitorEmail: normalized.email,
        }),
        mailboxId: normalizeObjectId(widget.mailboxId),
        contactId: normalizeObjectId(contact._id),
        organizationId: contact.organizationId
          ? normalizeObjectId(contact.organizationId)
          : null,
        initialMessage: {
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: normalized.message,
        },
      },
      context: {
        channel: TICKET_CHANNEL.WIDGET,
        widgetId: normalizeObjectId(widget._id),
        widgetSessionId: normalizeObjectId(session._id),
      },
    });

    ticket = await loadCurrentSessionTicket({
      workspaceId: widget.workspaceId,
      widgetId: widget._id,
      session: {
        ...session.toObject(),
        ticketId: createdTicket.ticket._id,
        _id: session._id,
      },
    });
    messageRecord = await loadLatestCustomerMessage({
      workspaceId: widget.workspaceId,
      ticketId: createdTicket.ticket._id,
    });
  } else {
    const createdMessage = await createTicketMessage({
      workspaceId: widget.workspaceId,
      ticketId: ticket._id,
      createdByUserId: null,
      payload: {
        type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
        bodyText: normalized.message,
      },
    });

    messageRecord = createdMessage.messageRecord;
    ticket = {
      ...ticket,
      status: createdMessage.ticketSummary.status,
      messageCount: createdMessage.ticketSummary.messageCount,
      publicMessageCount: createdMessage.ticketSummary.publicMessageCount,
      lastMessageAt: createdMessage.ticketSummary.lastMessageAt,
      closedAt: null,
    };
  }

  await syncSessionTicketPointers({
    session,
    ticket,
  });

  return {
    session: buildPublicSessionView({
      token: resolvedSessionToken,
      session,
    }),
    realtime: buildPublicWidgetRealtimeView(),
    ...buildPublicMessageActionView({
      ticket,
      messageRecord,
    }),
  };
};
