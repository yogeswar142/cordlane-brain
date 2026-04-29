import { Request, Response } from 'express';
import { Bot, CommandEvent, UserEvent, GuildCount, Heartbeat, Revenue } from '../models';
import type { TrackCommandInput, TrackUserInput, GuildCountInput, HeartbeatInput, TrackBatchInput } from '../validators/schemas';
import { redis } from '../lib/redis';
import { getRetentionData } from '../services/retentionStats';

const VERIFICATION_THRESHOLD = 5;
const DEFAULT_SHARD_ID = 0;
const DEFAULT_TOTAL_SHARDS = 1;

type ShardMetaInput = {
  shardId?: number;
  totalShards?: number;
};

type NormalizedShardMeta = {
  shardId: number;
  totalShards: number;
};

const normalizeShardMeta = (input: ShardMetaInput): NormalizedShardMeta => ({
  shardId: Number.isInteger(input.shardId) ? (input.shardId as number) : DEFAULT_SHARD_ID,
  totalShards: Number.isInteger(input.totalShards) && (input.totalShards as number) > 0
    ? (input.totalShards as number)
    : DEFAULT_TOTAL_SHARDS,
});

const getAuthenticatedBotId = (req: Request): string | null => {
  const authBotId = (req as any).bot?.botId as string | undefined;
  return authBotId ?? null;
};

const resolveBotId = (req: Request, bodyBotId: string): { botId: string; mismatch: boolean } => {
  const authBotId = getAuthenticatedBotId(req);
  if (!authBotId) {
    return { botId: bodyBotId, mismatch: false };
  }

  if (bodyBotId && bodyBotId !== authBotId) {
    return { botId: authBotId, mismatch: true };
  }

  return { botId: authBotId, mismatch: false };
};

const upsertBotShardSnapshot = async (
  botId: string,
  shardId: number,
  totalShards: number,
  patch: Partial<{ status: 'online' | 'lagging' | 'offline'; lastHeartbeat: Date; latencyMs: number; guildCount: number }>
) => {
  if (Object.keys(patch).length === 0) return;

  const setOps: Record<string, unknown> = {
    'shards.$[shard].totalShards': totalShards,
  };
  Object.entries(patch).forEach(([field, value]) => {
    setOps[`shards.$[shard].${field}`] = value;
  });

  // Auto-reset alertedOffline when shard comes back online
  if (patch.status === 'online') {
    setOps['shards.$[shard].alertedOffline'] = false;
  }

  try {
    const updated = await Bot.updateOne(
      { botId, shards: { $exists: true } },
      { $set: setOps },
      { arrayFilters: [{ 'shard.id': shardId }] }
    );

    if (updated.matchedCount > 0 && updated.modifiedCount > 0) return;
  } catch (err: any) {
    // If the path still doesn't exist or other mongo error, fall through to push logic
    console.error(`[Upsert Error] Falling back for bot ${botId}:`, err.message);
  }

  await Bot.updateOne(
    { botId, 'shards.id': { $ne: shardId } },
    {
      $push: {
        shards: {
          id: shardId,
          totalShards,
          status: patch.status ?? 'online',
          lastHeartbeat: patch.lastHeartbeat,
          latencyMs: patch.latencyMs,
          guildCount: patch.guildCount,
          alertedOffline: false,
        }
      }
    }
  );
};

/**
 * Increments API call count and auto-verifies the bot once it reaches
 * the verification threshold (5 API calls). This proves the developer
 * actually owns and operates the bot.
 */
