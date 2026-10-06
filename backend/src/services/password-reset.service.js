import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';

const consumeResetTokenScript = `
local userId = redis.call('GET', KEYS[1])
if not userId then return false end
redis.call('DEL', KEYS[1])
local userKey = 'auth:password-reset-user:' .. userId
if redis.call('GET', userKey) == ARGV[1] then redis.call('DEL', userKey) end
return userId
`;

const revokeResetTokenScript = `
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

const revokeAllUserResetTokensScript = `
local digest = redis.call('GET', KEYS[1])
if digest then redis.call('DEL', 'auth:password-reset:' .. digest) end
redis.call('DEL', KEYS[1])
return 1
`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function createPasswordResetToken(userId) {
  const token = randomBytes(32).toString('base64url');
  const digest = sha256(token);
  const tokenKey = `auth:password-reset:${digest}`;
  const userKey = `auth:password-reset-user:${userId}`;
  const previousDigest = await redis.get(userKey);
  const transaction = redis.multi();
  if (previousDigest) transaction.del(`auth:password-reset:${previousDigest}`);
  transaction.set(tokenKey, String(userId), { EX: env.passwordResetTtlSeconds });
  transaction.set(userKey, digest, { EX: env.passwordResetTtlSeconds });
  await transaction.exec();
  return token;
}

export async function consumePasswordResetToken(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) return null;
  const digest = sha256(token);
  const userId = await redis.eval(consumeResetTokenScript, {
    keys: [`auth:password-reset:${digest}`],
    arguments: [digest]
  });
  return userId ? String(userId) : null;
}

export async function revokePasswordResetToken(userId, token) {
  const digest = sha256(token);
  await redis.eval(revokeResetTokenScript, {
    keys: [`auth:password-reset:${digest}`, `auth:password-reset-user:${userId}`],
    arguments: [digest]
  });
}

export async function revokeAllPasswordResetTokens(userId) {
  await redis.eval(revokeAllUserResetTokensScript, {
    keys: [`auth:password-reset-user:${userId}`],
    arguments: []
  });
}
