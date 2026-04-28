import mongoose, { Schema, Document } from 'mongoose';

export interface IBot extends Document {
  botId: string;
  apiKey: string;
  ownerId: string;
  collaborators?: {
    userId: string;
    role: 'admin' | 'analyst';
    addedAt: Date;
  }[];
  name: string;
  description?: string;
  avatar?: string;
  isPublic: boolean;
  webhookUrl?: string;
  verified: boolean;
  verifiedAt?: Date;
  apiCallCount: number;
  apiKeyLastGenerated: Date;
  shards: {
    id: number;
    totalShards: number;
    status: 'online' | 'lagging' | 'offline';
    lastHeartbeat?: Date;
    latencyMs?: number;
    guildCount?: number;
    alertedOffline?: boolean;
  }[];
  addedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

const botSchema = new Schema(
  {
    botId: { type: String, required: true, unique: true },
    apiKey: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true, index: true },
    collaborators: {
      type: [
        new Schema(
          {
            userId: { type: String, required: true },
            role: { type: String, enum: ['admin', 'analyst'], default: 'analyst' },
            addedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        )
      ],
      default: []
    },
    name: { type: String, required: true },
    description: { type: String },
    avatar: { type: String },
    isPublic: { type: Boolean, default: false },
    webhookUrl: { type: String },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    apiCallCount: { type: Number, default: 0 },
    apiKeyLastGenerated: { type: Date, default: Date.now },
    shards: {
      type: [
        new Schema(
          {
            id: { type: Number, required: true },
            totalShards: { type: Number, required: true, default: 1 },
            status: { type: String, enum: ['online', 'lagging', 'offline'], default: 'online' },
            lastHeartbeat: { type: Date },
            latencyMs: { type: Number },
            guildCount: { type: Number },
            alertedOffline: { type: Boolean, default: false },
          },
          { _id: false }
        )
      ],
      default: []
    },
    addedByUserId: { type: String, required: true },
  },
  { timestamps: true }
);

botSchema.index({ 'collaborators.userId': 1 });

export const Bot = mongoose.models.Bot || mongoose.model<IBot>('Bot', botSchema);
