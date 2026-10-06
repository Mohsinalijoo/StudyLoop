import { redis } from '../config/redis.js';
import { Room } from '../models/Room.js';

export const activeRoomsKey = 'active:rooms';
export const activeRoomKey = (roomId) => `active:room:${roomId}`;
export const activeUserRoomsKey = (userId) => `active:user:${userId}`;
export const activeRoomMediaKey = (roomId) => `active:room:${roomId}:media`;

export async function cacheRoomMember(roomId, userId) {
  const rid = String(roomId);
  const uid = String(userId);
  const multi = redis.multi();
  multi.sAdd(activeRoomsKey, rid);
  multi.sAdd(activeRoomKey(rid), uid);
  multi.sAdd(activeUserRoomsKey(uid), rid);
  multi.hSetNX(activeRoomMediaKey(rid), uid, JSON.stringify({ micEnabled: true, cameraEnabled: true }));
  await multi.exec();
}

export async function uncacheRoomMember(roomId, userId) {
  const rid = String(roomId);
  const uid = String(userId);
  const multi = redis.multi();
  multi.sRem(activeRoomKey(rid), uid);
  multi.sRem(activeUserRoomsKey(uid), rid);
  multi.hDel(activeRoomMediaKey(rid), uid);
  await multi.exec();
  const count = await redis.sCard(activeRoomKey(rid));
  if (count === 0) {
    const cleanup = redis.multi();
    cleanup.del(activeRoomKey(rid));
    cleanup.del(activeRoomMediaKey(rid));
    cleanup.sRem(activeRoomsKey, rid);
    await cleanup.exec();
  }
  return count;
}

export async function getCachedRoomMembers(roomId) {
  return redis.sMembers(activeRoomKey(String(roomId)));
}

export async function ensureRoomMemberCache(roomId, userId) {
  const key = activeRoomKey(String(roomId));
  if (!(await redis.sIsMember(key, String(userId)))) await cacheRoomMember(roomId, userId);
}

export async function assertActiveRoomMember(roomId, userId) {
  const room = await Room.findOne({ _id: roomId, status: 'active', members: userId }).select('_id').lean();
  if (!room) return false;
  await ensureRoomMemberCache(roomId, userId);
  return true;
}

export async function hydrateActiveRoomCache() {
  const rooms = await Room.find({ status: 'active' }).select('_id members').lean();
  const activeIds = new Set(rooms.map((room) => String(room._id)));
  const existingIds = await redis.sMembers(activeRoomsKey);
  for (const staleId of existingIds.filter((id) => !activeIds.has(id))) {
    const oldMembers = await redis.sMembers(activeRoomKey(staleId));
    const multi = redis.multi();
    for (const userId of oldMembers) multi.sRem(activeUserRoomsKey(userId), staleId);
    multi.del(activeRoomKey(staleId));
    multi.del(activeRoomMediaKey(staleId));
    multi.sRem(activeRoomsKey, staleId);
    await multi.exec();
  }
  for (const room of rooms) {
    for (const userId of room.members) await cacheRoomMember(room._id, userId);
  }
  console.info(`[redis] hydrated ${rooms.length} active rooms`);
}
