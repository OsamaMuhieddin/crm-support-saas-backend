import mongoose from 'mongoose';
import { normalizeEmail } from '../../../shared/utils/normalize.js';

const mailboxAliasSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true
    },
    aliasEmail: {
      type: String,
      required: true,
      trim: true
    },
    aliasEmailNormalized: {
      type: String,
      required: true,
      trim: true,
      set: normalizeEmail
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

mailboxAliasSchema.pre('validate', function normalizeMailboxAliasFields(next) {
  if (this.isModified('aliasEmail') || !this.aliasEmailNormalized) {
    this.aliasEmailNormalized = normalizeEmail(this.aliasEmail);
  }

  next();
});

mailboxAliasSchema.index(
  { workspaceId: 1, aliasEmailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }
  }
);
mailboxAliasSchema.index({ workspaceId: 1, mailboxId: 1 });

export const MailboxAlias =
  mongoose.models.MailboxAlias ||
  mongoose.model('MailboxAlias', mailboxAliasSchema);
