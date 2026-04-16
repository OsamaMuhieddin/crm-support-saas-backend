import { OTP_PURPOSE } from '../../../constants/otp-purpose.js';
import { TICKET_CHANNEL } from '../../../constants/ticket-channel.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { widgetConfig } from '../../../config/widget.config.js';
import { disconnectRealtimeWidgetSessionSocketsBatch } from '../../../infra/realtime/index.js';
import { createError } from '../../../shared/errors/createError.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import {
  generateSecureToken,
  hashValue,
} from '../../../shared/utils/security.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { sendOtpEmailFireAndForget } from '../../../shared/services/email.service.js';
import { createOtp, verifyOtp } from '../../auth/services/otp.service.js';
import { ContactIdentity } from '../../customers/models/contact-identity.model.js';
import { Contact } from '../../customers/models/contact.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { WidgetRecovery } from '../models/widget-recovery.model.js';
import { WidgetSession } from '../models/widget-session.model.js';
import {
  createWidgetSessionWithToken,
  initializePublicWidgetSession,
} from './widget-public.service.js';
import {
  invalidateWidgetSessions,
  WIDGET_SESSION_INVALIDATION_REASON,
} from './widget-session-view.service.js';
import { findActivePublicWidgetByPublicKeyOrThrow } from './widget.service.js';

const RECOVERY_TOKEN_PREFIX = 'wgr_';
const RECOVERABLE_OPEN_STATUSES = Object.freeze([
  TICKET_STATUS.NEW,
  TICKET_STATUS.OPEN,
  TICKET_STATUS.PENDING,
  TICKET_STATUS.WAITING_ON_CUSTOMER,
]);

const RECOVERY_TICKET_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  widgetId: 1,
  widgetSessionId: 1,
  channel: 1,
  status: 1,
  contactId: 1,
  organizationId: 1,
  lastMessageAt: 1,
  lastMessagePreview: 1,
  messageCount: 1,
  publicMessageCount: 1,
  statusChangedAt: 1,
  updatedAt: 1,
  createdAt: 1,
  deletedAt: 1,
};

const WIDGET_SESSION_CONTACT_PROJECTION = {
  _id: 1,
  contactId: 1,
  organizationId: 1,
  ticketId: 1,
  updatedAt: 1,
  createdAt: 1,
};

const buildRecoveryOtpScopeKey = (widgetId) =>
  `widget:${normalizeObjectId(widgetId)}`;

const normalizeRecoveryToken = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const generateRecoveryToken = () =>
  `${RECOVERY_TOKEN_PREFIX}${generateSecureToken(24)}`;

const buildRecoveryCandidateView = (ticket) => {
  if (!ticket) {
    return null;
  }

  return {
    state: ticket.status === TICKET_STATUS.CLOSED ? 'closed' : 'active',
    ticketStatus: ticket.status,
    lastMessageAt: ticket.lastMessageAt || null,
    messageCount: Number(ticket.messageCount || 0),
    publicMessageCount: Number(ticket.publicMessageCount || 0),
  };
};

const buildRecoveryView = ({ token, recovery, candidate = null }) => ({
  token,
  expiresAt: recovery.expiresAt,
  candidate,
  options: {
    canContinue: Boolean(candidate),
    canStartNew: true,
  },
});

const buildRecoverableTicketQuery = ({ workspaceId, widgetId, contactIds }) => {
  const solvedWindowStart = new Date(
    Date.now() - widgetConfig.recovery.solvedTicketWindowHours * 60 * 60 * 1000
  );

  return {
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    channel: TICKET_CHANNEL.WIDGET,
    contactId: {
      $in: (contactIds || []).map((contactId) => toObjectIdIfValid(contactId)),
    },
    deletedAt: null,
    $or: [
      {
        status: {
          $in: RECOVERABLE_OPEN_STATUSES,
        },
      },
      {
        status: TICKET_STATUS.SOLVED,
        statusChangedAt: {
          $gte: solvedWindowStart,
        },
      },
    ],
  };
};

const resolveRecoveryContactIds = async ({ workspaceId, emailNormalized }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  const [identities, contacts] = await Promise.all([
    ContactIdentity.find({
      workspaceId: workspaceObjectId,
      type: 'email',
      valueNormalized: emailNormalized,
      deletedAt: null,
    })
      .select('contactId')
      .lean(),
    Contact.find({
      workspaceId: workspaceObjectId,
      emailNormalized,
      deletedAt: null,
    })
      .select('_id')
      .lean(),
  ]);

  return [
    ...new Set(
      [
        ...identities.map((identity) => String(identity.contactId || '')),
        ...contacts.map((contact) => String(contact._id || '')),
      ].filter(Boolean)
    ),
  ];
};

