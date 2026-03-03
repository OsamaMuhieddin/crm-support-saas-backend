import mongoose from 'mongoose';

const slaPolicyRuleSchema = new mongoose.Schema(
  {
    firstResponseMinutes: {
      type: Number,
      min: 0,
      default: null
    },
    nextResponseMinutes: {
      type: Number,
      min: 0,
      default: null
    },
    resolutionMinutes: {
      type: Number,
      min: 0,
      default: null
    }
  },
  {
    _id: false,
    strict: true
  }
);

const slaPolicyRulesByPrioritySchema = new mongoose.Schema(
  {
    low: {
      type: slaPolicyRuleSchema,
      default: () => ({})
    },
    normal: {
      type: slaPolicyRuleSchema,
      default: () => ({})
    },
    high: {
      type: slaPolicyRuleSchema,
      default: () => ({})
    },
    urgent: {
      type: slaPolicyRuleSchema,
      default: () => ({})
    }
  },
  {
    _id: false,
    strict: true
  }
);

const slaPolicySchema = new mongoose.Schema(
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
      maxlength: 140
    },
    isDefault: {
      type: Boolean,
      default: false
    },
    rulesByPriority: {
      type: slaPolicyRulesByPrioritySchema,
      default: () => ({})
    },
    businessHoursId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessHours',
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

slaPolicySchema.index({ workspaceId: 1, isDefault: 1 });

export const SlaPolicy =
  mongoose.models.SlaPolicy || mongoose.model('SlaPolicy', slaPolicySchema);

