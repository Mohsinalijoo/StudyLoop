import 'dotenv/config';

const bool = (value, fallback = false) => value == null ? fallback : value === 'true';
const integer = (name, fallback, min, max) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
if (!accessSecret || accessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
if (!refreshSecret || refreshSecret.length < 32) throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
if (accessSecret === refreshSecret) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');

const sameSite = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: integer('PORT', 4000, 1, 65535),
  trustProxy: integer('TRUST_PROXY', 0, 0, 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/studyloop',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  jwtAccessSecret: accessSecret,
  jwtRefreshSecret: refreshSecret,
  jwtIssuer: process.env.JWT_ISSUER || 'studyloop-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'studyloop-client',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  cookieSameSite: sameSite,
  roomCapacityMax: integer('ROOM_CAPACITY_MAX', 4, 2, 4),
  matchQueueTtlSeconds: integer('MATCH_QUEUE_TTL_SECONDS', 180, 30, 900),
  presenceLeaseMs: integer('PRESENCE_LEASE_MS', 60000, 15000, 300000),
  presenceHeartbeatMs: integer('PRESENCE_HEARTBEAT_MS', 20000, 5000, 60000)
});

if (env.cookieSameSite === 'none' && !env.cookieSecure) {
  throw new Error('COOKIE_SECURE must be true when COOKIE_SAME_SITE=none');
}
