import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit, requireObjectId, requireString } from '../utils/validation.js';
import { createGroupRoom, joinRoom, leaveRoom, getRoom, listActiveRooms } from '../services/room.service.js';
import { getRoomMessages } from '../services/message.service.js';
import { roomDto, publicUser } from '../utils/serializers.js';
import { isUserOnline } from '../services/presence.service.js';
import { attachUserSocketsToRoom, detachUserSocketsFromRoom, publishRoomJoin, publishRoomLeave } from '../sockets/publishers.js';

export const create = asyncHandler(async (req, res) => {
  const subject = requireString(req.body.subject, 'subject', { min: 2, max: 80 });
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const capacity = req.body.capacity === undefined ? 4 : Number(req.body.capacity);
  const result = await createGroupRoom({ user: req.user, title, subject, capacity });
  await attachUserSocketsToRoom(req.auth.userId, result.room._id);
  publishRoomJoin({ roomId: result.room._id, user: publicUser(req.user, await isUserOnline(req.auth.userId)), session: result.session, room: result.room });
  res.status(201).json({ data: { room: roomDto(result.room), session: { joinedAt: result.session.joinedAt } } });
});

export const list = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 20, 100);
  const subject = req.query.subject ? requireString(req.query.subject, 'subject', { min: 2, max: 80 }) : undefined;
  const rooms = await listActiveRooms({ subject, limit });
  res.json({ data: rooms.map(roomDto) });
});

export const getOne = asyncHandler(async (req, res) => {
  const roomId = requireObjectId(req.params.roomId, 'roomId');
  res.json({ data: { room: roomDto(await getRoom(roomId)) } });
});

export const join = asyncHandler(async (req, res) => {
  const roomId = requireObjectId(req.params.roomId, 'roomId');
  const result = await joinRoom({ roomId, userId: req.auth.userId, source: 'api' });
  await attachUserSocketsToRoom(req.auth.userId, roomId);
  if (result.joined) {
    publishRoomJoin({ roomId, user: publicUser(req.user, await isUserOnline(req.auth.userId)), session: result.session, room: result.room });
  }
  res.json({ data: { room: roomDto(result.room), joined: result.joined, session: { id: String(result.session._id), joinedAt: result.session.joinedAt } } });
});

export const leave = asyncHandler(async (req, res) => {
  const roomId = requireObjectId(req.params.roomId, 'roomId');
  const result = await leaveRoom({ roomId, userId: req.auth.userId });
  if (result.left) {
    publishRoomLeave({
      roomId,
      userId: req.auth.userId,
      leftAt: result.leftAt,
      durationSeconds: result.durationSeconds,
      roomClosed: result.roomClosed,
      memberCount: result.room.members.length
    });
  }
  await detachUserSocketsFromRoom(req.auth.userId, roomId);
  res.json({ data: { left: result.left, roomClosed: result.roomClosed, leftAt: result.leftAt || null, durationSeconds: result.durationSeconds || 0 } });
});

export const messages = asyncHandler(async (req, res) => {
  const roomId = requireObjectId(req.params.roomId, 'roomId');
  const limit = parseLimit(req.query.limit, 50, 100);
  const data = await getRoomMessages({ roomId, userId: req.auth.userId, before: req.query.before, limit });
  res.json({ data });
});
