import mongoose, { Schema, Document } from 'mongoose';

export interface ICommandEventArchive extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  command: string;
  userId?: string;
  guildId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  createdAt?: Date;
  archivedAt: Date;
}

const commandEventArchiveSchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    shardId: { type: Number, required: true, default: 0, index: true },
    totalShards: { type: Number, required: true, default: 1 },
    command: { type: String, required: true },
    userId: { type: String },
    guildId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, required: true, index: true },
    createdAt: { type: Date },
    archivedAt: { type: Date, required: true, index: true },
  },
  { timestamps: false }
);

commandEventArchiveSchema.index({ botId: 1, timestamp: -1 });

export const CommandEventArchive =
  mongoose.models.CommandEventArchive ||
  mongoose.model<ICommandEventArchive>('CommandEventArchive', commandEventArchiveSchema);

