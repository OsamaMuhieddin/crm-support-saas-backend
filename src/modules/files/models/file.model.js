import mongoose from 'mongoose';
import {
  FILE_PROVIDER,
  FILE_PROVIDER_VALUES,
} from '../../../constants/file-provider.js';

const STORAGE_STATUS_VALUES = ['ready', 'deleted', 'failed'];

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const fileSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    uploadedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: FILE_PROVIDER_VALUES,
      default: FILE_PROVIDER.MINIO,
    },
    bucket: {
      type: String,
      required: true,
      trim: true,
    },
    objectKey: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      trim: true,
      default: null,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    originalNameNormalized: {
      type: String,
      required: true,
      trim: true,
    },
    extension: {
      type: String,
      trim: true,
      default: null,
    },
    checksum: {
      type: String,
      trim: true,
      default: null,
    },
    storageStatus: {
      type: String,
      enum: STORAGE_STATUS_VALUES,
      default: 'ready',
    },
    etag: {
      type: String,
      trim: true,
      default: null,
    },
    isPrivate: {
      type: Boolean,
      default: true,
    },
    kind: {
      type: String,
      trim: true,
      default: null,
    },
    source: {
      type: String,
      trim: true,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastAccessedAt: {
      type: Date,
      default: null,
    },
    downloadCount: {
      type: Number,
      default: 0,
      min: 0,
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

fileSchema.pre('validate', function syncDerivedFields(next) {
  if (this.isModified('originalName') || !this.originalNameNormalized) {
    this.originalNameNormalized = normalizeName(this.originalName);
  }

  if (this.extension && !String(this.extension).startsWith('.')) {
    this.extension = `.${this.extension}`.toLowerCase();
  }

  next();
});

fileSchema.index({ provider: 1, bucket: 1, objectKey: 1 }, { unique: true });
fileSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, uploadedByUserId: 1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, mimeType: 1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, extension: 1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, kind: 1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, originalNameNormalized: 1 });
fileSchema.index({ workspaceId: 1, deletedAt: 1, storageStatus: 1 });

export const File = mongoose.models.File || mongoose.model('File', fileSchema);
