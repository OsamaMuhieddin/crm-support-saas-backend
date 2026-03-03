import mongoose from 'mongoose';
import { TICKET_STATUS_VALUES, TICKET_STATUS } from '../../../constants/ticket-status.js';
import { TICKET_PRIORITY_VALUES, TICKET_PRIORITY } from '../../../constants/ticket-priority.js';
import { TICKET_CHANNEL_VALUES, TICKET_CHANNEL } from '../../../constants/ticket-channel.js';
import { normalizeSubject } from '../../../shared/utils/normalize.js';
import ticketSlaSchema from '../schemas/ticket-sla.schema.js';

const ticketSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true
    },
    number: {
      type: Number,
      required: true,
      min: 1
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    subjectNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
      set: normalizeSubject
    },
    status: {
      type: String,
      required: true,
      enum: TICKET_STATUS_VALUES,
      default: TICKET_STATUS.NEW
    },
    priority: {
      type: String,
      required: true,
      enum: TICKET_PRIORITY_VALUES,
      default: TICKET_PRIORITY.NORMAL
    },
    channel: {
      type: String,
      required: true,
      enum: TICKET_CHANNEL_VALUES,
      default: TICKET_CHANNEL.EMAIL
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketCategory',
      default: null
    },
    tags: {
      type: [String],
      default: []
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    sla: {
      type: ticketSlaSchema,
      default: () => ({})
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

ticketSchema.pre('validate', function normalizeTicketSubject(next) {
  if (this.isModified('subject') || !this.subjectNormalized) {
    this.subjectNormalized = normalizeSubject(this.subject);
  }

  next();
});

ticketSchema.index({ workspaceId: 1, number: 1 }, { unique: true });
ticketSchema.index({ workspaceId: 1, mailboxId: 1, status: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, assigneeId: 1, status: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
ticketSchema.index({ workspaceId: 1, categoryId: 1, status: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, priority: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, channel: 1, createdAt: -1 });

export const Ticket =
  mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);

