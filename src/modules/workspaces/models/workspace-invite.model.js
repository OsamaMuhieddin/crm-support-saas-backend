import mongoose from 'mongoose';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import {
  WORKSPACE_ROLE_VALUES,
  WORKSPACE_ROLES,
} from '../../../constants/workspace-roles.js';
import {
  INVITE_STATUS_VALUES,
  INVITE_STATUS,
} from '../../../constants/invite-status.js';

const workspaceInviteSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
    },
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
      set: normalizeEmail,
    },
    roleKey: {
      type: String,
      required: true,
      enum: WORKSPACE_ROLE_VALUES,
      default: WORKSPACE_ROLES.AGENT,
    },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: INVITE_STATUS_VALUES,
      default: INVITE_STATUS.PENDING,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
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

workspaceInviteSchema.pre('validate', function normalizeEmailFields(next) {
  if (this.isModified('email') || !this.emailNormalized) {
    this.emailNormalized = normalizeEmail(this.email);
  }

  next();
});

workspaceInviteSchema.index({ tokenHash: 1 }, { unique: true });
workspaceInviteSchema.index(
  { workspaceId: 1, emailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: INVITE_STATUS.PENDING,
      deletedAt: null,
    },
  }
);
workspaceInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WorkspaceInvite =
  mongoose.models.WorkspaceInvite ||
  mongoose.model('WorkspaceInvite', workspaceInviteSchema);
