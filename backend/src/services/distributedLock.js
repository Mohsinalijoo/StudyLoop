import { randomUUID } from 'node:crypto';
import { redis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withDistributedLock(key, operation, { ttlMs = 30000, attempts = 40 } = {}) {
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await redis.set(key, token, { NX: true, PX: ttlMs });
    if (result === 'OK') { acquired = true; break; }
    await sleep(Math.min(25 + attempt * 10, 150));
  }
  if (!acquired) throw new AppError(409, 'RESOURCE_BUSY', 'This room is being updated. Please retry shortly.');

  try {
    return await operation();
  } finally {
    await redis.eval(RELEASE_LOCK, { keys: [key], arguments: [token] }).catch((error) => {
      console.error('[redis] failed to release distributed lock', error);
    });
  }
}
