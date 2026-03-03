import mongoose from 'mongoose';
import { TICKET_CHANNEL_VALUES, TICKET_CHANNEL } from '../../../constants/ticket-channel.js';

const conversationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true
    },
    channel: {
      type: String,
      required: true,
      enum: TICKET_CHANNEL_VALUES,
      default: TICKET_CHANNEL.EMAIL
    },
    lastMessageAt: {
      type: Date,
      default: null
    },
    messageCount: {
      type: Number,
      min: 0,
      default: 0
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

conversationSchema.index({ workspaceId: 1, ticketId: 1 }, { unique: true });
conversationSchema.index({ workspaceId: 1, mailboxId: 1, lastMessageAt: -1 });
conversationSchema.index({ workspaceId: 1, lastMessageAt: -1 });

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model('Conversation', conversationSchema);

