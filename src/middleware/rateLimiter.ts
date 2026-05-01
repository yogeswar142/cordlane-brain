import { Request, Response, NextFunction } from 'express';
import { redis, isRedisReady } from '../lib/redis';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes (for memory fallback)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetAt) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limiter per API key, backed by Redis for cluster safety.
 * Falls back to in-memory if Redis is unavailable.
 * Default: 120 requests per minute per bot.
 */
export function rateLimiter(maxRequests = 120, windowMs = 60_000) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Use the bot's API key as the rate limit key
    const apiKey = req.headers.authorization?.split(' ')[1] || req.ip || 'unknown';
    const now = Date.now();
    const windowSeconds = Math.ceil(windowMs / 1000);

    let count = 0;
    let resetSeconds = windowSeconds;

    if (isRedisReady()) {
      // ─── REDIS CLUSTER-SAFE IMPLEMENTATION ───
      const redisKey = `ratelimit:${apiKey}`;
      try {
        count = await redis!.incr(redisKey);
        if (count === 1) {
          await redis!.expire(redisKey, windowSeconds);
        } else {
          const ttl = await redis!.ttl(redisKey);
          resetSeconds = ttl > 0 ? ttl : windowSeconds;
        }
      } catch (err) {
        // Fall through to memory logic below if Redis fails
        count = 0; 
      }
    }

    if (count === 0) {
      // ─── IN-MEMORY FALLBACK ───
      let entry = memoryStore.get(apiKey);

      if (!entry || now > entry.resetAt) {
        // New window
        entry = { count: 1, resetAt: now + windowMs };
        memoryStore.set(apiKey, entry);
      } else {
        entry.count++;
      }
      
      count = entry.count;
      resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    }

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - count);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (count > maxRequests) {
      // ─── LOG 429 EVENT FOR ADMIN HEATMAP ───
      if (isRedisReady()) {
        const heatmapKey = `ratelimit:429:${apiKey}`;
        // We use a simple counter for the 429s, expiring in 5 mins
        redis!.incr(heatmapKey).then(() => {
          redis!.expire(heatmapKey, 300);
        }).catch(() => {});
      }

      res.status(429).json({
        success: false,
        error: 'Too many requests. Please increase your SDK batch_size or flush_interval to reduce API hits.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: resetSeconds,
      });
      return;
    }

    next();
  };
}