const loadLatestKnownWidgetSession = async ({
  workspaceId,
  widgetId,
  contactIds,
}) => {
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return null;
  }

  return WidgetSession.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    contactId: {
      $in: contactIds.map((contactId) => toObjectIdIfValid(contactId)),
    },
    deletedAt: null,
  })
    .sort({ updatedAt: -1, _id: -1 })
    .select(WIDGET_SESSION_CONTACT_PROJECTION)
    .lean();
};

const loadLatestRecoverableTicket = async ({
  workspaceId,
  widgetId,
  contactIds,
}) => {
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return null;
  }

  // the latest eligible widget ticket wins,
  // but only if its state is still recoverable for verified re-entry.
  return Ticket.findOne(
    buildRecoverableTicketQuery({
      workspaceId,
      widgetId,
      contactIds,
    })
  )
    .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 })
    .select(RECOVERY_TICKET_PROJECTION)
    .lean();
};

const loadCandidateSessionForTicket = async ({
  workspaceId,
  widgetId,
  ticketId,
  contactIds,
}) => {
  if (!ticketId) {
    return null;
  }

  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    ticketId: toObjectIdIfValid(ticketId),
    deletedAt: null,
  };

  if (Array.isArray(contactIds) && contactIds.length > 0) {
    query.contactId = {
      $in: contactIds.map((contactId) => toObjectIdIfValid(contactId)),
    };
  }

  return WidgetSession.findOne(query)
    .sort({ updatedAt: -1, _id: -1 })
    .select(WIDGET_SESSION_CONTACT_PROJECTION)
    .lean();
};

const loadWidgetRecoveryLookup = async ({
  workspaceId,
  widgetId,
  emailNormalized,
}) => {
  const contactIds = await resolveRecoveryContactIds({
    workspaceId,
    emailNormalized,
  });
  const [latestKnownSession, latestRecoverableTicket] = await Promise.all([
    loadLatestKnownWidgetSession({
      workspaceId,
      widgetId,
      contactIds,
    }),
    loadLatestRecoverableTicket({
      workspaceId,
      widgetId,
      contactIds,
    }),
  ]);

  const candidateSession = await loadCandidateSessionForTicket({
    workspaceId,
    widgetId,
    ticketId: latestRecoverableTicket?._id || null,
    contactIds,
  });

  return {
    contactIds,
    latestKnownSession,
    latestRecoverableTicket,
    candidateSession,
  };
};

const ensureVerifiedRecoveryContact = async ({
  workspaceId,
  contactId = null,
  emailNormalized,
  verifiedAt,
}) => {
  let contact = null;

  if (contactId) {
    contact = await Contact.findOne({
      _id: toObjectIdIfValid(contactId),
      workspaceId: toObjectIdIfValid(workspaceId),
      deletedAt: null,
    });
  }

  if (!contact) {
    contact = await Contact.findOne({
      workspaceId: toObjectIdIfValid(workspaceId),
      emailNormalized,
      deletedAt: null,
    }).sort({ updatedAt: -1, _id: -1 });
  }

  if (!contact) {
    contact = await Contact.create({
      workspaceId: toObjectIdIfValid(workspaceId),
      fullName: emailNormalized,
      email: emailNormalized,
      organizationId: null,
    });
  } else if (!contact.email) {
    contact.email = emailNormalized;
    await contact.save();
  }

  const existingIdentity = await ContactIdentity.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    contactId: contact._id,
    type: 'email',
    valueNormalized: emailNormalized,
    deletedAt: null,
  });

  if (!existingIdentity) {
    await ContactIdentity.create({
      workspaceId: toObjectIdIfValid(workspaceId),
      contactId: contact._id,
      type: 'email',
      value: emailNormalized,
      verifiedAt,
    });
  } else if (!existingIdentity.verifiedAt) {
    existingIdentity.verifiedAt = verifiedAt;
    await existingIdentity.save();
  }

  return contact;
};

