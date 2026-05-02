import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { redis, isRedisReady } from '../lib/redis';
import { Bot, AuditLog, News, SystemConfig, CommandEvent } from '../models';
import { runDailyAggregation } from '../scripts/aggregateDaily';

/**
 * Publishes a new announcement/news item.
 */
export const postNews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, content, category, importance, targetClearance } = req.body;

    if (!title || !content) {
      res.status(400).json({ success: false, error: 'Title and content are required' });
      return;
    }

    const news = await News.create({
      title,
      content,
      category: category || 'announcement',
      importance: importance || 'medium',
      targetClearance: targetClearance || 0,
      authorId: 'admin',
      published: true,
    });

    await AuditLog.create({
      actorId: 'admin',
      actorType: 'api',
      action: 'bot_created',
      targetType: 'bot',
      targetId: news._id.toString(),
      metadata: { action: 'news_published', title },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: news });
  } catch (error) {
    console.error('Error publishing news:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Generates a short-lived impersonation token for a bot owner.
 * Stores the token in Redis for 60 seconds.
 */
export const impersonateBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId } = req.body;

    if (!botId) {
      res.status(400).json({ success: false, error: 'botId is required' });
      return;
    }

    const bot = await Bot.findOne({ botId }).lean();
    if (!bot) {
      res.status(404).json({ success: false, error: 'Bot not found' });
      return;
    }

    if (!isRedisReady()) {
      res.status(503).json({ success: false, error: 'Redis unavailable, cannot generate token' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    await redis!.setex(`impersonation:${token}`, 60, bot.ownerId);

    await AuditLog.create({
      actorId: 'admin',
      actorType: 'api',
      action: 'ownership_transferred',
      targetType: 'bot',
      targetId: botId,
      metadata: { impersonation: true, ownerId: bot.ownerId },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        ownerId: bot.ownerId,
        redirectUrl: `https://platform.cordialane.com/api/auth/impersonate?token=${token}`
      }
    });
  } catch (error) {
    console.error('Error during impersonation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Global ecosystem insights and anomaly detection.
 */
export const getGlobalInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    let topCommandsRaw: string[] = [];
    let anomalyBotsRaw: string[] = [];

    if (isRedisReady()) {
      topCommandsRaw = await redis!.zrevrange(`trends:commands:${today}`, 0, 9, 'WITHSCORES');
      anomalyBotsRaw = await redis!.zrevrangebyscore(`trends:bots:${today}`, '+inf', 5000, 'WITHSCORES', 'LIMIT', 0, 10);
    }

    const topCommands = [];
    for (let i = 0; i < topCommandsRaw.length; i += 2) {
      topCommands.push({ command: topCommandsRaw[i], count: parseInt(topCommandsRaw[i + 1], 10) });
    }

    const anomalies = [];
    for (let i = 0; i < anomalyBotsRaw.length; i += 2) {
      anomalies.push({ botId: anomalyBotsRaw[i], count: parseInt(anomalyBotsRaw[i + 1], 10), type: 'high_volume' });
    }

    res.status(200).json({
      success: true,
      data: {
        topCommands,
        anomalies,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching global insights:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Fetches real-time infrastructure pulse metrics.
 */
export const getPulse = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const keys = Array.from({ length: 60 }, (_, i) => `eps:${now - i}`);
    
    let epsHistory: number[] = [];
    if (isRedisReady()) {
      const values = await redis!.mget(...keys);
      epsHistory = values.map(v => parseInt(v || '0', 10));
    }

    const currentEps = epsHistory[0] || 0;

    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    let dbLatency = 0;
    if (dbStatus === 'connected') {
      const start = Date.now();
      await mongoose.connection.db?.admin().ping();
      dbLatency = Date.now() - start;
    }

    let rateLimitHeatmap: Record<string, number> = {};
    if (isRedisReady()) {
      const today = new Date().toISOString().split('T')[0];
      const heatmapKey = `ratelimit:heatmap:${today}`;
      const heatmapValues = await redis!.zrevrange(heatmapKey, 0, 19, 'WITHSCORES');
      for (let i = 0; i < heatmapValues.length; i += 2) {
        rateLimitHeatmap[heatmapValues[i]] = parseInt(heatmapValues[i + 1], 10);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        eps: {
          current: currentEps,
          history: epsHistory.reverse(),
        },
        database: {
          status: dbStatus,
          latencyMs: dbLatency,
          poolSize: mongoose.connection.getClient().options.maxPoolSize || 0,
        },
        rateLimits: {
          heatmap: rateLimitHeatmap,
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching pulse metrics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Manually triggers the daily aggregation and cleanup script.
 */
export const triggerManualAggregation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : undefined;

    // Run in background so we don't timeout the request
    runDailyAggregation(targetDate).catch(err => console.error('[Manual Aggregation] Failed:', err));

    res.status(202).json({ 
      success: true, 
      message: 'Manual aggregation triggered in background.' 
    });
  } catch (error) {
    console.error('Error triggering manual aggregation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

