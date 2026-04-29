import Redis from 'ioredis';

const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';

// Initialize Redis client. If REDIS_URI is falsy (e.g., explicitly disabled), this will be null.
export const redis = process.env.REDIS_URI !== 'false' ? new Redis(REDIS_URI, {
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) {
      console.warn('[Redis] Connection failed after 3 retries. Falling back to memory/DB.');
      return null; // Stop retrying
    }
    return Math.min(times * 50, 2000);
  }
}) : null;

if (redis) {
  redis.on('error', (err) => {
    console.error('[Redis Error]', err.message);
  });
  
  redis.on('connect', () => {
    console.log(`✅ Connected to Redis at ${REDIS_URI}`);
  });
}
