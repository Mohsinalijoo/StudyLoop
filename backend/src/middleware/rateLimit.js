import { redis } from '../config/redis.js';

const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export function rateLimit({ name, limit, windowSeconds, key = (req) => req.ip || 'unknown' }) {
  return async (req, res, next) => {
    try {
      const bucket = `${name}:${key(req)}`;
      const count = Number(await redis.eval(INCREMENT_WINDOW, {
        keys: [`rate:${bucket}`],
        arguments: [String(windowSeconds)]
      }));
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
      res.setHeader('RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + windowSeconds));
      if (count > limit) {
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function checkSocketRateLimit(userId, action, limit, windowSeconds) {
  const key = `rate:socket:${action}:${userId}`;
  const count = Number(await redis.eval(INCREMENT_WINDOW, {
    keys: [key],
    arguments: [String(windowSeconds)]
  }));
  return count <= limit;
}
