import mongoose from 'mongoose';
import {
  TICKET_STATUS_VALUES,
  TICKET_STATUS
} from '../../../constants/ticket-status.js';
import {
  TICKET_PRIORITY_VALUES,
  TICKET_PRIORITY
} from '../../../constants/ticket-priority.js';
import {
  TICKET_CHANNEL_VALUES,
  TICKET_CHANNEL
} from '../../../constants/ticket-channel.js';
import {
  TICKET_MESSAGE_TYPE_VALUES
} from '../../../constants/ticket-message-type.js';
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
      default: TICKET_CHANNEL.MANUAL
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketCategory',
      default: null
    },
    tagIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'TicketTag'
        }
      ],
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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null
    },
    widgetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Widget',
      default: null
    },
    widgetSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WidgetSession',
      default: null
    },
    messageCount: {
      type: Number,
      min: 0,
      default: 0
    },
    publicMessageCount: {
      type: Number,
      min: 0,
      default: 0
    },
    internalNoteCount: {
      type: Number,
      min: 0,
      default: 0
    },
    attachmentCount: {
      type: Number,
      min: 0,
      default: 0
    },
    participantCount: {
      type: Number,
      min: 0,
      default: 0
    },
    lastMessageAt: {
      type: Date,
      default: null
    },
    lastCustomerMessageAt: {
      type: Date,
      default: null
    },
    lastPublicReplyAt: {
      type: Date,
      default: null
    },
    lastInternalNoteAt: {
      type: Date,
      default: null
    },
    lastMessageType: {
      type: String,
      enum: [...TICKET_MESSAGE_TYPE_VALUES, null],
      default: null
    },
    lastMessagePreview: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null
    },
    statusChangedAt: {
      type: Date,
      default: Date.now
    },
    assignedAt: {
      type: Date,
      default: null
    },
    closedAt: {
      type: Date,
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

  if ((this.isNew && !this.statusChangedAt) || this.isModified('status')) {
    this.statusChangedAt = new Date();
  }

  if (this.isModified('assigneeId')) {
    this.assignedAt = this.assigneeId ? new Date() : null;
  }

  if (this.isModified('status')) {
    this.closedAt =
      this.status === TICKET_STATUS.CLOSED ? new Date() : null;
  }

  next();
});

ticketSchema.index({ workspaceId: 1, number: 1 }, { unique: true });
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  mailboxId: 1,
  status: 1,
  updatedAt: -1
});
ticketSchema.index({ workspaceId: 1, deletedAt: 1, status: 1, updatedAt: -1 });
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  assigneeId: 1,
  status: 1,
  updatedAt: -1
});
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  contactId: 1,
  createdAt: -1
});
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  widgetSessionId: 1,
  createdAt: -1
});
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  widgetId: 1,
  createdAt: -1
});
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  organizationId: 1,
  createdAt: -1
});
ticketSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  categoryId: 1,
  status: 1,
  updatedAt: -1
});
ticketSchema.index({ workspaceId: 1, deletedAt: 1, tagIds: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, deletedAt: 1, priority: 1, updatedAt: -1 });
ticketSchema.index({ workspaceId: 1, deletedAt: 1, channel: 1, createdAt: -1 });
ticketSchema.index({ workspaceId: 1, deletedAt: 1, lastMessageAt: -1 });

export const Ticket =
  mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
