import { Request, Response } from 'express';
import { Bot, CommandEvent, GuildCount, Heartbeat, Revenue, DailySummary } from '../models';
import type { TrackCommandInput, GuildCountInput, HeartbeatInput, TrackBatchInput, CheckFollowInput } from '../validators/schemas';
import { redis, incrementEps, trackAdminTrends } from '../lib/redis';
import { getRetentionData } from '../services/retentionStats';
import { resolveCountryCode } from '../utils/locale';

const VERIFICATION_THRESHOLD = 5;
const DEFAULT_SHARD_ID = 0;
const DEFAULT_TOTAL_SHARDS = 1;

type ShardMetaInput = {
  shardId?: number | null;
  totalShards?: number | null;
};

type NormalizedShardMeta = {
  shardId: number;
  totalShards: number;
};

const normalizeShardMeta = (input: ShardMetaInput): NormalizedShardMeta => ({
  shardId: (input.shardId !== null && Number.isInteger(input.shardId)) ? (input.shardId as number) : DEFAULT_SHARD_ID,
  totalShards: (input.totalShards !== null && Number.isInteger(input.totalShards) && (input.totalShards as number) > 0)
    ? (input.totalShards as number)
    : DEFAULT_TOTAL_SHARDS,
});

const getAuthenticatedBotId = (req: Request): string | null => {
  const authBotId = (req as any).bot?.botId as string | undefined;
  return authBotId ?? null;
};

