import mongoose, { Schema, Document } from 'mongoose';

export interface ILegacyStats extends Document {
  botId: string;
  totalCommands: number;
  totalUniqueUsers: number;
  migratedAt: Date;
}

const legacyStatsSchema = new Schema(
  {
    botId: { type: String, required: true, unique: true, index: true },
    totalCommands: { type: Number, default: 0 },
    totalUniqueUsers: { type: Number, default: 0 },
    migratedAt: { type: Date, default: Date.now },
  }
);

export const LegacyStats = mongoose.models.LegacyStats || mongoose.model<ILegacyStats>('LegacyStats', legacyStatsSchema);
