import mongoose from 'mongoose';
import {
  NOTIFICATION_TYPE_VALUES,
  NOTIFICATION_TYPE
} from '../../../constants/notification-type.js';
import notificationEntitySchema from '../schemas/notification-entity.schema.js';

const notificationSchema = new mongoose.Schema(
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
    type: {
      type: String,
      required: true,
      enum: NOTIFICATION_TYPE_VALUES,
      default: NOTIFICATION_TYPE.SYSTEM
    },
    entity: {
      type: notificationEntitySchema,
      default: null
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    readAt: {
      type: Date,
      default: null
    },
    expiresAt: {
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

notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ workspaceId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ workspaceId: 1, type: 1, createdAt: -1 });

export const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);

