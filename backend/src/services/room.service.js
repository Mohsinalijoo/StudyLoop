import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { Room } from '../models/Room.js';
import { Session } from '../models/Session.js';
import { AppError } from '../utils/AppError.js';
import { normalizeSubject } from '../utils/validation.js';
import { cacheRoomMember, uncacheRoomMember, ensureRoomMemberCache, activeRoomMediaKey } from './presence.room-cache.js';
import { withDistributedLock } from './distributedLock.js';

function sameId(a, b) { return String(a?._id ?? a) === String(b?._id ?? b); }

async function withMongoTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function createGroupRoom({ user, title, subject, capacity = env.roomCapacityMax }) {
  const subjectKey = normalizeSubject(subject);
  if (!subjectKey) throw new AppError(400, 'INVALID_SUBJECT', 'A valid study subject is required');
  if (!user.subjectKeys?.includes(subjectKey)) throw new AppError(400, 'SUBJECT_NOT_IN_PROFILE', 'Room subject must be listed on your profile');
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > env.roomCapacityMax) {
    throw new AppError(400, 'INVALID_CAPACITY', `capacity must be between 2 and ${env.roomCapacityMax}`);
  }
  const roomTitle = typeof title === 'string' && title.trim()
    ? title.trim().slice(0, 80)
    : `${subject} study room`;
  const roomId = new mongoose.Types.ObjectId();
  const joinedAt = new Date();

  const room = await withMongoTransaction(async (tx) => {
    const [created] = await Room.create([{
      _id: roomId,
      title: roomTitle,
      subject,
      subjectKey,
      type: 'group',
      capacity,
      host: user._id,
      members: [user._id],
      participantIds: [user._id],
      status: 'active'
    }], { session: tx });
    await Session.create([{
      roomId,
      userId: user._id,
      joinedAt,
      source: 'api'
    }], { session: tx });
    return created;
  });
  await cacheRoomMember(room._id, user._id);
  return { room, joined: true, session: { joinedAt } };
}

export async function createMatchedRoom({ firstUser, secondUser, subject, subjectKey, source = 'matchmaking' }) {
  const roomId = new mongoose.Types.ObjectId();
  const joinedAt = new Date();
  const room = await withMongoTransaction(async (tx) => {
    const [created] = await Room.create([{
      _id: roomId,
      title: `1:1 ${subject} study session`,
      subject,
      subjectKey,
      type: 'pair',
      capacity: 2,
      host: firstUser._id,
      members: [firstUser._id, secondUser._id],
      participantIds: [firstUser._id, secondUser._id],
      status: 'active'
    }], { session: tx });
    await Session.create([
      { roomId, userId: firstUser._id, joinedAt, source },
      { roomId, userId: secondUser._id, joinedAt, source }
    ], { session: tx, ordered: true });
    return created;
  });
  await Promise.all([
    cacheRoomMember(room._id, firstUser._id),
    cacheRoomMember(room._id, secondUser._id)
  ]);
  return { room, joined: true, session: { joinedAt } };
}

export async function joinRoom({ roomId, userId, source = 'api', ownerApproved = false }) {
  return withDistributedLock(`lock:room:${roomId}`, async () => {
    const result = await withMongoTransaction(async (tx) => {
      const room = await Room.findById(roomId).session(tx);
      if (!room || room.status !== 'active') throw new AppError(404, 'ROOM_NOT_FOUND', 'Active room not found');
      const existingMember = room.members.some((member) => sameId(member, userId));
      if (existingMember) {
        let activeSession = await Session.findOne({ roomId, userId, leftAt: null }).sort({ joinedAt: -1 }).session(tx);
        if (!activeSession) {
          const [createdSession] = await Session.create([{ roomId, userId, joinedAt: new Date(), source }], { session: tx });
          activeSession = createdSession;
        }
        return { room, joined: false, session: activeSession };
      }
      if (!sameId(room.host, userId) && !ownerApproved) {
        throw new AppError(403, 'ROOM_JOIN_REQUEST_REQUIRED', 'Send a request to the room owner and wait for approval before joining');
      }
      if (room.members.length >= room.capacity) throw new AppError(409, 'ROOM_FULL', 'This room has reached its participant limit');
      room.members.addToSet(userId);
      room.participantIds.addToSet(userId);
      await room.save({ session: tx });
      const [sessionRecord] = await Session.create([{ roomId, userId, joinedAt: new Date(), source }], { session: tx });
      return { room, joined: true, session: sessionRecord };
    });
    await cacheRoomMember(roomId, userId);
    return result;
  });
}

