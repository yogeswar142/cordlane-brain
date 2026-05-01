import { Request, Response, NextFunction } from 'express';
import { Bot, SystemConfig } from '../models';
import { redis, isRedisReady } from '../lib/redis';

export const requireApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const botId = (req.headers['x-bot-id'] as string) || req.params.id;
    const sdkVersion = req.headers['x-cordia-sdk-version'] as string | undefined;

    // ─────────────────────────────────────────────────────────────
    // 0. SDK VERSION WARNING (Non-blocking)
    // ─────────────────────────────────────────────────────────────
    if (sdkVersion) {
      // Use Redis to cache the latest version for 1 hour to avoid DB pressure
      let latestVersion = '1.2.2';
      if (isRedisReady()) {
        const cachedLatest = await redis!.get('config:latest_sdk_version');
        if (cachedLatest) {
          latestVersion = cachedLatest;
        } else {
          const config = await SystemConfig.findOne({ key: 'latest_sdk_version' }).lean();
          if (config) {
            latestVersion = config.value;
            await redis!.setex('config:latest_sdk_version', 3600, latestVersion);
          }
        }
      }

      if (sdkVersion !== latestVersion) {
        res.setHeader('X-Cordia-SDK-Outdated', 'true');
        res.setHeader('X-Cordia-Latest-SDK', latestVersion);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 1. VERSION ENFORCEMENT (Mandatory v1.2.1+)
    // ─────────────────────────────────────────────────────────────
    // Allow summary requests from platform (browsers won't have this header)
    const isDashboardRequest = req.method === 'GET' && req.path.includes('/summary');
    
    if (!isDashboardRequest) {
      if (!sdkVersion) {
        res.status(403).json({
          success: false,
          error: 'Missing SDK Version header. Please update your Cordia SDK to v1.2.2 or higher.',
          code: 'SDK_VERSION_REQUIRED'
        });
        return;
      }

      const [major, minor, patch] = sdkVersion.split('.').map(Number);
      // Reject anything below 1.2.1
      if (major < 1 || (major === 1 && minor < 2) || (major === 1 && minor === 2 && patch < 1)) {
        res.status(403).json({
          success: false,
          error: `SDK v${sdkVersion} is no longer supported due to architectural upgrades. Please update to v1.2.2.`,
          code: 'SDK_VERSION_DEPRECATED'
        });
        return;
      }
    }

    if (!botId) {
      res.status(400).json({ 
        success: false, 
        error: 'Bot ID is required (via X-Bot-Id header or URL parameter)',
        code: 'BOT_ID_MISSING'
      });
      return;
    }

    let bot: any = null;
    const cacheKey = `auth:bot:${botId}`;

    // 1. Try Redis cache first
    if (isRedisReady()) {
      try {
        const cachedBot = await redis!.get(cacheKey);
        if (cachedBot) {
          bot = JSON.parse(cachedBot);
        }
      } catch (err) {
        // Silently fail if Redis is down, fallback to DB
      }
    }

    // 2. Fallback to MongoDB
    if (!bot) {
      bot = await Bot.findOne({ botId }).lean();
      
      if (bot && isRedisReady()) {
        // Cache for 5 minutes (300s)
        try {
          await redis!.setex(cacheKey, 300, JSON.stringify({
            botId: bot.botId,
            name: bot.name,
            apiKey: bot.apiKey,
            isPublic: bot.isPublic
          }));
        } catch (err) {
          // Silently fail cache write
        }
      }
    }

    if (!bot) {
      res.status(404).json({ 
        success: false, 
        error: 'Bot not found.',
        code: 'BOT_NOT_FOUND'
      });
      return;
    }

    // PUBLIC ACCESS EXCEPTION: 
    // Allow GET /summary for public bots even without an Authorization header
    const isSummaryRequest = req.method === 'GET' && req.path.includes('/summary');
    if (isSummaryRequest && bot.isPublic) {
      (req as any).bot = bot;
      return next();
    }

    // Otherwise, we REQUIRE a valid Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
       res.status(401).json({ 
         success: false, 
         error: 'Authorization header missing or invalid format (Bearer token required)',
         code: 'AUTH_MISSING'
       });
       return;
    }

    const apiKey = authHeader.split(' ')[1];
    if (apiKey !== bot.apiKey) {
      res.status(401).json({ 
        success: false, 
        error: 'Invalid API Key. Your key may have been regenerated. Check your Cordia dashboard for the latest key.',
        code: 'INVALID_API_KEY'
      });
      return;
    }

    // Attach bot to request for downstream usage
    (req as any).bot = bot;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Return a safe error that won't crash the SDK/bot
    res.status(500).json({ 
      success: false, 
      error: 'Cordia API temporarily unavailable. Your bot will continue to function normally.',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * Strictly protects internal admin routes.
 * Requires a Bearer token matching the ADMIN_MASTER_KEY environment variable.
 */
export const requireAdminAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const adminKey = process.env.ADMIN_MASTER_KEY || 'cordia_local_dev_key';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Admin authentication required' });
    return;
  }

  const providedKey = authHeader.split(' ')[1];
  if (providedKey !== adminKey) {
    res.status(403).json({ success: false, error: 'Invalid admin credentials' });
    return;
  }

  next();
};
