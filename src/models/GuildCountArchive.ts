import mongoose, { Schema, Document } from 'mongoose';

export interface IGuildCountArchive extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  count: number;
  timestamp: Date;
  createdAt?: Date;
  archivedAt: Date;
}

const guildCountArchiveSchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    shardId: { type: Number, required: true, default: 0, index: true },
    totalShards: { type: Number, required: true, default: 1 },
    count: { type: Number, required: true },
    timestamp: { type: Date, required: true, index: true },
    createdAt: { type: Date },
    archivedAt: { type: Date, required: true, index: true },
  },
  { timestamps: false }
);

guildCountArchiveSchema.index({ botId: 1, timestamp: -1 });
guildCountArchiveSchema.index({ botId: 1, shardId: 1, timestamp: -1 });

export const GuildCountArchive =
  mongoose.models.GuildCountArchive ||
  mongoose.model<IGuildCountArchive>('GuildCountArchive', guildCountArchiveSchema);

