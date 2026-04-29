import { Request, Response, NextFunction } from 'express';
import { Bot } from '../models';
import { redis, isRedisReady } from '../lib/redis';

export const requireApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    // Try to get botId from header or from URL params (req.params.id)
    const botId = (req.headers['x-bot-id'] as string) || req.params.id;

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
