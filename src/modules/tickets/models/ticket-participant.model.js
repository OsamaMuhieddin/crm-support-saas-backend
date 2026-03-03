import mongoose from 'mongoose';

const TICKET_PARTICIPANT_TYPES = Object.freeze(['watcher', 'collaborator']);

const ticketParticipantSchema = new mongoose.Schema(
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      required: true,
      enum: TICKET_PARTICIPANT_TYPES,
      default: 'watcher'
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

ticketParticipantSchema.index(
  { workspaceId: 1, ticketId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);

export const TicketParticipant =
  mongoose.models.TicketParticipant ||
  mongoose.model('TicketParticipant', ticketParticipantSchema);

