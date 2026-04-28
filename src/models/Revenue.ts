import mongoose, { Schema, Document } from 'mongoose';

export interface IRevenue extends Document {
  botId: string;
  platform: 'stripe' | 'patreon' | 'manual';
  amount: number;         // in cents
  currency: string;       // e.g. 'usd'
  description?: string;
  date: Date;
  createdAt: Date;
}

const revenueSchema = new Schema(
  {
    botId: { type: String, required: true, index: true },
    platform: { type: String, enum: ['stripe', 'patreon', 'manual'], default: 'manual' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'usd' },
    description: { type: String },
    date: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

revenueSchema.index({ botId: 1, date: -1 });

export const Revenue = mongoose.models.Revenue || mongoose.model<IRevenue>('Revenue', revenueSchema);
