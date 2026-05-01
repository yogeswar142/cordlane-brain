import mongoose, { Schema, Document } from 'mongoose';

export interface IDailySummary extends Document {
  botId: string;
  date: string; // YYYY-MM-DD
  commands: number;
  dau: number;
  locales: Record<string, number>;
  topCommands: Array<{ command: string; count: number }>;
  topServers: Array<{ guildId: string; name: string; count: number }>;
  uptime: number; // percentage (0-100)
  createdAt: Date;
}

const dailySummarySchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    commands: { type: Number, default: 0 },
    dau: { type: Number, default: 0 },
    locales: { type: Schema.Types.Mixed, default: {} },
    topCommands: [{ command: String, count: Number }],
    topServers: [{ guildId: String, name: String, count: Number }],
    uptime: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Unique index to prevent duplicate summaries for the same bot on the same day
dailySummarySchema.index({ botId: 1, date: 1 }, { unique: true });

export const DailySummary = mongoose.models.DailySummary || mongoose.model<IDailySummary>('DailySummary', dailySummarySchema);
