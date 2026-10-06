import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { normalizeSubject } from '../utils/validation.js';
import { isUserOnline } from './presence.service.js';
import { createMatchedRoom } from './room.service.js';
import { publishMatchFailed, publishMatchFound } from '../sockets/publishers.js';
import { roomDto, publicUser } from '../utils/serializers.js';

const ENTRY_PREFIX = 'match:entry:';
const MATCH_SCRIPT = `
local userId = ARGV[1]
local entryPrefix = ARGV[2]
local payload = cjson.decode(ARGV[3])
local now = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local scanLimit = tonumber(ARGV[6])
local ownQueue = KEYS[1]

local previousRaw = redis.call('GET', entryPrefix .. userId)
if previousRaw then
  local ok, previous = pcall(cjson.decode, previousRaw)
  if ok and previous.queueKey then redis.call('ZREM', previous.queueKey, userId) end
end
payload.queueKey = ownQueue
redis.call('SET', entryPrefix .. userId, cjson.encode(payload), 'EX', ttl)
redis.call('ZADD', ownQueue, now, userId)

local bestId = nil
local bestRaw = nil
local bestQueue = nil
local bestScore = nil
for keyIndex = 1, #KEYS do
  local rows = redis.call('ZRANGE', KEYS[keyIndex], 0, scanLimit - 1, 'WITHSCORES')
  for index = 1, #rows, 2 do
    local candidateId = rows[index]
    local candidateScore = tonumber(rows[index + 1])
    if candidateId ~= userId then
      local candidateRaw = redis.call('GET', entryPrefix .. candidateId)
      local onlineScore = redis.call('ZSCORE', 'presence:online', candidateId)
      if not candidateRaw or not onlineScore or tonumber(onlineScore) <= now then
        redis.call('ZREM', KEYS[keyIndex], candidateId)
        if not onlineScore or tonumber(onlineScore) <= now then redis.call('DEL', entryPrefix .. candidateId) end
      else
        local ok, candidate = pcall(cjson.decode, candidateRaw)
        if not ok then
          redis.call('ZREM', KEYS[keyIndex], candidateId)
          redis.call('DEL', entryPrefix .. candidateId)
        elseif candidate.anyField == true or payload.anyField == true or candidate.subjectKey == payload.subjectKey then
          local compatible = candidate.availability == payload.availability or candidate.availability == 'flexible' or payload.availability == 'flexible'
          if compatible and (not bestScore or candidateScore < bestScore) then
            bestId = candidateId
            bestRaw = candidateRaw
            bestQueue = KEYS[keyIndex]
            bestScore = candidateScore
          end
        end
      end
    end
  end
end

if bestId then
  redis.call('ZREM', ownQueue, userId)
  redis.call('ZREM', bestQueue, bestId)
  redis.call('DEL', entryPrefix .. userId)
  redis.call('DEL', entryPrefix .. bestId)
  return { bestId, bestRaw }
end
return {}
`;

const CANCEL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, entry = pcall(cjson.decode, raw)
if ok and entry.queueKey then redis.call('ZREM', entry.queueKey, ARGV[1]) end
redis.call('DEL', KEYS[1])
return 1
`;

const STATUS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {} end
local entry = cjson.decode(raw)
local rank = redis.call('ZRANK', entry.queueKey, ARGV[1])
if not rank then return {} end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return { raw, tostring(rank + 1) }
`;

function queueKey(subjectKey, availability) {
  return `match:queue:${subjectKey}:${availability}`;
}

function candidateAvailabilities(availability) {
  return availability === 'flexible' ? ['now', 'later', 'flexible'] : [availability, 'flexible'];
}

async function enqueue({ userId, subject, availability, displayName, anyField = false }) {
  const subjectKey = anyField ? 'all-fields' : normalizeSubject(subject);
  if (!subjectKey) throw new AppError(400, 'INVALID_SUBJECT', 'A valid study subject is required');
  const ownQueue = queueKey(subjectKey, availability);
  const candidates = [...new Set(candidateAvailabilities(availability).map((value) => queueKey(subjectKey, value)))];
  // The Lua scan starts at KEYS[1], so it can find another user in ownQueue too.
  const keys = [ownQueue, ...candidates.filter((key) => key !== ownQueue)];
  const payload = {
    userId: String(userId),
    subject: subject.trim(),
    subjectKey,
    anyField,
    availability,
    displayName,
    enqueuedAt: Date.now()
  };
  const result = await redis.eval(MATCH_SCRIPT, {
    keys,
    arguments: [String(userId), ENTRY_PREFIX, JSON.stringify(payload), String(Date.now()), String(env.matchQueueTtlSeconds), '100']
  });
  if (!Array.isArray(result) || result.length < 2) {
    const rank = await redis.zRank(ownQueue, String(userId));
    return { status: 'queued', queuePosition: rank == null ? null : rank + 1, subject, availability, anyField };
  }
  return { status: 'matched', peerId: String(result[0]), peerEntry: JSON.parse(String(result[1])), subject, availability };
}

