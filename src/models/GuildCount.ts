import mongoose, { Schema, Document } from 'mongoose';

export interface IGuildCount extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  count: number;
  timestamp: Date;
  createdAt: Date;
}

const guildCountSchema = new Schema(
  {
    botId: { type: String, required: true },
    shardId: { type: Number, required: true, default: 0 },
    totalShards: { type: Number, required: true, default: 1 },
    count: { type: Number, required: true },
    timestamp: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

guildCountSchema.index({ botId: 1, timestamp: -1 });
guildCountSchema.index({ botId: 1, shardId: 1, timestamp: -1 });

// TTL: Auto-expire guild count snapshots after 90 days
guildCountSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const GuildCount = mongoose.models.GuildCount || mongoose.model<IGuildCount>('GuildCount', guildCountSchema);
