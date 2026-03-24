import { FILE_LINK_ENTITY_TYPE } from '../../../constants/file-link-entity-type.js';
import { FILE_LINK_RELATION_TYPE } from '../../../constants/file-link-relation-type.js';
import { MESSAGE_DIRECTION } from '../../../constants/message-direction.js';
import { TICKET_MESSAGE_TYPE } from '../../../constants/ticket-message-type.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { createLink, unlink } from '../../files/services/file-links.service.js';
import { File } from '../../files/models/file.model.js';
import { FileLink } from '../../files/models/file-link.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Contact } from '../../customers/models/contact.model.js';
import { User } from '../../users/models/user.model.js';
import {
  applyFirstResponseSlaOnPublicReply,
  applyTicketStatusTransitionSla,
  deriveTicketSlaState,
} from '../../sla/services/sla-ticket-runtime.service.js';
import { Conversation } from '../models/conversation.model.js';
import { Message } from '../models/message.model.js';
import { Ticket } from '../models/ticket.model.js';
import {
  buildConversationSummaryView,
  buildMailboxSummaryView,
} from './ticket-reference.service.js';
import {
  buildTicketMessageTypeI18nArg,
  buildTicketStatusI18nArg,
  normalizeObjectId,
  normalizeNullableString,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';
import { findTicketInWorkspaceOrThrow } from './ticket-query.service.js';

const MESSAGE_SORT_ALLOWLIST = Object.freeze({
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: -1 },
});

const DEFAULT_MESSAGE_LIST_SORT = MESSAGE_SORT_ALLOWLIST.createdAt;

const MESSAGE_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  conversationId: 1,
  ticketId: 1,
  mailboxId: 1,
  channel: 1,
  type: 1,
  direction: 1,
  from: 1,
  to: 1,
  subject: 1,
  bodyText: 1,
  bodyHtml: 1,
  attachmentFileIds: 1,
  sentAt: 1,
  receivedAt: 1,
  createdByUserId: 1,
  createdAt: 1,
  updatedAt: 1,
};

const TICKET_MESSAGE_WRITE_PROJECTION = {
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
  createdByUserId: 1,
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

const MAILBOX_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  type: 1,
  emailAddress: 1,
  isDefault: 1,
  isActive: 1,
};

const MAILBOX_MESSAGE_PARTY_PROJECTION = {
  _id: 1,
  name: 1,
  emailAddress: 1,
};

const CONTACT_MESSAGE_PARTY_PROJECTION = {
  _id: 1,
  fullName: 1,
  email: 1,
};

const USER_MESSAGE_SUMMARY_PROJECTION = {
  _id: 1,
  email: 1,
  profile: 1,
  status: 1,
};

const ATTACHMENT_SUMMARY_PROJECTION = {
  _id: 1,
  url: 1,
  sizeBytes: 1,
  mimeType: 1,
  originalName: 1,
};

const ATTACHMENT_LINK_PROJECTION = {
  _id: 1,
};

const buildMessagePreview = (value) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 500);
};

const clonePlainObject = (value) => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  if (typeof value.toObject === 'function') {
    return value.toObject();
  }

  return { ...value };
};

const buildSort = (sort) =>
  MESSAGE_SORT_ALLOWLIST[sort] || DEFAULT_MESSAGE_LIST_SORT;

const buildCreatedBySummaryView = (user) => ({
  _id: normalizeObjectId(user._id),
  email: user.email,
  name: user?.profile?.name || null,
  avatar: user?.profile?.avatar || null,
  status: user.status || null,
});

const buildAttachmentSummaryView = (file) => ({
  _id: normalizeObjectId(file._id),
  url: file.url,
  sizeBytes: file.sizeBytes,
  mimeType: file.mimeType,
  originalName: file.originalName,
});

const buildMessagePartyView = ({ name = null, email = null } = {}) => ({
  name: name || null,
  email: email || null,
});

