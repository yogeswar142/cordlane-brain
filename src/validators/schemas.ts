import { z } from 'zod';

const shardMetaSchema = {
  shardId: z.number().int().nonnegative('shardId must be a non-negative integer').nullable().optional(),
  totalShards: z.number().int().positive('totalShards must be a positive integer').nullable().optional(),
};

// ─────────────────────────────────────────────────────────────
// Track Command
// ─────────────────────────────────────────────────────────────
export const trackCommandSchema = z.object({
  botId: z.string().min(1, 'botId is required'),
  command: z.string().min(1, 'command must be a non-empty string'),
  userId: z.string().nullable().optional(),
  guildId: z.string().nullable().optional(),
  guildName: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO 8601 date string' }),
  sdkVersion: z.string().nullable().optional(),
  ...shardMetaSchema,
  });

  // ─────────────────────────────────────────────────────────────
  // Heartbeat

// ─────────────────────────────────────────────────────────────
export const guildCountSchema = z.object({
  botId: z.string().min(1, 'botId is required'),
  count: z.number().nonnegative('count must be a non-negative number').finite(),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO 8601 date string' }),
  ...shardMetaSchema,
});

// ─────────────────────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────────────────────
export const heartbeatSchema = z.object({
  botId: z.string().min(1, 'botId is required'),
  uptime: z.number().nonnegative('uptime must be a non-negative number').finite(),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO 8601 date string' }),
  ...shardMetaSchema,
});

// Inferred types for controller usage
export type TrackCommandInput = z.infer<typeof trackCommandSchema>;
export type GuildCountInput = z.infer<typeof guildCountSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

// ─────────────────────────────────────────────────────────────
// Batch Event (individual item within a track-batch request)
// Flexible enough to accept both JS SDK (`type`) and Python SDK (`event`) conventions
// ─────────────────────────────────────────────────────────────
const batchEventSchema = z.object({
  // Event classification — at least one of type/event should be present, or inferred from fields
  type: z.string().nullable().optional(),
  event: z.string().nullable().optional(),

  // Command event fields
  command: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),

  // Context fields (Shared between Command and others)
  userId: z.string().nullable().optional(),
  guildId: z.string().nullable().optional(),
  guildName: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),

  // Guild count field
  count: z.number().nonnegative().finite().nullable().optional(),

  // Heartbeat field
  uptime: z.number().nonnegative().finite().nullable().optional(),

  // Shard metadata (per-event override)
  shardId: z.number().int().nonnegative().nullable().optional(),
  totalShards: z.number().int().positive().nullable().optional(),

  // SDK Version
  sdkVersion: z.string().nullable().optional(),

  // Timestamp (defaults to now if missing)
  timestamp: z.string().datetime().nullable().optional(),
}).refine(
  (data) => {
    // At least one identifying field must be present to classify the event
    const hasType = data.type || data.event;
    const hasCommandField = !!data.command;
    const hasCountField = data.count !== undefined;
    const hasUptimeField = data.uptime !== undefined;
    return hasType || hasCommandField || hasCountField || hasUptimeField;
  },
  { message: 'Each event must have a type/event field or identifiable data fields (command, count, uptime)' }
);

// ─────────────────────────────────────────────────────────────
// Track Batch
// ─────────────────────────────────────────────────────────────
export const trackBatchSchema = z.object({
  botId: z.string().min(1).optional(), // Optional on server to allow header fallback
  shardId: z.number().int().nonnegative().optional(),
  totalShards: z.number().int().positive().optional(),
  events: z.array(batchEventSchema).min(1, 'events array must not be empty').max(5000, 'batch size must not exceed 5000 events'),
});

export type TrackBatchInput = z.infer<typeof trackBatchSchema>;

// ─────────────────────────────────────────────────────────────
// Follow System
// ─────────────────────────────────────────────────────────────
export const checkFollowSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

export type CheckFollowInput = z.infer<typeof checkFollowSchema>;