const createWidgetRecoveryRecord = async ({
  workspaceId,
  widgetId,
  emailNormalized,
  contactId = null,
  candidateSessionId = null,
  candidateTicketId = null,
}) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const recoveryToken = generateRecoveryToken();

    try {
      const verifiedAt = new Date();
      const recovery = await WidgetRecovery.create({
        workspaceId: toObjectIdIfValid(workspaceId),
        widgetId: toObjectIdIfValid(widgetId),
        emailNormalized,
        contactId: contactId ? toObjectIdIfValid(contactId) : null,
        candidateSessionId: candidateSessionId
          ? toObjectIdIfValid(candidateSessionId)
          : null,
        candidateTicketId: candidateTicketId
          ? toObjectIdIfValid(candidateTicketId)
          : null,
        recoveryTokenHash: hashValue(recoveryToken),
        verifiedAt,
        expiresAt: new Date(
          verifiedAt.getTime() +
            widgetConfig.recovery.tokenExpiresMinutes * 60 * 1000
        ),
      });

      return {
        recovery,
        recoveryToken,
      };
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  throw createError('errors.widget.recoveryConflict', 409);
};

const loadRecoveryRecordByTokenOrThrow = async ({
  workspaceId,
  widgetId,
  recoveryToken,
}) => {
  const normalizedToken = normalizeRecoveryToken(recoveryToken);
  if (!normalizedToken) {
    throw createError('errors.widget.recoveryNotFound', 404);
  }

  const recovery = await WidgetRecovery.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    recoveryTokenHash: hashValue(normalizedToken),
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!recovery) {
    throw createError('errors.widget.recoveryNotFound', 404);
  }

  return recovery;
};

const resolveRecoverableTicketById = async ({
  workspaceId,
  widgetId,
  ticketId,
}) => {
  if (!ticketId) {
    return null;
  }

  const ticket = await Ticket.findOne({
    _id: toObjectIdIfValid(ticketId),
    workspaceId: toObjectIdIfValid(workspaceId),
    widgetId: toObjectIdIfValid(widgetId),
    channel: TICKET_CHANNEL.WIDGET,
    deletedAt: null,
  })
    .select(RECOVERY_TICKET_PROJECTION)
    .lean();

  if (!ticket) {
    return null;
  }

  if (RECOVERABLE_OPEN_STATUSES.includes(ticket.status)) {
    return ticket;
  }

  if (ticket.status !== TICKET_STATUS.SOLVED) {
    return null;
  }

  const solvedWindowStart = new Date(
    Date.now() - widgetConfig.recovery.solvedTicketWindowHours * 60 * 60 * 1000
  );

  if (
    !ticket.statusChangedAt ||
    new Date(ticket.statusChangedAt).getTime() < solvedWindowStart.getTime()
  ) {
    return null;
  }

  return ticket;
};

const consumeRecoveryRecord = async ({ recovery, action }) => {
  recovery.consumedAt = new Date();
  recovery.consumedAction = action;
  await recovery.save();
};

const buildRecoverySessionSeed = ({
  recovery,
  contact,
  candidateSessionId = null,
  candidateTicketId = null,
}) => ({
  contactId: contact?._id || recovery.contactId || null,
  organizationId: contact?.organizationId || null,
  ticketId: candidateTicketId || null,
  recoveryVerifiedAt: recovery.verifiedAt,
  recoveredFromSessionId: candidateSessionId || null,
});

const invalidateSupersededRecoverySessions = async ({
  workspaceId,
  widgetId,
  recovery,
  createdSessionId = null,
  action,
}) => {
  const invalidationReason =
    action === 'continue'
      ? WIDGET_SESSION_INVALIDATION_REASON.RECOVERY_CONTINUE
      : WIDGET_SESSION_INVALIDATION_REASON.RECOVERY_START_NEW;
  const excludeSessionIds = createdSessionId ? [createdSessionId] : [];
  const invalidatedSessionIds = new Set();

  if (recovery.candidateTicketId) {
    const ticketSessionIds = await invalidateWidgetSessions({
      workspaceId,
      widgetId,
      ticketId: recovery.candidateTicketId,
      excludeSessionIds,
      reason: invalidationReason,
    });

    ticketSessionIds.forEach((sessionId) => invalidatedSessionIds.add(sessionId));
  }

  if (recovery.candidateSessionId) {
    const explicitSessionIds = await invalidateWidgetSessions({
      workspaceId,
      widgetId,
      sessionIds: [recovery.candidateSessionId],
      excludeSessionIds,
      reason: invalidationReason,
    });

    explicitSessionIds.forEach((sessionId) =>
      invalidatedSessionIds.add(sessionId)
    );
  }

  if (invalidatedSessionIds.size > 0) {
    await disconnectRealtimeWidgetSessionSocketsBatch({
      widgetSessionIds: [...invalidatedSessionIds],
    });
  }
};

