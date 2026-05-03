import mongoose, { Schema, Document } from 'mongoose';

export interface IHeartbeat extends Document {
  botId: string;
  shardId: number;
  totalShards: number;
  hour: Date;        // The start of the hour (e.g., 2026-05-03T10:00:00Z)
  count: number;     // Number of heartbeats received in this hour
  lastUptime: number;
  lastTimestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const heartbeatSchema = new Schema(
  {
    botId: { type: String, required: true },
    shardId: { type: Number, required: true, default: 0 },
    totalShards: { type: Number, required: true, default: 1 },
    hour: { type: Date, required: true }, // Bucketing key
    count: { type: Number, default: 1 },
    lastUptime: { type: Number, required: true },
    lastTimestamp: { type: Date, required: true },
  },
  { timestamps: true }
);

// Compound index for efficient upserts during bucketing
heartbeatSchema.index({ botId: 1, shardId: 1, hour: 1 }, { unique: true });
heartbeatSchema.index({ botId: 1, hour: 1 });

// TTL: Auto-expire buckets after 7 days (increased from 48h since they are smaller/fewer)
heartbeatSchema.index({ hour: 1 }, { expireAfterSeconds: 604800 });

export const Heartbeat = mongoose.models.Heartbeat || mongoose.model<IHeartbeat>('Heartbeat', heartbeatSchema);