export async function requestMatch({ user, subject, availability, anyField = false }) {
  if (!(await isUserOnline(user._id))) {
    throw new AppError(409, 'SOCKET_REQUIRED', 'Connect to the real-time server before entering matchmaking');
  }
  const subjectKey = anyField ? 'all-fields' : normalizeSubject(subject);
  if (!subjectKey) throw new AppError(400, 'INVALID_SUBJECT', 'A valid study subject is required');
  if (!anyField && !user.subjectKeys?.includes(subjectKey)) {
    throw new AppError(400, 'SUBJECT_NOT_IN_PROFILE', 'You can only match in a field listed on your profile');
  }
  const matchSubject = anyField ? 'Any field' : subject;
  const selfResult = await enqueue({ userId: user._id, subject: matchSubject, availability, displayName: user.displayName, anyField });
  if (selfResult.status === 'queued') return selfResult;

  const peerId = selfResult.peerId;
  if (peerId === String(user._id)) throw new AppError(500, 'MATCH_QUEUE_INVALID', 'Matchmaking returned the same user');
  const peerData = selfResult.peerEntry;
  const peer = await User.findOne({ _id: peerId, isDisabled: false });
  if (!peer
    || (!anyField && !peerData.anyField && peerData.subjectKey !== subjectKey)
    || (!peerData.anyField && !peer.subjectKeys?.includes(peerData.subjectKey))
    || !(await isUserOnline(peerId))) {
    publishMatchFailed([String(user._id)]);
    return { status: 'retry', message: 'That student is no longer available. Please search again.' };
  }
  const currentUser = await User.findOne({ _id: user._id, isDisabled: false });
  if (!currentUser || (!anyField && !currentUser.subjectKeys?.includes(subjectKey))) {
    publishMatchFailed([String(user._id)]);
    return { status: 'retry', message: 'Your study fields changed while searching. Please try again.' };
  }
  const roomSubject = anyField && !peerData.anyField ? peerData.subject : matchSubject;
  const roomSubjectKey = anyField && !peerData.anyField ? peerData.subjectKey : subjectKey;
  try {
    const result = await createMatchedRoom({
      firstUser: currentUser,
      secondUser: peer,
      subject: roomSubject,
      subjectKey: roomSubjectKey,
      source: 'matchmaking'
    });
    const payload = {
      room: roomDto(result.room),
      participants: [publicUser(currentUser, true), publicUser(peer, await isUserOnline(peer._id))],
      subject: roomSubject,
      matchedAt: new Date().toISOString()
    };
    publishMatchFound([String(user._id), peerId], payload);
    return { status: 'matched', ...payload };
  } catch (error) {
    publishMatchFailed([String(user._id), peerId]);
    console.error('[matchmaking] room creation failed', { peerId, queuedDisplayName: peerData.displayName, error: error.message });
    throw error;
  }
}

export async function cancelMatch(userId) {
  const cancelled = Number(await redis.eval(CANCEL_SCRIPT, {
    keys: [`${ENTRY_PREFIX}${userId}`],
    arguments: [String(userId)]
  }));
  return { cancelled: cancelled === 1 };
}

export async function matchmakingStatus(userId) {
  const result = await redis.eval(STATUS_SCRIPT, {
    keys: [`${ENTRY_PREFIX}${userId}`],
    arguments: [String(userId), String(env.matchQueueTtlSeconds)]
  });
  if (!Array.isArray(result) || result.length < 2) return { status: 'idle' };
  const entry = JSON.parse(String(result[0]));
  return { status: 'queued', subject: entry.subject, anyField: Boolean(entry.anyField), availability: entry.availability, queuePosition: Number(result[1]) };
}
