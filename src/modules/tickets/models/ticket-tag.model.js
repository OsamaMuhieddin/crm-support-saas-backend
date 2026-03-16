import mongoose from 'mongoose';
import { normalizeName } from '../../../shared/utils/normalize.js';

const ticketTagSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    nameNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      set: normalizeName,
    },
    isActive: {
      type: Boolean,
      default: true,
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

ticketTagSchema.pre('validate', function normalizeTagName(next) {
  if (this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeName(this.name);
  }

  next();
});

ticketTagSchema.index(
  { workspaceId: 1, nameNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);
ticketTagSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  isActive: 1,
  nameNormalized: 1,
});

export const TicketTag =
  mongoose.models.TicketTag || mongoose.model('TicketTag', ticketTagSchema);
