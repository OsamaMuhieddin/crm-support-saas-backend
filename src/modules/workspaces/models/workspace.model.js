import mongoose from 'mongoose';
import workspaceSettingsSchema from '../schemas/workspace-settings.schema.js';
import {
  WORKSPACE_STATUS_VALUES,
  WORKSPACE_STATUS
} from '../../../constants/workspace-status.js';

const workspaceSchema = new mongoose.Schema(
  {
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
      maxlength: 120
    },
    status: {
      type: String,
      enum: WORKSPACE_STATUS_VALUES,
      default: WORKSPACE_STATUS.ACTIVE
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    settings: {
      type: workspaceSettingsSchema,
      default: () => ({})
    },
    defaultMailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      default: null
    },
    defaultSlaPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SlaPolicy',
      default: null
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

workspaceSchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);
workspaceSchema.index({ ownerUserId: 1 });
workspaceSchema.index({ status: 1 });

export const Workspace =
  mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);
