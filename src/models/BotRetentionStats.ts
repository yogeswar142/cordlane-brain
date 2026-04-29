import mongoose, { Schema, Document } from 'mongoose';

export type RetentionCohortRow = {
  cohort: string;
  totalUsers: number;
  day1: number;
  day7: number;
  day30: number;
};

export interface IBotRetentionStats extends Document {
  botId: string;
  computedAt: Date;
  retentionData: RetentionCohortRow[];
}

const botRetentionStatsSchema = new Schema(
  {
    botId: { type: String, required: true, unique: true, index: true },
    computedAt: { type: Date, required: true, default: Date.now, index: true },
    // Storing as Mixed keeps schema changes flexible as retention outputs evolve.
    retentionData: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: false }
);

export const BotRetentionStats =
  mongoose.models.BotRetentionStats ||
  mongoose.model<IBotRetentionStats>('BotRetentionStats', botRetentionStatsSchema);

