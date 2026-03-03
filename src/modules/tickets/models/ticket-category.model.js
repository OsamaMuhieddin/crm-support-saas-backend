import mongoose from 'mongoose';
const normalizeSlug = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '') || undefined;
};

const ticketCategorySchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
      set: normalizeSlug
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketCategory',
      default: null
    },
    path: {
      type: String,
      trim: true,
      default: null
    },
    order: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
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

ticketCategorySchema.index(
  { workspaceId: 1, slug: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);
ticketCategorySchema.index({ workspaceId: 1, parentId: 1 });
ticketCategorySchema.index(
  { workspaceId: 1, path: 1 },
  { partialFilterExpression: { path: { $type: 'string' } } }
);

export const TicketCategory =
  mongoose.models.TicketCategory ||
  mongoose.model('TicketCategory', ticketCategorySchema);

