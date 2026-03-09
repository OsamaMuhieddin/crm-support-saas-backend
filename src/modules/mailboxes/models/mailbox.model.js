import mongoose from 'mongoose';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import { MAILBOX_TYPE_VALUES, MAILBOX_TYPE } from '../../../constants/mailbox-type.js';

const mailboxSchema = new mongoose.Schema(
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
    type: {
      type: String,
      required: true,
      enum: MAILBOX_TYPE_VALUES,
      default: MAILBOX_TYPE.EMAIL
    },
    emailAddress: {
      type: String,
      trim: true,
      default: null
    },
    emailAddressNormalized: {
      type: String,
      trim: true,
      default: null,
      set: normalizeEmail
    },
    fromName: {
      type: String,
      trim: true,
      default: null
    },
    replyTo: {
      type: String,
      trim: true,
      default: null
    },
    signatureText: {
      type: String,
      default: null
    },
    signatureHtml: {
      type: String,
      default: null
    },
    isDefault: {
      type: Boolean,
      default: false
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

mailboxSchema.pre('validate', function normalizeMailboxFields(next) {
  if (this.isModified('emailAddress')) {
    this.emailAddressNormalized = normalizeEmail(this.emailAddress);
  }

  next();
});

mailboxSchema.index(
  { workspaceId: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDefault: true,
      deletedAt: null
    }
  }
);
mailboxSchema.index({ workspaceId: 1, isActive: 1 });
mailboxSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  isActive: 1,
  isDefault: -1,
  createdAt: -1,
});
mailboxSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  name: 1,
});
mailboxSchema.index(
  { workspaceId: 1, emailAddressNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      emailAddressNormalized: { $type: 'string' },
      deletedAt: null
    }
  }
);

export const Mailbox =
  mongoose.models.Mailbox || mongoose.model('Mailbox', mailboxSchema);
