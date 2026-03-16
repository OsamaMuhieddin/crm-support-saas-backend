import mongoose from 'mongoose';
import { MESSAGE_DIRECTION_VALUES } from '../../../constants/message-direction.js';
import {
  TICKET_CHANNEL_VALUES,
  TICKET_CHANNEL,
} from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE_VALUES } from '../../../constants/ticket-message-type.js';
import messagePartySchema from '../schemas/message-party.schema.js';

const messageSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true,
    },
    channel: {
      type: String,
      required: true,
      enum: TICKET_CHANNEL_VALUES,
      default: TICKET_CHANNEL.MANUAL,
    },
    type: {
      type: String,
      required: true,
      enum: TICKET_MESSAGE_TYPE_VALUES,
    },
    direction: {
      type: String,
      enum: [...MESSAGE_DIRECTION_VALUES, null],
      default: null,
    },
    from: {
      type: messagePartySchema,
      default: null,
    },
    to: {
      type: [messagePartySchema],
      default: [],
    },
    subject: {
      type: String,
      trim: true,
      default: null,
    },
    bodyText: {
      type: String,
      required: true,
    },
    bodyHtml: {
      type: String,
      default: null,
    },
    attachmentFileIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'File',
        },
      ],
      default: [],
    },
    sentAt: {
      type: Date,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: null,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    strict: true,
    timestamps: true,
  }
);

messageSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  conversationId: 1,
  createdAt: 1,
});
messageSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  ticketId: 1,
  createdAt: 1,
});
messageSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  ticketId: 1,
  type: 1,
  createdAt: 1,
});
messageSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  mailboxId: 1,
  createdAt: 1,
});
messageSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  direction: 1,
  createdAt: 1,
});

export const Message =
  mongoose.models.Message || mongoose.model('Message', messageSchema);