export const requestWidgetRecovery = async ({ publicKey, payload }) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });
  const emailNormalized = normalizeEmail(payload?.email);

  if (!emailNormalized) {
    return {};
  }

  const lookup = await loadWidgetRecoveryLookup({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    emailNormalized,
  });

  if (!lookup.latestKnownSession && !lookup.latestRecoverableTicket) {
    return {};
  }

  try {
    const otpResult = await createOtp({
      email: emailNormalized,
      purpose: OTP_PURPOSE.WIDGET_RECOVERY,
      scopeKey: buildRecoveryOtpScopeKey(widget._id),
    });

    sendOtpEmailFireAndForget({
      to: emailNormalized,
      purpose: OTP_PURPOSE.WIDGET_RECOVERY,
      code: otpResult.code,
    });
  } catch (error) {
    // Keep the request response generic to preserve anti-enumeration behavior.
  }

  return {};
};

export const verifyWidgetRecovery = async ({ publicKey, payload }) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });
  const emailNormalized = normalizeEmail(payload?.email);

  await verifyOtp({
    email: emailNormalized,
    purpose: OTP_PURPOSE.WIDGET_RECOVERY,
    code: payload?.code,
    scopeKey: buildRecoveryOtpScopeKey(widget._id),
  });

  const lookup = await loadWidgetRecoveryLookup({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    emailNormalized,
  });
  const contactId =
    lookup.candidateSession?.contactId ||
    lookup.latestKnownSession?.contactId ||
    lookup.contactIds[0] ||
    null;

  const { recovery, recoveryToken } = await createWidgetRecoveryRecord({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    emailNormalized,
    contactId,
    candidateSessionId:
      lookup.candidateSession?._id || lookup.latestKnownSession?._id || null,
    candidateTicketId: lookup.latestRecoverableTicket?._id || null,
  });

  return {
    recovery: buildRecoveryView({
      token: recoveryToken,
      recovery,
      candidate: buildRecoveryCandidateView(lookup.latestRecoverableTicket),
    }),
  };
};

export const continueRecoveredWidgetConversation = async ({
  publicKey,
  recoveryToken,
}) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });
  const recovery = await loadRecoveryRecordByTokenOrThrow({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    recoveryToken,
  });
  const candidateTicket = await resolveRecoverableTicketById({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    ticketId: recovery.candidateTicketId,
  });

  if (!candidateTicket) {
    throw createError('errors.widget.recoveryCandidateNotFound', 404);
  }

  const contact = await ensureVerifiedRecoveryContact({
    workspaceId: widget.workspaceId,
    contactId: recovery.contactId || candidateTicket.contactId,
    emailNormalized: recovery.emailNormalized,
    verifiedAt: recovery.verifiedAt,
  });
  const createdSession = await createWidgetSessionWithToken({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    sessionSeed: buildRecoverySessionSeed({
      recovery,
      contact,
      candidateSessionId: recovery.candidateSessionId || null,
      candidateTicketId: candidateTicket._id,
    }),
  });

  await invalidateSupersededRecoverySessions({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    recovery,
    createdSessionId: createdSession.session._id,
    action: 'continue',
  });

  await consumeRecoveryRecord({
    recovery,
    action: 'continue',
  });

  return initializePublicWidgetSession({
    publicKey: widget.publicKey,
    sessionToken: createdSession.sessionToken,
  });
};

export const startNewRecoveredWidgetConversation = async ({
  publicKey,
  recoveryToken,
}) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });
  const recovery = await loadRecoveryRecordByTokenOrThrow({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    recoveryToken,
  });
  const contact = await ensureVerifiedRecoveryContact({
    workspaceId: widget.workspaceId,
    contactId: recovery.contactId,
    emailNormalized: recovery.emailNormalized,
    verifiedAt: recovery.verifiedAt,
  });
  const createdSession = await createWidgetSessionWithToken({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    sessionSeed: buildRecoverySessionSeed({
      recovery,
      contact,
      candidateSessionId: recovery.candidateSessionId || null,
      candidateTicketId: null,
    }),
  });

  await invalidateSupersededRecoverySessions({
    workspaceId: widget.workspaceId,
    widgetId: widget._id,
    recovery,
    createdSessionId: createdSession.session._id,
    action: 'start_new',
  });

  await consumeRecoveryRecord({
    recovery,
    action: 'start_new',
  });

  return initializePublicWidgetSession({
    publicKey: widget.publicKey,
    sessionToken: createdSession.sessionToken,
  });
};
