import Redis from 'ioredis';

const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';

// Initialize Redis client. If REDIS_URI is falsy (e.g., explicitly disabled), this will be null.
const client = process.env.REDIS_URI !== 'false' ? new Redis(REDIS_URI, {
  maxRetriesPerRequest: 1,
  lazyConnect: true, // Don't crash on start if Redis is down
  retryStrategy(times) {
    if (times > 3) {
      return null; // Stop retrying after 3 attempts
    }
    return Math.min(times * 100, 2000);
  }
}) : null;

if (client) {
  client.on('error', (err) => {
    // Only log severe errors, ignore "Connection is closed" noise if we expect it
    if (err.message !== 'Connection is closed.') {
      console.error('[Redis Error]', err.message);
    }
  });
  
  client.on('connect', () => {
    console.log(`✅ Connected to Redis at ${REDIS_URI}`);
  });
}

export const redis = client;

/**
 * Helper to check if Redis is actually connected and ready for commands.
 */
export const isRedisReady = (): boolean => {
  return !!redis && redis.status === 'ready';
};