const resolveManualMessageParties = async ({ workspaceId, ticket, type }) => {
  if (type === TICKET_MESSAGE_TYPE.INTERNAL_NOTE) {
    return {
      from: null,
      to: [],
    };
  }

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const [mailbox, contact] = await Promise.all([
    Mailbox.findOne({
      _id: ticket.mailboxId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select(MAILBOX_MESSAGE_PARTY_PROJECTION)
      .lean(),
    Contact.findOne({
      _id: ticket.contactId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select(CONTACT_MESSAGE_PARTY_PROJECTION)
      .lean(),
  ]);

  const mailboxParty = mailbox
    ? buildMessagePartyView({
        name: mailbox.name,
        email: mailbox.emailAddress,
      })
    : null;
  const contactParty = contact
    ? buildMessagePartyView({
        name: contact.fullName,
        email: contact.email,
      })
    : null;

  if (type === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE) {
    return {
      from: contactParty,
      to: mailboxParty ? [mailboxParty] : [],
    };
  }

  if (type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    return {
      from: mailboxParty,
      to: contactParty ? [contactParty] : [],
    };
  }

  return {
    from: null,
    to: [],
  };
};

const buildMessageView = ({
  message,
  attachmentsById,
  createdByUsersById,
}) => ({
  _id: normalizeObjectId(message._id),
  channel: message.channel,
  type: message.type,
  direction: message.direction || null,
  from: message.from || null,
  to: Array.isArray(message.to) ? message.to : [],
  subject: message.subject || null,
  bodyText: message.bodyText,
  bodyHtml: message.bodyHtml || null,
  attachments: (message.attachmentFileIds || [])
    .map((fileId) => attachmentsById.get(String(fileId)) || null)
    .filter(Boolean),
  sentAt: message.sentAt || null,
  receivedAt: message.receivedAt || null,
  createdBy: message.createdByUserId
    ? createdByUsersById.get(String(message.createdByUserId)) || null
    : null,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

const findConversationForTicketOrThrow = async ({
  workspaceId,
  ticket,
  lean = false,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticketObjectId = toObjectIdIfValid(ticket._id);
  const expectedConversationId = ticket.conversationId
    ? toObjectIdIfValid(ticket.conversationId)
    : null;

  let conversation = null;

  if (expectedConversationId) {
    let byIdCursor = Conversation.findOne({
      _id: expectedConversationId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    });

    if (lean) {
      byIdCursor = byIdCursor.lean();
    }

    conversation = await byIdCursor;
  }

  if (!conversation) {
    let byTicketCursor = Conversation.findOne({
      ticketId: ticketObjectId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    });

    if (lean) {
      byTicketCursor = byTicketCursor.lean();
    }

    conversation = await byTicketCursor;
  }

  if (!conversation) {
    throw createError('errors.ticket.conversationInvariantFailed', 500);
  }

  if (String(ticket.conversationId || '') !== String(conversation._id)) {
    if (typeof ticket.save === 'function') {
      ticket.conversationId = conversation._id;
    } else {
      await Ticket.updateOne(
        {
          _id: ticketObjectId,
          workspaceId: workspaceObjectId,
          deletedAt: null,
        },
        {
          $set: {
            conversationId: conversation._id,
          },
        }
      );
      ticket.conversationId = conversation._id;
    }
  }

  return conversation;
};

const resolveMessageDirection = (type) => {
  if (type === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE) {
    return MESSAGE_DIRECTION.INBOUND;
  }

  if (type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    return MESSAGE_DIRECTION.OUTBOUND;
  }

  return null;
};

const resolveTransportTimestamps = ({ type, eventAt }) => {
  if (type === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE) {
    return {
      receivedAt: eventAt,
      sentAt: null,
    };
  }

  if (type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    return {
      sentAt: eventAt,
      receivedAt: null,
    };
  }

  return {
    sentAt: null,
    receivedAt: null,
  };
};

const assertMessageWriteAllowedForTicket = ({ ticket, type }) => {
  if (
    ticket.status === TICKET_STATUS.CLOSED &&
    type !== TICKET_MESSAGE_TYPE.INTERNAL_NOTE
  ) {
    throw createError('errors.ticket.closedMessageNotAllowed', 409, null, {
      status: buildTicketStatusI18nArg(ticket.status),
      type: buildTicketMessageTypeI18nArg(type),
      allowedType: buildTicketMessageTypeI18nArg(
        TICKET_MESSAGE_TYPE.INTERNAL_NOTE
      ),
    });
  }
};

const resolveNextTicketStatusForMessage = ({ ticket, type }) => {
  if (type === TICKET_MESSAGE_TYPE.INTERNAL_NOTE) {
    return ticket.status;
  }

  if (type === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE) {
    return TICKET_STATUS.OPEN;
  }

  if (type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    return TICKET_STATUS.WAITING_ON_CUSTOMER;
  }

  return ticket.status;
};

const applyStatusSideEffects = ({ ticket, type, eventAt }) => {
  if (type === TICKET_MESSAGE_TYPE.INTERNAL_NOTE) {
    return;
  }

  if (type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    applyFirstResponseSlaOnPublicReply({
      ticket,
      eventAt,
    });
  }

  const currentStatus = ticket.status;
  const nextStatus = resolveNextTicketStatusForMessage({
    ticket,
    type,
  });

  applyTicketStatusTransitionSla({
    ticket,
    currentStatus,
    nextStatus,
    eventAt,
  });
  ticket.status = nextStatus;
};

const applyMessageSummarySideEffects = ({
  ticket,
  conversation,
  message,
  attachmentCount,
}) => {
  const eventAt = message.createdAt || new Date();
  const preview = buildMessagePreview(message.bodyText);

  ticket.messageCount = Number(ticket.messageCount || 0) + 1;
  conversation.messageCount = Number(conversation.messageCount || 0) + 1;

  ticket.attachmentCount =
    Number(ticket.attachmentCount || 0) + attachmentCount;
  conversation.attachmentCount =
    Number(conversation.attachmentCount || 0) + attachmentCount;

  ticket.lastMessageAt = eventAt;
  ticket.lastMessageType = message.type;
  ticket.lastMessagePreview = preview;

  conversation.lastMessageAt = eventAt;
  conversation.lastMessageType = message.type;
  conversation.lastMessagePreview = preview;

  if (message.type === TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE) {
    ticket.lastCustomerMessageAt = eventAt;
  }

  if (message.type === TICKET_MESSAGE_TYPE.PUBLIC_REPLY) {
    ticket.publicMessageCount = Number(ticket.publicMessageCount || 0) + 1;
    conversation.publicMessageCount =
      Number(conversation.publicMessageCount || 0) + 1;
    ticket.lastPublicReplyAt = eventAt;
  }

  if (message.type === TICKET_MESSAGE_TYPE.INTERNAL_NOTE) {
    ticket.internalNoteCount = Number(ticket.internalNoteCount || 0) + 1;
    conversation.internalNoteCount =
      Number(conversation.internalNoteCount || 0) + 1;
    ticket.lastInternalNoteAt = eventAt;
  }

  applyStatusSideEffects({
    ticket,
    type: message.type,
    eventAt,
  });
};

const captureTicketMessageState = (ticket) => ({
  messageCount: Number(ticket.messageCount || 0),
  publicMessageCount: Number(ticket.publicMessageCount || 0),
  internalNoteCount: Number(ticket.internalNoteCount || 0),
  attachmentCount: Number(ticket.attachmentCount || 0),
  lastMessageAt: ticket.lastMessageAt || null,
  lastCustomerMessageAt: ticket.lastCustomerMessageAt || null,
  lastPublicReplyAt: ticket.lastPublicReplyAt || null,
  lastInternalNoteAt: ticket.lastInternalNoteAt || null,
  lastMessageType: ticket.lastMessageType || null,
  lastMessagePreview: ticket.lastMessagePreview || null,
  status: ticket.status,
  statusChangedAt: ticket.statusChangedAt || null,
  closedAt: ticket.closedAt || null,
  sla: clonePlainObject(ticket.sla),
});

const captureConversationState = (conversation) => ({
  messageCount: Number(conversation.messageCount || 0),
  publicMessageCount: Number(conversation.publicMessageCount || 0),
  internalNoteCount: Number(conversation.internalNoteCount || 0),
  attachmentCount: Number(conversation.attachmentCount || 0),
  lastMessageAt: conversation.lastMessageAt || null,
  lastMessageType: conversation.lastMessageType || null,
  lastMessagePreview: conversation.lastMessagePreview || null,
});

const rollbackMessageSummarySideEffects = async ({
  workspaceId,
  ticket,
  conversation,
  ticketSnapshot,
  conversationSnapshot,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await Promise.allSettled([
    Ticket.updateOne(
      {
        _id: ticket._id,
        workspaceId: workspaceObjectId,
        deletedAt: null,
      },
      {
        $set: {
          messageCount: ticketSnapshot.messageCount,
          publicMessageCount: ticketSnapshot.publicMessageCount,
          internalNoteCount: ticketSnapshot.internalNoteCount,
          attachmentCount: ticketSnapshot.attachmentCount,
          lastMessageAt: ticketSnapshot.lastMessageAt,
          lastCustomerMessageAt: ticketSnapshot.lastCustomerMessageAt,
          lastPublicReplyAt: ticketSnapshot.lastPublicReplyAt,
          lastInternalNoteAt: ticketSnapshot.lastInternalNoteAt,
          lastMessageType: ticketSnapshot.lastMessageType,
          lastMessagePreview: ticketSnapshot.lastMessagePreview,
          status: ticketSnapshot.status,
          statusChangedAt: ticketSnapshot.statusChangedAt,
          closedAt: ticketSnapshot.closedAt,
          sla: ticketSnapshot.sla,
        },
      }
    ),
    Conversation.updateOne(
      {
        _id: conversation._id,
        workspaceId: workspaceObjectId,
        deletedAt: null,
      },
      {
        $set: {
          messageCount: conversationSnapshot.messageCount,
          publicMessageCount: conversationSnapshot.publicMessageCount,
          internalNoteCount: conversationSnapshot.internalNoteCount,
          attachmentCount: conversationSnapshot.attachmentCount,
          lastMessageAt: conversationSnapshot.lastMessageAt,
          lastMessageType: conversationSnapshot.lastMessageType,
          lastMessagePreview: conversationSnapshot.lastMessagePreview,
        },
      }
    ),
  ]);
};

const validateAndLoadAttachmentFiles = async ({
  workspaceId,
  attachmentFileIds = [],
}) => {
  if (!Array.isArray(attachmentFileIds) || attachmentFileIds.length === 0) {
    return [];
  }

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalizedAttachmentIds = attachmentFileIds.map((fileId) =>
    toObjectIdIfValid(fileId)
  );

  const files = await File.find({
    _id: { $in: normalizedAttachmentIds },
    workspaceId: workspaceObjectId,
    deletedAt: null,
    storageStatus: 'ready',
  })
    .select(ATTACHMENT_LINK_PROJECTION)
    .lean();

  if (files.length !== normalizedAttachmentIds.length) {
    throw createError('errors.file.notFound', 404);
  }

  const linkedFiles = await FileLink.find({
    workspaceId: workspaceObjectId,
    fileId: { $in: normalizedAttachmentIds },
    entityType: FILE_LINK_ENTITY_TYPE.MESSAGE,
    relationType: FILE_LINK_RELATION_TYPE.ATTACHMENT,
    deletedAt: null,
  })
    .select('fileId')
    .lean();

  if (linkedFiles.length > 0) {
    throw createError('errors.ticket.attachmentAlreadyLinked', 409);
  }

  const filesById = new Map(files.map((file) => [String(file._id), file]));

  return normalizedAttachmentIds.map((fileId) => filesById.get(String(fileId)));
};

const linkAttachments = async ({
  workspaceId,
  ticketId,
  messageId,
  files,
  attachedByUserId,
}) => {
  const createdLinks = [];

  for (const file of files) {
    await createLink({
      workspaceId,
      fileId: file._id,
      entityType: FILE_LINK_ENTITY_TYPE.MESSAGE,
      entityId: messageId,
      relationType: FILE_LINK_RELATION_TYPE.ATTACHMENT,
      attachedByUserId,
    });
    createdLinks.push({
      fileId: file._id,
      entityType: FILE_LINK_ENTITY_TYPE.MESSAGE,
      entityId: messageId,
      relationType: FILE_LINK_RELATION_TYPE.ATTACHMENT,
    });

    await createLink({
      workspaceId,
      fileId: file._id,
      entityType: FILE_LINK_ENTITY_TYPE.TICKET,
      entityId: ticketId,
      relationType: FILE_LINK_RELATION_TYPE.ATTACHMENT,
      attachedByUserId,
    });
    createdLinks.push({
      fileId: file._id,
      entityType: FILE_LINK_ENTITY_TYPE.TICKET,
      entityId: ticketId,
      relationType: FILE_LINK_RELATION_TYPE.ATTACHMENT,
    });
  }

  return createdLinks;
};

const hydrateMessages = async ({ workspaceId, messages }) => {
  const safeMessages = Array.isArray(messages) ? messages : [];
  if (safeMessages.length === 0) {
    return [];
  }

  const attachmentIds = new Set();
  const createdByUserIds = new Set();

  for (const message of safeMessages) {
    for (const fileId of message.attachmentFileIds || []) {
      if (fileId) {
        attachmentIds.add(String(fileId));
      }
    }

    if (message.createdByUserId) {
      createdByUserIds.add(String(message.createdByUserId));
    }
  }

  const [files, users] = await Promise.all([
    attachmentIds.size
      ? File.find({
          _id: {
            $in: [...attachmentIds].map((fileId) => toObjectIdIfValid(fileId)),
          },
          workspaceId: toObjectIdIfValid(workspaceId),
          deletedAt: null,
        })
          .select(ATTACHMENT_SUMMARY_PROJECTION)
          .lean()
      : [],
    createdByUserIds.size
      ? User.find({
          _id: {
            $in: [...createdByUserIds].map((userId) =>
              toObjectIdIfValid(userId)
            ),
          },
          deletedAt: null,
        })
          .select(USER_MESSAGE_SUMMARY_PROJECTION)
          .lean()
      : [],
  ]);

  const attachmentsById = new Map(
    files.map((file) => [String(file._id), buildAttachmentSummaryView(file)])
  );
  const createdByUsersById = new Map(
    users.map((user) => [String(user._id), buildCreatedBySummaryView(user)])
  );

  return safeMessages.map((message) =>
    buildMessageView({
      message,
      attachmentsById,
      createdByUsersById,
    })
  );
};

const buildConversationView = ({ conversation, mailbox }) => ({
  ...buildConversationSummaryView(conversation),
  mailbox: mailbox ? buildMailboxSummaryView(mailbox) : null,
});

const normalizeCreatePayload = (payload = {}) => ({
  type: payload.type,
  bodyText: String(payload.bodyText || '').trim(),
  bodyHtml: normalizeNullableString(payload.bodyHtml),
  attachmentFileIds: Array.isArray(payload.attachmentFileIds)
    ? payload.attachmentFileIds
        .map((fileId) => normalizeNullableString(fileId))
        .filter(Boolean)
    : [],
});

export const createTicketMessage = async ({
  workspaceId,
  ticketId,
  createdByUserId,
  payload,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_MESSAGE_WRITE_PROJECTION,
  });
  const conversation = await findConversationForTicketOrThrow({
    workspaceId: workspaceObjectId,
    ticket,
    lean: false,
  });
  const normalized = normalizeCreatePayload(payload);
  assertMessageWriteAllowedForTicket({
    ticket,
    type: normalized.type,
  });
  const ticketSnapshot = captureTicketMessageState(ticket);
  const conversationSnapshot = captureConversationState(conversation);
  const attachmentFiles = await validateAndLoadAttachmentFiles({
    workspaceId: workspaceObjectId,
    attachmentFileIds: normalized.attachmentFileIds,
  });
  const eventAt = new Date();
  const transportTimestamps = resolveTransportTimestamps({
    type: normalized.type,
    eventAt,
  });
  const messageParties = await resolveManualMessageParties({
    workspaceId: workspaceObjectId,
    ticket,
    type: normalized.type,
  });

  let message = null;
  let createdLinks = [];
  let appliedSummarySideEffects = false;

  try {
    message = await Message.create({
      workspaceId: workspaceObjectId,
      conversationId: conversation._id,
      ticketId: ticket._id,
      mailboxId: ticket.mailboxId,
      channel: ticket.channel,
      type: normalized.type,
      direction: resolveMessageDirection(normalized.type),
      from: messageParties.from,
      to: messageParties.to,
      subject: ticket.subject,
      bodyText: normalized.bodyText,
      bodyHtml: normalized.bodyHtml,
      attachmentFileIds: attachmentFiles.map((file) => file._id),
      sentAt: transportTimestamps.sentAt,
      receivedAt: transportTimestamps.receivedAt,
      createdByUserId: createdByUserId
        ? toObjectIdIfValid(createdByUserId)
        : null,
    });

    createdLinks = await linkAttachments({
      workspaceId: workspaceObjectId,
      ticketId: ticket._id,
      messageId: message._id,
      files: attachmentFiles,
      attachedByUserId: toObjectIdIfValid(createdByUserId),
    });

    applyMessageSummarySideEffects({
      ticket,
      conversation,
      message,
      attachmentCount: attachmentFiles.length,
    });
    appliedSummarySideEffects = true;

    await Promise.all([ticket.save(), conversation.save()]);
  } catch (error) {
    if (createdLinks.length > 0) {
      await Promise.allSettled(
        createdLinks.map((link) =>
          unlink({
            workspaceId: workspaceObjectId,
            fileId: link.fileId,
            entityType: link.entityType,
            entityId: link.entityId,
            relationType: link.relationType,
            deletedByUserId: createdByUserId
              ? toObjectIdIfValid(createdByUserId)
              : null,
          })
        )
      );
    }

    const messageDeleteResults = await Promise.allSettled(
      message?._id ? [Message.deleteOne({ _id: message._id })] : []
    );
    const messageDeleted =
      messageDeleteResults.length === 0 ||
      messageDeleteResults.every((result) => result.status === 'fulfilled');

    if (appliedSummarySideEffects && messageDeleted) {
      await rollbackMessageSummarySideEffects({
        workspaceId: workspaceObjectId,
        ticket,
        conversation,
        ticketSnapshot,
        conversationSnapshot,
      });
    }

    throw error;
  }

  const [hydratedMessage] = await hydrateMessages({
    workspaceId: workspaceObjectId,
    messages: [message.toObject()],
  });

  return {
    messageRecord: hydratedMessage,
    conversation: buildConversationSummaryView(conversation),
    ticketSummary: {
      _id: normalizeObjectId(ticket._id),
      status: ticket.status,
      statusChangedAt: ticket.statusChangedAt || null,
      messageCount: Number(ticket.messageCount || 0),
      publicMessageCount: Number(ticket.publicMessageCount || 0),
      internalNoteCount: Number(ticket.internalNoteCount || 0),
      attachmentCount: Number(ticket.attachmentCount || 0),
      lastMessageAt: ticket.lastMessageAt || null,
      lastCustomerMessageAt: ticket.lastCustomerMessageAt || null,
      lastPublicReplyAt: ticket.lastPublicReplyAt || null,
      lastInternalNoteAt: ticket.lastInternalNoteAt || null,
      lastMessageType: ticket.lastMessageType || null,
      lastMessagePreview: ticket.lastMessagePreview || null,
      sla: (() => {
        const derived = deriveTicketSlaState({
          sla: ticket.sla,
          now: new Date(),
        });

        return {
          policyName: ticket?.sla?.policyName || null,
          businessHoursName: ticket?.sla?.businessHoursName || null,
          firstResponseAt: ticket?.sla?.firstResponseAt || null,
          resolvedAt: ticket?.sla?.resolvedAt || null,
          resolutionDueAt: ticket?.sla?.resolutionDueAt || null,
          resolutionRemainingBusinessMinutes:
            ticket?.sla?.resolutionRemainingBusinessMinutes ?? null,
          isFirstResponseBreached: derived.isFirstResponseBreached,
          isResolutionBreached: derived.isResolutionBreached,
          firstResponseStatus: derived.firstResponseStatus,
          resolutionStatus: derived.resolutionStatus,
          isApplicable: derived.isApplicable,
          isBreached: derived.isBreached,
        };
      })(),
    },
  };
};

export const getTicketConversationByTicketId = async ({
  workspaceId,
  ticketId,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: true,
    projection: TICKET_MESSAGE_WRITE_PROJECTION,
  });
  const conversation = await findConversationForTicketOrThrow({
    workspaceId: workspaceObjectId,
    ticket,
    lean: true,
  });
  const mailbox = await Mailbox.findOne({
    _id: ticket.mailboxId,
    workspaceId: workspaceObjectId,
    deletedAt: null,
  })
    .select(MAILBOX_SUMMARY_PROJECTION)
    .lean();

  return {
    conversation: buildConversationView({
      conversation,
      mailbox,
    }),
  };
};

export const listTicketMessages = async ({
  workspaceId,
  ticketId,
  page = 1,
  limit = 20,
  type = null,
  sort = null,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: true,
    projection: TICKET_MESSAGE_WRITE_PROJECTION,
  });
  const conversation = await findConversationForTicketOrThrow({
    workspaceId: workspaceObjectId,
    ticket,
    lean: true,
  });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = {
    workspaceId: workspaceObjectId,
    ticketId: ticket._id,
    conversationId: conversation._id,
    deletedAt: null,
  };

  if (type) {
    query.type = type;
  }

  const [total, messages] = await Promise.all([
    Message.countDocuments(query),
    Message.find(query)
      .sort(buildSort(String(sort || '').trim()))
      .skip(skip)
      .limit(safeLimit)
      .select(MESSAGE_BASE_PROJECTION)
      .lean(),
  ]);

  const hydratedMessages = await hydrateMessages({
    workspaceId: workspaceObjectId,
    messages,
  });

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: hydratedMessages.length,
    }),
    messages: hydratedMessages,
  };
};
