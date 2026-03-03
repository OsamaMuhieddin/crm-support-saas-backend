import mongoose from 'mongoose';
import { FILE_PROVIDER_VALUES, FILE_PROVIDER } from '../../../constants/file-provider.js';

const fileSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    uploadedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      required: true,
      enum: FILE_PROVIDER_VALUES,
      default: FILE_PROVIDER.MINIO
    },
    bucket: {
      type: String,
      required: true,
      trim: true
    },
    objectKey: {
      type: String,
      required: true,
      trim: true
    },
    url: {
      type: String,
      trim: true,
      default: null
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0
    },
    mimeType: {
      type: String,
      required: true,
      trim: true
    },
    originalName: {
      type: String,
      required: true,
      trim: true
    },
    checksum: {
      type: String,
      trim: true,
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

fileSchema.index({ provider: 1, bucket: 1, objectKey: 1 }, { unique: true });
fileSchema.index({ workspaceId: 1, createdAt: -1 });
fileSchema.index({ workspaceId: 1, uploadedByUserId: 1 });

export const File = mongoose.models.File || mongoose.model('File', fileSchema);

