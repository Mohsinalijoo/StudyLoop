import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

const onlineKey = 'presence:online';
const primarySocketHash = 'presence:users';
const socketSetKey = (userId) => `presence:sockets:${userId}`;
const leaseTtlSeconds = Math.ceil((env.presenceLeaseMs * 2) / 1000);

const addSocketScript = `
local now = tonumber(ARGV[1])
local expiry = now + tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local before = redis.call('ZCARD', KEYS[2])
redis.call('ZADD', KEYS[2], expiry, ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('ZADD', KEYS[1], expiry, ARGV[5])
redis.call('HSET', KEYS[3], ARGV[5], ARGV[4])
return before
`;

const renewSocketScript = `
local now = tonumber(ARGV[1])
local expiry = now + tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local before = redis.call('ZCARD', KEYS[2])
redis.call('ZADD', KEYS[2], expiry, ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('ZADD', KEYS[1], expiry, ARGV[5])
redis.call('HSET', KEYS[3], ARGV[5], ARGV[4])
return before
`;

const removeSocketScript = `
local now = tonumber(ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local remaining = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
local count = redis.call('ZCARD', KEYS[2])
if count == 0 then
  redis.call('ZREM', KEYS[1], ARGV[5])
  redis.call('HDEL', KEYS[3], ARGV[5])
  redis.call('DEL', KEYS[2])
  return 0
end
redis.call('HSET', KEYS[3], ARGV[5], remaining[1])
redis.call('ZADD', KEYS[1], tonumber(remaining[2]), ARGV[5])
return count
`;

const expireUserScript = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if score and tonumber(score) <= tonumber(ARGV[2]) then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[2], ARGV[1])
  return 1
end
return 0
`;

export async function registerSocket(userId, socketId) {
  const before = Number(await redis.eval(addSocketScript, {
    keys: [onlineKey, socketSetKey(userId), primarySocketHash],
    arguments: [String(Date.now()), String(env.presenceLeaseMs), String(leaseTtlSeconds * 1000), socketId, userId]
  }));
  return { becameOnline: before === 0 };
}

export async function renewSocket(userId, socketId) {
  const before = Number(await redis.eval(renewSocketScript, {
    keys: [onlineKey, socketSetKey(userId), primarySocketHash],
    arguments: [String(Date.now()), String(env.presenceLeaseMs), String(leaseTtlSeconds * 1000), socketId, userId]
  }));
  return { becameOnline: before === 0 };
}

export async function removeSocket(userId, socketId) {
  const remaining = Number(await redis.eval(removeSocketScript, {
    keys: [onlineKey, socketSetKey(userId), primarySocketHash],
    arguments: [String(Date.now()), String(env.presenceLeaseMs), String(leaseTtlSeconds * 1000), socketId, userId]
  }));
  return { becameOffline: remaining === 0, remaining };
}

export async function isUserOnline(userId) {
  // Mongoose ObjectIds must be serialized before passing them to node-redis.
  const score = await redis.zScore(onlineKey, String(userId));
  if (score == null || Number(score) <= Date.now()) return false;
  return true;
}

export async function onlineStatuses(userIds) {
  const statuses = await Promise.all(userIds.map((userId) => isUserOnline(String(userId))));
  return new Map(userIds.map((userId, index) => [String(userId), statuses[index]]));
}

export async function onlineUserIds(limit = 10000) {
  return redis.zRangeByScore(onlineKey, String(Date.now()), '+inf', { LIMIT: { offset: 0, count: limit } });
}

export async function cleanupExpiredPresence(limit = 200) {
  const expiredIds = await redis.zRangeByScore(onlineKey, '-inf', String(Date.now()), {
    LIMIT: { offset: 0, count: limit }
  });
  const offlineIds = [];
  for (const userId of expiredIds) {
    const removed = Number(await redis.eval(expireUserScript, {
      keys: [onlineKey, primarySocketHash],
      arguments: [userId, String(Date.now())]
    }));
    if (removed === 1) offlineIds.push(userId);
  }
  return offlineIds;
}