const resolveBotId = (req: Request, bodyBotId?: string | null): { botId: string; mismatch: boolean } => {
  const authBotId = getAuthenticatedBotId(req);
  
  // If there's no botId in the body, use the authenticated one (backward compatibility)
  if (!bodyBotId) {
    return { botId: authBotId || '', mismatch: false };
  }

  // If there's a botId in the body AND it's different from the auth header, that's a mismatch
  if (authBotId && bodyBotId !== authBotId) {
    return { botId: authBotId, mismatch: true };
  }

  return { botId: bodyBotId, mismatch: false };
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
    const { botId: bodyBotId, command, userId, guildId, guildName, locale, timestamp, shardId, totalShards, sdkVersion } = req.body as TrackCommandInput;
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
      guildName,
      locale,
      countryCode: resolveCountryCode(locale),
      sdkVersion: sdkVersion || (req.headers['x-cordia-sdk-version'] as string),
      timestamp: new Date(timestamp)
    });

    await incrementEps(1);
    await incrementApiCallsAndVerify(botId);
    await trackAdminTrends(botId, command, 1);

    res.status(200).json({ success: true, message: 'Command event tracked' });
  } catch (error) {
    console.error('Error tracking command:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Legacy handler for older SDKs. Returns success but does NOT persist data.
 * This prevents old SDKs from retrying indefinitely on 404/500 errors.
 */
export const legacyTrackUser = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, message: 'User event tracked (legacy)' });
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

    await incrementEps(1);
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

    // Start of the hour for bucketing
    const hour = new Date(ts);
    hour.setMinutes(0, 0, 0);

    await Heartbeat.findOneAndUpdate(
      { botId, shardId: normalizedShard.shardId, hour },
      { 
        $inc: { count: 1 },
        $set: { 
          lastUptime: uptime, 
          lastTimestamp: ts,
          totalShards: normalizedShard.totalShards 
        }
      },
      { upsert: true }
    );
    await upsertBotShardSnapshot(botId, normalizedShard.shardId, normalizedShard.totalShards, {
      lastHeartbeat: ts,
      latencyMs,
      status,
    });

    await incrementEps(1);
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

    // Debug logging for large batches
    if (events.length > 50 || process.env.NODE_ENV !== 'production') {
      console.log(`[Batch] Processing ${events.length} events for bot ${botId} (Content-Length: ${req.get('content-length')})`);
    }

    const commands: any[] = [];
    const guildCounts: any[] = [];
    const heartbeats: any[] = [];

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
        guildName: event.guildName,
        locale: event.locale,
        countryCode: resolveCountryCode(event.locale),
        sdkVersion: event.sdkVersion || (req.headers['x-cordia-sdk-version'] as string),
        timestamp: eventTimestamp,
      };
      
      // Classify events by checking both `type` (JS SDK convention) and `event` (Python SDK convention)
      const eventType = event.type || event.event;

      if (eventType === 'command' || eventType === 'command_used' || (!eventType && event.command)) {
        commands.push(data);
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

    // Process non-bulk updates (Bucketed heartbeats)
    const heartbeatPromises = heartbeats.map(hb => {
      const hour = new Date(hb.timestamp);
      hour.setMinutes(0, 0, 0);
      return Heartbeat.findOneAndUpdate(
        { botId: hb.botId, shardId: hb.shardId, hour },
        { 
          $inc: { count: 1 },
          $set: { 
            lastUptime: hb.uptime, 
            lastTimestamp: hb.timestamp,
            totalShards: hb.totalShards 
          }
        },
        { upsert: true }
      );
    });

    const promises = [];
    // ordered: false — continue inserting remaining docs if one fails (fault-tolerant batch processing)
    if (commands.length > 0) promises.push(CommandEvent.insertMany(commands, { ordered: false }));
    if (guildCounts.length > 0) promises.push(GuildCount.insertMany(guildCounts, { ordered: false }));

    // Use allSettled to handle partial batch failures gracefully
    const results = await Promise.allSettled([...promises, ...heartbeatPromises]);
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[Batch] ${failures.length}/${results.length} insert groups had partial failures`);
    }
    
    // Tally commands for admin trends
    const commandCounts: Record<string, number> = {};
    for (const cmd of commands) {
      if (cmd.command) {
        commandCounts[cmd.command] = (commandCounts[cmd.command] || 0) + 1;
      }
    }
    for (const [cmdName, count] of Object.entries(commandCounts)) {
      trackAdminTrends(botId, cmdName, count).catch(() => {});
    }

    await incrementEps(events.length);
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

    // Range support: default 30, fallback if invalid
    const rangeParam = parseInt(req.query.range as string) || 30;
    const rangeDays = [7, 30].includes(rangeParam) ? rangeParam : 30;

    if (!requestedBotId) {
      res.status(400).json({ success: false, error: 'bot id is required' });
      return;
    }

    // Keep summary reads scoped to the authenticated bot.
    if (authBotId && requestedBotId !== authBotId) {
      res.status(403).json({ success: false, error: 'forbidden for requested bot id' });
      return;
    }

    const cacheKey = `bot:summary:${requestedBotId}:${rangeDays}`;
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

    const bot = await Bot.findOne({ botId: requestedBotId }).lean() as { botId: string; shards?: ShardSnapshot[]; followers?: string[] } | null;
    if (!bot) {
      res.status(404).json({ success: false, error: 'bot not found' });
      return;
    }

    let shards = Array.isArray(bot.shards) ? bot.shards : [];
    const followerCount = Array.isArray(bot.followers) ? bot.followers.length : 0;

    // Legacy fallback for bots that never wrote shard snapshots.
    if (shards.length === 0) {
      const [latestHeartbeat, shardGuildCounts] = await Promise.all([
        Heartbeat.findOne({ botId: requestedBotId }).sort({ hour: -1, lastTimestamp: -1 }).lean() as Promise<{ lastTimestamp: Date } | null>,
        GuildCount.aggregate([
          { $match: { botId: requestedBotId } },
          { $sort: { timestamp: -1 } },
          { $group: { _id: '$shardId', latestCount: { $first: '$count' }, totalShards: { $first: '$totalShards' } } }
        ])
      ]);

      const lastHeartbeat = latestHeartbeat?.lastTimestamp;
      const latencyMs = lastHeartbeat ? Math.max(0, Date.now() - new Date(lastHeartbeat).getTime()) : undefined;
      const status: 'online' | 'lagging' | 'offline' = !latencyMs
        ? 'offline'
        : latencyMs > 120000
          ? 'offline'
          : latencyMs > 30000
            ? 'lagging'
            : 'online';

      if (shardGuildCounts.length > 0) {
        shards = shardGuildCounts.map(s => ({
          id: s._id ?? 0,
          totalShards: s.totalShards ?? 1,
          status,
          lastHeartbeat,
          latencyMs,
          guildCount: s.latestCount ?? 0,
        }));
      } else {
        shards = [{
          id: 0,
          totalShards: 1,
          status,
          lastHeartbeat,
          latencyMs,
          guildCount: 0,
        }];
      }
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

    // ─── Aggregated Stats Logic (Hybrid: Summary + Live) ───
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const rangeStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      historicalSummaries,
      liveCommandsToday,
      liveDauToday,
      liveHeatmapRaw,
      liveTopCommands,
      liveTopServers,
      liveLocales,
      liveCountries,
      revenueByDayAgg,
      totalRevenueCurrentAgg,
      totalRevenuePrevAgg,
    ] = await Promise.all([
      DailySummary.find({ botId: requestedBotId, date: { $gte: rangeStart.toISOString().split('T')[0] } }).sort({ date: 1 }).lean() as Promise<any[]>,
      CommandEvent.countDocuments({ botId: requestedBotId, timestamp: { $gte: startOfToday } }),
      CommandEvent.distinct('userId', { botId: requestedBotId, timestamp: { $gte: startOfToday } }),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: rangeStart } } },
        {
          $group: {
            _id: { day: { $dayOfWeek: '$timestamp' }, hour: { $hour: '$timestamp' } },
            count: { $sum: 1 },
          },
        },
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: startOfToday } } },
        { $group: { _id: '$command', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: startOfToday } } },
        { $group: { _id: '$guildId', name: { $first: '$guildName' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: startOfToday } } },
        { $group: { _id: '$locale', count: { $sum: 1 } } }
      ]),
      CommandEvent.aggregate([
        { $match: { botId: requestedBotId, timestamp: { $gte: startOfToday } } },
        { $group: { _id: '$countryCode', count: { $sum: 1 } } }
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: rangeStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: rangeStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Revenue.aggregate([
        { $match: { botId: requestedBotId, date: { $gte: sixtyDaysAgo, $lt: rangeStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    // Precomputed retention cohorts (fallback to compute).
    // This removes the heavy retention loop from the request hot path.
    const retentionData = await getRetentionData(requestedBotId, { freshnessMs: 2 * 60 * 60 * 1000 });

    // ─── MERGE LOGIC ───
    
    // Commands History
    const commandsByDate = historicalSummaries.map(s => ({ date: s.date, count: s.commands }));
    commandsByDate.push({ date: startOfToday.toISOString().split('T')[0], count: liveCommandsToday });

    // Totals
    const historicalTotalCommands = historicalSummaries.reduce((acc, s) => acc + s.commands, 0);
    
    // Top Commands Merge
    const commandMap: Record<string, number> = {};
    historicalSummaries.forEach(s => (s.topCommands || []).forEach((c: any) => commandMap[c.command] = (commandMap[c.command] || 0) + c.count));
    liveTopCommands.forEach(c => commandMap[c._id] = (commandMap[c._id] || 0) + c.count);
    const topCommands = Object.entries(commandMap).map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count).slice(0, 10);

    // Top Servers Merge
    const serverMap: Record<string, { name: string, count: number }> = {};
    historicalSummaries.forEach(s => (s.topServers || []).forEach((sv: any) => {
       if (!serverMap[sv.guildId]) serverMap[sv.guildId] = { name: sv.name, count: 0 };
       serverMap[sv.guildId].count += sv.count;
    }));
    liveTopServers.forEach(sv => {
       if (!serverMap[sv._id]) serverMap[sv._id] = { name: sv.name || 'Unknown Server', count: 0 };
       serverMap[sv._id].count += sv.count;
    });
    const topServers = Object.values(serverMap).sort((a, b) => b.count - a.count).slice(0, 10);

    // Locales Merge
    const localeMap: Record<string, number> = {};
    historicalSummaries.forEach(s => Object.entries(s.locales || {}).forEach(([loc, count]) => localeMap[loc] = (localeMap[loc] || 0) + (count as number)));
    liveLocales.forEach(l => localeMap[l._id || 'Unknown'] = (localeMap[l._id || 'Unknown'] || 0) + l.count);
    const localeDistribution = Object.entries(localeMap).map(([locale, count]) => ({ locale, count })).sort((a, b) => b.count - a.count);

    // Countries Merge
    const countryMap: Record<string, number> = {};
    // Fallback: if historical summaries don't have countries yet, we can try to derive from locales
    historicalSummaries.forEach(s => {
      const countries = s.countries || {};
      if (Object.keys(countries).length > 0) {
        Object.entries(countries).forEach(([cc, count]) => countryMap[cc] = (countryMap[cc] || 0) + (count as number));
      } else {
        // Migration: derive from locales if countries field missing in old summary
        Object.entries(s.locales || {}).forEach(([loc, count]) => {
          const cc = resolveCountryCode(loc);
          if (cc) countryMap[cc] = (countryMap[cc] || 0) + (count as number);
        });
      }
    });
    liveCountries.forEach(c => {
      if (c._id) countryMap[c._id] = (countryMap[c._id] || 0) + c.count;
    });
    const countryDistribution = Object.entries(countryMap).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);

    // Revenue Logic
    const currentRev = totalRevenueCurrentAgg[0]?.total || 0;
    const prevRev = totalRevenuePrevAgg[0]?.total || 0;
    const revenueChange = prevRev === 0 ? 0 : ((currentRev - prevRev) / prevRev) * 100;

    const responsePayload = {
      success: true,
      data: {
        botId: requestedBotId,
        totalGuildCount: shards.reduce((acc, s) => acc + (s.guildCount || 0), 0),
        healthStatus,
        shardCounts: {
          online: onlineShards,
          lagging: laggingShards,
          offline: offlineShards,
          total: shards.length
        },
        shards,
        quickStats: {
          commandsWeekly: historicalTotalCommands + liveCommandsToday,
          dau: liveDauToday.length,
          followerCount,
          uptimePercent: historicalSummaries.length > 0 ? historicalSummaries.reduce((acc, s) => acc + s.uptime, 0) / historicalSummaries.length : 100,
          heartbeatsToday: (await Heartbeat.aggregate([
            { $match: { botId: requestedBotId, hour: { $gte: startOfToday } } },
            { $group: { _id: null, total: { $sum: '$count' } } }
          ]))[0]?.total || 0,
        },
        commandsByDate,
        advanced: {
          retentionData,
          heatmapData: liveHeatmapRaw.map((h: any) => ({
            day: h._id.day - 1,
            hour: h._id.hour,
            count: h.count,
          })),
          shardGuildDistribution: shards.map((s) => ({ shard: s.id, guilds: s.guildCount || 0 })),
          shardCommandVolume: [],
          topCommands,
          topServers,
          localeDistribution,
          countryDistribution,
          revenueData: {
            daily: revenueByDayAgg.map((r: any) => ({ date: r._id, amount: r.total / 100 })),
            total: currentRev / 100,
            change: revenueChange,
          },
        },
      }
    };

    if (redis) {
       await redis.setex(cacheKey, 300, JSON.stringify(responsePayload));
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error building bot summary:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const searchBots = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;

    if (!query || typeof query !== 'string') {
      res.status(400).json({ success: false, error: 'search query "q" is required' });
      return;
    }

    // Sanitize query for regex and perform case-insensitive search on name
    const sanitizedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bots = await Bot.find({
      name: { $regex: sanitizedQuery, $options: 'i' },
      isPublic: true // Only allow searching public bots via API
    })
      .select('botId name description avatar verified createdAt')
      .limit(20)
      .lean();

    res.status(200).json({
      success: true,
      data: bots
    });
  } catch (error) {
    console.error('Error searching bots:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const checkFollow = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.body as CheckFollowInput;
    const authBot = (req as any).bot;

    if (!authBot) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Check if the user is in the followers array of this specific bot
    const isFollowing = await Bot.exists({ 
      botId: authBot.botId, 
      followers: userId 
    });

    res.status(200).json({
      success: true,
      isFollowing: !!isFollowing,
      botId: authBot.botId,
      userId
    });
  } catch (error) {
    console.error('Error checking follow status:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
