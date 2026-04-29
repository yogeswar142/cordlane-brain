import mongoose, { Schema, Document } from 'mongoose';

export interface IUserEventArchive extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  userId: string;
  guildId?: string;
  action: string;
  timestamp: Date;
  createdAt?: Date;
  archivedAt: Date;
}

const userEventArchiveSchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    shardId: { type: Number, required: true, default: 0, index: true },
    totalShards: { type: Number, required: true, default: 1 },
    userId: { type: String, required: true, index: true },
    guildId: { type: String },
    action: { type: String, default: 'interaction' },
    timestamp: { type: Date, required: true, index: true },
    createdAt: { type: Date },
    archivedAt: { type: Date, required: true, index: true },
  },
  { timestamps: false }
);

userEventArchiveSchema.index({ botId: 1, timestamp: -1 });
userEventArchiveSchema.index({ botId: 1, userId: 1, timestamp: -1 });

export const UserEventArchive =
  mongoose.models.UserEventArchive ||
  mongoose.model<IUserEventArchive>('UserEventArchive', userEventArchiveSchema);

