import mongoose from 'mongoose';

const automationRuleSchema = new mongoose.Schema(
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
      maxlength: 160
    },
    enabled: {
      type: Boolean,
      default: true
    },
    trigger: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    actions: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
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

automationRuleSchema.index({ workspaceId: 1, enabled: 1 });

export const AutomationRule =
  mongoose.models.AutomationRule ||
  mongoose.model('AutomationRule', automationRuleSchema);

