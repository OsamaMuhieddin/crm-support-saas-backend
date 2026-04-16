import mongoose from 'mongoose';

const widgetSessionSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    widgetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Widget',
      required: true,
      index: true,
    },
    publicSessionKeyHash: {
      type: String,
      trim: true,
      default: null,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    invalidatedAt: {
      type: Date,
      default: null,
    },
    invalidationReason: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },
    recoveryVerifiedAt: {
      type: Date,
      default: null,
    },
    recoveredFromSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WidgetSession',
      default: null,
    },
    closedAt: {
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

widgetSessionSchema.index(
  { publicSessionKeyHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      publicSessionKeyHash: { $type: 'string' },
      deletedAt: null,
    },
  }
);
widgetSessionSchema.index(
  { workspaceId: 1, widgetId: 1, updatedAt: -1 },
  {
    name: 'widget_session_workspace_widget_updated_idx',
  }
);
widgetSessionSchema.index(
  { workspaceId: 1, ticketId: 1 },
  {
    partialFilterExpression: {
      ticketId: { $type: 'objectId' },
      deletedAt: null,
    },
    name: 'widget_session_workspace_ticket_idx',
  }
);
widgetSessionSchema.index(
  { workspaceId: 1, contactId: 1 },
  {
    partialFilterExpression: {
      contactId: { $type: 'objectId' },
      deletedAt: null,
    },
    name: 'widget_session_workspace_contact_idx',
  }
);
widgetSessionSchema.index(
  { workspaceId: 1, widgetId: 1, recoveredFromSessionId: 1, createdAt: -1 },
  {
    partialFilterExpression: {
      recoveredFromSessionId: { $type: 'objectId' },
    },
    name: 'widget_session_recovered_from_idx',
  }
);

export const WidgetSession =
  mongoose.models.WidgetSession ||
  mongoose.model('WidgetSession', widgetSessionSchema);
