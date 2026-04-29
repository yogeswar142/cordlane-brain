import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  actorId: string;
  actorType: 'user' | 'system' | 'api';
  action: 'bot_deleted' | 'bot_created' | 'api_key_regenerated' | 'visibility_changed' | 'ownership_transferred';
  targetType: 'bot' | 'user' | 'api_key';
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema(
  {
    actorId: { type: String, required: true },
    actorType: { type: String, enum: ['user', 'system', 'api'], required: true },
    action: {
      type: String,
      enum: ['bot_deleted', 'bot_created', 'api_key_regenerated', 'visibility_changed', 'ownership_transferred'],
      required: true,
    },
    targetType: { type: String, enum: ['bot', 'user', 'api_key'], required: true },
    targetId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Compound indexes for efficient audit queries
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, action: 1, createdAt: -1 });

// TTL: Retain audit logs for 1 year
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
