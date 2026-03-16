import mongoose from 'mongoose';
import {
  TICKET_PARTICIPANT_TYPE,
  TICKET_PARTICIPANT_TYPE_VALUES,
} from '../../../constants/ticket-participant-type.js';

const ticketParticipantSchema = new mongoose.Schema(
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: TICKET_PARTICIPANT_TYPE_VALUES,
      default: TICKET_PARTICIPANT_TYPE.WATCHER,
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

ticketParticipantSchema.index(
  { workspaceId: 1, ticketId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);
ticketParticipantSchema.index({
  workspaceId: 1,
  ticketId: 1,
  deletedAt: 1,
  createdAt: 1,
});

export const TicketParticipant =
  mongoose.models.TicketParticipant ||
  mongoose.model('TicketParticipant', ticketParticipantSchema);
