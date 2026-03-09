import mongoose from 'mongoose';

const fileLinkSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    relationType: {
      type: String,
      trim: true,
      default: null,
    },
    attachedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

fileLinkSchema.index({ workspaceId: 1, fileId: 1, deletedAt: 1 });
fileLinkSchema.index({
  workspaceId: 1,
  entityType: 1,
  entityId: 1,
  deletedAt: 1,
});
fileLinkSchema.index(
  {
    workspaceId: 1,
    fileId: 1,
    entityType: 1,
    entityId: 1,
    relationType: 1,
  },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);

export const FileLink =
  mongoose.models.FileLink || mongoose.model('FileLink', fileLinkSchema);
