import mongoose, { Schema, Document } from 'mongoose';

export interface ICommandEvent extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  command: string;
  userId?: string;
  guildId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  createdAt: Date;
}

const commandEventSchema = new Schema(
  {
    botId: { type: String, required: true },
    shardId: { type: Number, required: true, default: 0 },
    totalShards: { type: Number, required: true, default: 1 },
    command: { type: String, required: true },
    userId: { type: String },
    guildId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Compound indexes for dashboard query performance
// These cover single-field queries via leftmost prefix (no redundant individual indexes needed)
commandEventSchema.index({ botId: 1, timestamp: -1 });
commandEventSchema.index({ botId: 1, command: 1, timestamp: -1 });
commandEventSchema.index({ botId: 1, shardId: 1, timestamp: -1 });

// TTL: Auto-expire command traces after 90 days to keep active indexes lean
commandEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const CommandEvent = mongoose.models.CommandEvent || mongoose.model<ICommandEvent>('CommandEvent', commandEventSchema);
