import mongoose from 'mongoose';
import { normalizeName } from '../../../shared/utils/normalize.js';
import { generateSecureToken } from '../../../shared/utils/security.js';
import widgetBrandingSchema from '../schemas/widget-branding.schema.js';
import widgetBehaviorSchema from '../schemas/widget-behavior.schema.js';

const generateWidgetPublicKey = () => `wgt_${generateSecureToken(16)}`;

const widgetSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true,
      index: true,
    },
    publicKey: {
      type: String,
      required: true,
      trim: true,
      default: generateWidgetPublicKey,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    nameNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      set: normalizeName,
    },
    branding: {
      type: widgetBrandingSchema,
      default: () => ({}),
    },
    behavior: {
      type: widgetBehaviorSchema,
      default: () => ({}),
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

widgetSchema.pre('validate', function normalizeWidgetFields(next) {
  if (this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeName(this.name);
  }

  next();
});

widgetSchema.index({ publicKey: 1 }, { unique: true });
widgetSchema.index(
  { workspaceId: 1, deletedAt: 1, isActive: 1, createdAt: -1 },
  { name: 'widget_workspace_activity_created_idx' }
);
widgetSchema.index(
  { workspaceId: 1, deletedAt: 1, name: 1 },
  { name: 'widget_workspace_name_idx' }
);
widgetSchema.index(
  { workspaceId: 1, deletedAt: 1, nameNormalized: 1 },
  { name: 'widget_workspace_name_normalized_idx' }
);
widgetSchema.index(
  { workspaceId: 1, deletedAt: 1, mailboxId: 1 },
  { name: 'widget_workspace_mailbox_idx' }
);

export const Widget =
  mongoose.models.Widget || mongoose.model('Widget', widgetSchema);
