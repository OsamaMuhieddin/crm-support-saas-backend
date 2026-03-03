import mongoose from 'mongoose';

const ticketCounterSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    seq: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

ticketCounterSchema.index({ workspaceId: 1 }, { unique: true });

ticketCounterSchema.statics.allocateNextNumber = async function allocateNextNumber(
  workspaceId
) {
  const counter = await this.findOneAndUpdate(
    { workspaceId },
    { $inc: { seq: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );

  return counter.seq;
};

export const TicketCounter =
  mongoose.models.TicketCounter ||
  mongoose.model('TicketCounter', ticketCounterSchema);

