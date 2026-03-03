import mongoose from 'mongoose';
import { WORKSPACE_ROLE_VALUES, WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { MEMBER_STATUS_VALUES, MEMBER_STATUS } from '../../../constants/member-status.js';

const workspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    roleKey: {
      type: String,
      required: true,
      enum: WORKSPACE_ROLE_VALUES,
      default: WORKSPACE_ROLES.AGENT
    },
    status: {
      type: String,
      required: true,
      enum: MEMBER_STATUS_VALUES,
      default: MEMBER_STATUS.ACTIVE
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    removedAt: {
      type: Date,
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

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMemberSchema.index({ workspaceId: 1, status: 1 });
workspaceMemberSchema.index({ workspaceId: 1, roleKey: 1 });

export const WorkspaceMember =
  mongoose.models.WorkspaceMember ||
  mongoose.model('WorkspaceMember', workspaceMemberSchema);

