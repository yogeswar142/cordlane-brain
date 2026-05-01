import mongoose, { Schema, Document } from 'mongoose';

export interface INews extends Document {
  title: string;
  content: string; // Markdown supported
  authorId: string;
  category: 'update' | 'announcement' | 'maintenance' | 'feature';
  importance: 'low' | 'medium' | 'high' | 'critical';
  published: boolean;
  targetClearance?: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const newsSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    authorId: { type: String, required: true, index: true },
    category: { 
      type: String, 
      enum: ['update', 'announcement', 'maintenance', 'feature'], 
      default: 'announcement' 
    },
    importance: { 
      type: String, 
      enum: ['low', 'medium', 'high', 'critical'], 
      default: 'medium' 
    },
    published: { type: Boolean, default: false },
    targetClearance: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

newsSchema.index({ published: 1, createdAt: -1 });

export const News = mongoose.models.News || mongoose.model<INews>('News', newsSchema);
