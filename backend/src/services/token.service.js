import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const consumeRefreshScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
return 1
`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function durationToSeconds(value) {
  const match = String(value).match(/^(\d+)(s|m|h|d)$/i);
  if (!match) throw new Error(`Unsupported JWT duration: ${value}`);
  const scale = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()];
  return Number(match[1]) * scale;
}

export async function issueTokenPair(user) {
  const userId = String(user._id ?? user.id);
  const jti = randomUUID();
  const refreshToken = jwt.sign({ typ: 'refresh' }, env.jwtRefreshSecret, {
    subject: userId,
    jwtid: jti,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: env.jwtRefreshTtl
  });
  const accessToken = jwt.sign({ typ: 'access' }, env.jwtAccessSecret, {
    subject: userId,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: env.jwtAccessTtl
  });
  const ttlSeconds = durationToSeconds(env.jwtRefreshTtl);
  const tokenKey = `auth:refresh:${jti}`;
  const userSessionsKey = `auth:refresh-user:${userId}`;
  await redis.set(tokenKey, sha256(refreshToken), { EX: ttlSeconds, NX: true });
  const multi = redis.multi();
  multi.sAdd(userSessionsKey, jti);
  multi.expire(userSessionsKey, ttlSeconds);
  await multi.exec();
  return { accessToken, refreshToken, refreshTtlSeconds: ttlSeconds };
}

export async function rotateRefreshToken(rawToken) {
  if (!rawToken) throw new AppError(401, 'REFRESH_REQUIRED', 'A refresh session is required');
  let payload;
  try {
    payload = jwt.verify(rawToken, env.jwtRefreshSecret, { issuer: env.jwtIssuer, audience: env.jwtAudience });
  } catch {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid or expired');
  }
  if (payload.typ !== 'refresh' || !payload.sub || !payload.jti) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid');
  }
  const consumed = Number(await redis.eval(consumeRefreshScript, {
    keys: [`auth:refresh:${payload.jti}`, `auth:refresh-user:${payload.sub}`],
    arguments: [sha256(rawToken), payload.jti]
  }));
  if (consumed !== 1) throw new AppError(401, 'REFRESH_REPLAY_OR_EXPIRED', 'Refresh session has expired or was already used');

  const user = await User.findOne({ _id: payload.sub, isDisabled: false });
  if (!user) throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable');
  return { user, ...(await issueTokenPair(user)) };
}

export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return false;
  let payload;
  try {
    payload = jwt.verify(rawToken, env.jwtRefreshSecret, { issuer: env.jwtIssuer, audience: env.jwtAudience });
  } catch {
    return false;
  }
  if (payload.typ !== 'refresh' || !payload.sub || !payload.jti) return false;
  const result = Number(await redis.eval(consumeRefreshScript, {
    keys: [`auth:refresh:${payload.jti}`, `auth:refresh-user:${payload.sub}`],
    arguments: [sha256(rawToken), payload.jti]
  }));
  return result === 1;
}

export async function revokeAllRefreshTokens(userId) {
  const setKey = `auth:refresh-user:${userId}`;
  const tokenIds = await redis.sMembers(setKey);
  if (tokenIds.length) {
    const multi = redis.multi();
    for (const id of tokenIds) multi.del(`auth:refresh:${id}`);
    multi.del(setKey);
    await multi.exec();
  }
}