export async function leaveRoom({ roomId, userId }) {
  return withDistributedLock(`lock:room:${roomId}`, async () => {
    const result = await withMongoTransaction(async (tx) => {
      const room = await Room.findById(roomId).session(tx);
      if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'Room not found');
      const wasMember = room.members.some((member) => sameId(member, userId));
      if (!wasMember) return { room, left: false, roomClosed: room.status === 'closed', session: null };

      const leftAt = new Date();
      const sessionRecord = await Session.findOne({ roomId, userId, leftAt: null }).sort({ joinedAt: -1 }).session(tx);
      let durationSeconds = 0;
      if (sessionRecord) {
        sessionRecord.leftAt = leftAt;
        durationSeconds = Math.max(0, Math.floor((leftAt.getTime() - sessionRecord.joinedAt.getTime()) / 1000));
        sessionRecord.durationSeconds = durationSeconds;
        await sessionRecord.save({ session: tx });
      }
      room.members.pull(userId);
      const roomClosed = room.members.length === 0;
      if (roomClosed) {
        room.status = 'closed';
        room.closedAt = leftAt;
      }
      await room.save({ session: tx });
      return { room, left: true, roomClosed, leftAt, durationSeconds, session: sessionRecord };
    });

    await uncacheRoomMember(roomId, userId);
    return result;
  });
}

export async function updateRoomGoal({ roomId, userId, goal }) {
  const room = await Room.findOne({ _id: roomId, status: 'active', members: userId });
  if (!room) throw new AppError(403, 'ROOM_MEMBERSHIP_REQUIRED', 'Join the active room before setting its study goal');
  room.goal = goal;
  await room.save();
  return room;
}

export async function setRoomMediaState({ roomId, userId, field, enabled }) {
  const key = activeRoomMediaKey(roomId);
  const raw = await redis.hGet(key, String(userId));
  let state = { micEnabled: true, cameraEnabled: true };
  if (raw) {
    try { state = { ...state, ...JSON.parse(raw) }; } catch { /* replace invalid cache state */ }
  }
  if (field === 'micEnabled') state.micEnabled = enabled;
  if (field === 'cameraEnabled') state.cameraEnabled = enabled;
  state.updatedAt = new Date().toISOString();
  await redis.hSet(key, String(userId), JSON.stringify(state));
  return state;
}

export async function canAccessRoom({ roomId, userId }) {
  const room = await Room.findOne({ _id: roomId, status: 'active', members: userId })
    .populate('members', 'displayName subjects availability timezone bio')
    .lean();
  if (!room) throw new AppError(403, 'ROOM_MEMBERSHIP_REQUIRED', 'Join the active room first');
  await ensureRoomMemberCache(roomId, userId);
  return room;
}

export async function listActiveRooms({ subject, limit = 20, userId }) {
  const filter = {
    status: 'active',
    $or: [{ type: 'group' }, { type: 'pair', members: userId }]
  };
  if (subject) filter.subjectKey = normalizeSubject(subject);
  return Room.find(filter).sort({ createdAt: -1 }).limit(limit)
    .populate('members', 'displayName subjects availability')
    .lean();
}

export async function getRoom(roomId, userId) {
  const room = await Room.findOne({
    _id: roomId,
    $or: [{ type: 'group' }, { type: 'pair', members: userId }]
  }).populate('members', 'displayName subjects availability').lean();
  if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'Room not found');
  return room;
}

export async function currentActiveRooms(userId) {
  return Room.find({ status: 'active', members: userId }).select('_id').lean();
}
