import mongoose, { Schema, Document } from 'mongoose';

export interface IHeartbeat extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  uptime: number;
  timestamp: Date;
  createdAt: Date;
}

const heartbeatSchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    shardId: { type: Number, required: true, default: 0, index: true },
    totalShards: { type: Number, required: true, default: 1 },
    uptime: { type: Number, required: true },
    timestamp: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

heartbeatSchema.index({ botId: 1, timestamp: -1 });
heartbeatSchema.index({ botId: 1, shardId: 1, timestamp: -1 });

// TTL: Auto-expire heartbeats after 48 hours to prevent unbounded growth
heartbeatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

export const Heartbeat = mongoose.models.Heartbeat || mongoose.model<IHeartbeat>('Heartbeat', heartbeatSchema);
