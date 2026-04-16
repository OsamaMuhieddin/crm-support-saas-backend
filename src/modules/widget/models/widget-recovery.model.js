import mongoose from 'mongoose';

const widgetRecoverySchema = new mongoose.Schema(
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
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null,
    },
    candidateSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WidgetSession',
      default: null,
    },
    candidateTicketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    recoveryTokenHash: {
      type: String,
      required: true,
      trim: true,
    },
    verifiedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    consumedAction: {
      type: String,
      enum: ['continue', 'start_new', null],
      default: null,
    },
  },
  {
    strict: true,
    timestamps: true,
  }
);

widgetRecoverySchema.index(
  { recoveryTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      recoveryTokenHash: { $type: 'string' },
      consumedAt: null,
    },
  }
);
widgetRecoverySchema.index(
  { workspaceId: 1, widgetId: 1, emailNormalized: 1, verifiedAt: -1 },
  {
    name: 'widget_recovery_widget_email_verified_idx',
  }
);
widgetRecoverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WidgetRecovery =
  mongoose.models.WidgetRecovery ||
  mongoose.model('WidgetRecovery', widgetRecoverySchema);