const incrementApiCallsAndVerify = async (botId: string, amount: number = 1) => {
  try {
    // Atomic increment of apiCallCount
    const bot = await Bot.findOneAndUpdate(
      { botId },
      { $inc: { apiCallCount: amount } },
      { returnDocument: 'after' }
    );

    if (!bot) return;

    // Debug-level logging — only in development to avoid I/O overhead at 1M+ events/day
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[API Call] Bot: ${bot.name} (${botId}) | Increment: ${amount}`);
    }

    // Auto-verify once threshold is reached (only if not already verified)
    if (!bot.verified && bot.apiCallCount >= VERIFICATION_THRESHOLD) {
      await Bot.updateOne(
        { botId, verified: false },
        { $set: { verified: true, verifiedAt: new Date() } }
      );
      console.log(`✅ Bot ${botId} (${bot.name}) auto-verified after ${bot.apiCallCount} API calls`);
    }
  } catch (err) {
    console.error("Error incrementing API calls / verifying bot:", err);
  }
};

export const trackCommand = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId: bodyBotId, command, userId, guildId, metadata, timestamp, shardId, totalShards } = req.body as TrackCommandInput;
    const { botId, mismatch } = resolveBotId(req, bodyBotId);
    if (mismatch) {
      res.status(400).json({ success: false, error: 'botId in body must match authenticated bot id' });
      return;
    }
    const normalizedShard = normalizeShardMeta({ shardId, totalShards });

    await CommandEvent.create({
      botId,
      shardId: normalizedShard.shardId,
      totalShards: normalizedShard.totalShards,
      command,
      userId,
      guildId,
      metadata,
      timestamp: new Date(timestamp)
    });

    await incrementApiCallsAndVerify(botId);

    res.status(200).json({ success: true, message: 'Command event tracked' });
  } catch (error) {
    console.error('Error tracking command:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const trackUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId: bodyBotId, userId, guildId, action, timestamp, shardId, totalShards } = req.body as TrackUserInput;
    const { botId, mismatch } = resolveBotId(req, bodyBotId);
    if (mismatch) {
      res.status(400).json({ success: false, error: 'botId in body must match authenticated bot id' });
      return;
    }
    const normalizedShard = normalizeShardMeta({ shardId, totalShards });

    await UserEvent.create({
      botId,
      shardId: normalizedShard.shardId,
      totalShards: normalizedShard.totalShards,
      userId,
      guildId,
      action,
      timestamp: new Date(timestamp)
    });

    await incrementApiCallsAndVerify(botId);

    res.status(200).json({ success: true, message: 'User event tracked' });
  } catch (error) {
    console.error('Error tracking user:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const postGuildCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId: bodyBotId, count, timestamp, shardId, totalShards } = req.body as GuildCountInput;
    const { botId, mismatch } = resolveBotId(req, bodyBotId);
    if (mismatch) {
      res.status(400).json({ success: false, error: 'botId in body must match authenticated bot id' });
      return;
    }
    const normalizedShard = normalizeShardMeta({ shardId, totalShards });
    const ts = new Date(timestamp);

    await GuildCount.create({
      botId,
      shardId: normalizedShard.shardId,
      totalShards: normalizedShard.totalShards,
      count,
      timestamp: ts
    });
    await upsertBotShardSnapshot(botId, normalizedShard.shardId, normalizedShard.totalShards, { guildCount: count });

    await incrementApiCallsAndVerify(botId);

    res.status(200).json({ success: true, message: 'Guild count updated' });
  } catch (error) {
    console.error('Error updating guild count:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const heartbeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId: bodyBotId, uptime, timestamp, shardId, totalShards } = req.body as HeartbeatInput;
    const { botId, mismatch } = resolveBotId(req, bodyBotId);
    if (mismatch) {
      res.status(400).json({ success: false, error: 'botId in body must match authenticated bot id' });
      return;
    }
    const normalizedShard = normalizeShardMeta({ shardId, totalShards });
    const ts = new Date(timestamp);
    const latencyMs = Math.max(0, Date.now() - ts.getTime());
    const status = latencyMs > 120000 ? 'offline' : latencyMs > 30000 ? 'lagging' : 'online';

    await Heartbeat.create({
      botId,
      shardId: normalizedShard.shardId,
      totalShards: normalizedShard.totalShards,
      uptime,
      timestamp: ts
    });
    await upsertBotShardSnapshot(botId, normalizedShard.shardId, normalizedShard.totalShards, {
      lastHeartbeat: ts,
      latencyMs,
      status,
    });

    await incrementApiCallsAndVerify(botId);

    res.status(200).json({ success: true, message: 'Heartbeat received' });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const trackBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId: bodyBotId, events, shardId: rootShardId, totalShards: rootTotalShards } = req.body as TrackBatchInput & ShardMetaInput;
    const { botId, mismatch } = resolveBotId(req, bodyBotId);
    if (mismatch) {
      res.status(400).json({ success: false, error: 'botId in body must match authenticated bot id' });
      return;
    }
    
    if (!events || events.length === 0) {
      res.status(200).json({ success: true, message: 'Empty batch' });
      return;
    }

    const commands: any[] = [];
    const users: any[] = [];
    const guildCounts: any[] = [];
    const heartbeats: any[] = [];

    // Simple anti-spam: track unique users in this batch to prevent duplicates
    const uniqueUsersInBatch = new Set<string>();

    for (const event of events) {
      const normalizedShard = normalizeShardMeta({
        shardId: event.shardId ?? rootShardId,
        totalShards: event.totalShards ?? rootTotalShards,
      });
      const eventTimestamp = event.timestamp ? new Date(event.timestamp) : new Date();
      // Add botId and parse timestamp
      const data = {
        ...event,
        botId,
        shardId: normalizedShard.shardId,
        totalShards: normalizedShard.totalShards,
        timestamp: eventTimestamp,
      };
      
      // Classify events by checking both `type` (JS SDK convention) and `event` (Python SDK convention)
      const eventType = event.type || event.event;

      if (eventType === 'command' || eventType === 'command_used' || (!eventType && event.command)) {
        commands.push(data);
      } else if (eventType === 'user' || eventType === 'user_active' || (event.userId && event.action)) {
        // Only add if we haven't seen this user in this specific batch yet
        const userId = (data as any).userId as unknown;
        if (typeof userId === 'string' && userId.length > 0) {
          if (!uniqueUsersInBatch.has(userId)) {
            users.push(data);
            uniqueUsersInBatch.add(userId);
          }
        }
      } else if (eventType === 'guildCount' || eventType === 'guild_count' || event.count !== undefined) {
        guildCounts.push(data);
        await upsertBotShardSnapshot(botId, normalizedShard.shardId, normalizedShard.totalShards, {
          guildCount: Number(event.count) || 0,
        });
      } else if (eventType === 'heartbeat' || event.uptime !== undefined) {
        heartbeats.push(data);
        const latencyMs = Math.max(0, Date.now() - eventTimestamp.getTime());
        const status = latencyMs > 120000 ? 'offline' : latencyMs > 30000 ? 'lagging' : 'online';
        await upsertBotShardSnapshot(botId, normalizedShard.shardId, normalizedShard.totalShards, {
          lastHeartbeat: eventTimestamp,
          latencyMs,
          status,
        });
      }
    }

    const promises = [];
    // ordered: false — continue inserting remaining docs if one fails (fault-tolerant batch processing)
    if (commands.length > 0) promises.push(CommandEvent.insertMany(commands, { ordered: false }));
    if (users.length > 0) promises.push(UserEvent.insertMany(users, { ordered: false }));
    if (guildCounts.length > 0) promises.push(GuildCount.insertMany(guildCounts, { ordered: false }));
    if (heartbeats.length > 0) promises.push(Heartbeat.insertMany(heartbeats, { ordered: false }));

    // Use allSettled to handle partial batch failures gracefully
    const results = await Promise.allSettled(promises);
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[Batch] ${failures.length}/${results.length} insert groups had partial failures`);
    }
    await incrementApiCallsAndVerify(botId, events.length);

    res.status(200).json({ success: true, message: `Batch processed ${events.length} events` });
  } catch (error) {
    console.error('Error tracking batch:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

type ShardSnapshot = {
  id: number;
  totalShards: number;
  status: 'online' | 'lagging' | 'offline';
  lastHeartbeat?: Date;
  latencyMs?: number;
  guildCount?: number;
  alertedOffline?: boolean;
};

export const getBotSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const requestedBotIdParam = req.params.id;
    const requestedBotId = Array.isArray(requestedBotIdParam) ? requestedBotIdParam[0] : requestedBotIdParam;
    const authBotId = (req as any).bot?.botId as string | undefined;

    if (!requestedBotId) {
      res.status(400).json({ success: false, error: 'bot id is required' });
      return;
    }

    // Keep summary reads scoped to the authenticated bot.
    if (authBotId && requestedBotId !== authBotId) {
      res.status(403).json({ success: false, error: 'forbidden for requested bot id' });
      return;
    }

    const cacheKey = `bot:summary:${requestedBotId}`;
    if (redis) {
      try {
        const cachedSummary = await redis.get(cacheKey);
        if (cachedSummary) {
          res.status(200).json(JSON.parse(cachedSummary));
          return;
        }
      } catch (err) {
        console.warn('[Redis] Cache read failed for summary:', err);
      }
    }

    const bot = await Bot.findOne({ botId: requestedBotId }).lean() as { botId: string; shards?: ShardSnapshot[] } | null;
    if (!bot) {
      res.status(404).json({ success: false, error: 'bot not found' });
      return;
    }

    let shards = Array.isArray(bot.shards) ? bot.shards : [];

    // Legacy fallback for bots that never wrote shard snapshots.
    if (shards.length === 0) {
      const [latestHeartbeat, latestGuildCount] = await Promise.all([
        Heartbeat.findOne({ botId: requestedBotId }).sort({ timestamp: -1 }).lean() as Promise<{ timestamp: Date } | null>,
        GuildCount.findOne({ botId: requestedBotId }).sort({ timestamp: -1 }).lean() as Promise<{ count: number } | null>,
      ]);

      const lastHeartbeat = latestHeartbeat?.timestamp;
      const latencyMs = lastHeartbeat ? Math.max(0, Date.now() - new Date(lastHeartbeat).getTime()) : undefined;
      const status: 'online' | 'lagging' | 'offline' = !latencyMs
        ? 'offline'
        : latencyMs > 120000
          ? 'offline'
          : latencyMs > 30000
            ? 'lagging'
            : 'online';

      shards = [{
        id: 0,
        totalShards: 1,
        status,
        lastHeartbeat,
        latencyMs,
        guildCount: latestGuildCount?.count ?? 0,
      }];
    }

    const totalGuildCount = shards.reduce((sum, shard) => sum + (shard.guildCount ?? 0), 0);
    const onlineShards = shards.filter((s) => s.status === 'online').length;
    const laggingShards = shards.filter((s) => s.status === 'lagging').length;
    const offlineShards = shards.filter((s) => s.status === 'offline').length;

    const healthStatus: 'operational' | 'partial_outage' | 'major_outage' =
      offlineShards === shards.length
        ? 'major_outage'
        : offlineShards > 0 || laggingShards > 0
          ? 'partial_outage'
          : 'operational';

    // ─── Aggregated Quick Stats (computed in parallel) ───
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      commandsWeekly,
      activeUserIds,
      heartbeatsToday,
      commandsByDateAgg,
      shardCommandVolumeAgg,
      heatmapRaw,
      revenueByDayAgg,
      totalRevenueCurrentAgg,
      totalRevenuePrevAgg,
    ] = await Promise.all([
      CommandEvent.countDocuments({ botId: requestedBotId, timestamp: { $gte: oneWeekAgo } }),
      UserEvent.distinct('userId', { botId: requestedBotId, timestamp: { $gte: oneDayAgo } }),
      Heartbeat.countDocuments({ botId: requestedBotId, timestamp: { $gte: oneDayAgo } }),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: oneWeekAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$shardId', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: {
              day: { $dayOfWeek: '$timestamp' },
              hour: { $hour: '$timestamp' },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            total: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    // Precomputed retention cohorts (fallback to compute).
    // This removes the heavy retention loop from the request hot path.
    const retentionData = await getRetentionData(requestedBotId, { freshnessMs: 2 * 60 * 60 * 1000 });

    const dau = activeUserIds.length;
    const configuredShardCount = Math.max(1, shards.length);
    const expectedHeartbeatsPerDay = 2880 * configuredShardCount;
    const uptimePercent = heartbeatsToday >= expectedHeartbeatsPerDay
      ? 100
      : parseFloat(((heartbeatsToday / expectedHeartbeatsPerDay) * 100).toFixed(2));

    const currentRev = totalRevenueCurrentAgg[0]?.total || 0;
    const prevRev = totalRevenuePrevAgg[0]?.total || 0;
    const revenueChange = prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : (currentRev > 0 ? 100 : 0);

    const responsePayload = {
      success: true,
      data: {
        botId: requestedBotId,
        totalGuildCount,
        healthStatus,
        shardCounts: {
          online: onlineShards,
          lagging: laggingShards,
          offline: offlineShards,
          total: shards.length,
        },
        shards,
        quickStats: {
          commandsWeekly,
          dau,
          uptimePercent,
          heartbeatsToday,
        },
        commandsByDate: commandsByDateAgg.map((c: any) => ({
          date: c._id,
          commands: c.count,
        })),
        advanced: {
          retentionData,
          heatmapData: heatmapRaw.map((h: any) => ({
            day: h._id.day - 1,
            hour: h._id.hour,
            count: h.count,
          })),
          shardGuildDistribution: shards.map((s) => ({ shard: s.id, guilds: s.guildCount || 0 })),
          shardCommandVolume: shardCommandVolumeAgg.map((s: any) => ({ shard: s._id, commands: s.count })),
          revenueData: {
            daily: revenueByDayAgg.map((r: any) => ({ date: r._id, amount: r.total / 100 })),
            total: currentRev / 100,
            change: revenueChange,
          },
        },
      },
    };

    if (redis) {
      try {
        // Cache summary for 30 seconds
        await redis.setex(cacheKey, 30, JSON.stringify(responsePayload));
      } catch (err) {
        console.warn('[Redis] Cache write failed for summary:', err);
      }
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error building bot summary:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
