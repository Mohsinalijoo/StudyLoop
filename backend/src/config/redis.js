import { createClient } from 'redis';
import { env } from './env.js';

export const redis = createClient({
  url: env.redisUrl,
  socket: {
    reconnectStrategy(retries) {
      return Math.min(retries * 100, 3000);
    }
  }
});

redis.on('error', (error) => console.error('[redis] client error', error));
redis.on('reconnecting', () => console.warn('[redis] reconnecting'));
redis.on('ready', () => console.info('[redis] connected'));

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect();
}

export async function disconnectRedis() {
  if (redis.isOpen) await redis.quit();
}
