import mongoose from 'mongoose';
import {
  TICKET_CHANNEL_VALUES,
  TICKET_CHANNEL,
} from '../../../constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE_VALUES } from '../../../constants/ticket-message-type.js';

const conversationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
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
    lastMessageAt: {
      type: Date,
      default: null,
    },
    messageCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    publicMessageCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    internalNoteCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    attachmentCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    lastMessageType: {
      type: String,
      enum: [...TICKET_MESSAGE_TYPE_VALUES, null],
      default: null,
    },
    lastMessagePreview: {
      type: String,
      trim: true,
      maxlength: 500,
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

conversationSchema.index({ workspaceId: 1, ticketId: 1 }, { unique: true });
conversationSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  mailboxId: 1,
  lastMessageAt: -1,
});
conversationSchema.index({ workspaceId: 1, deletedAt: 1, lastMessageAt: -1 });

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model('Conversation', conversationSchema);
