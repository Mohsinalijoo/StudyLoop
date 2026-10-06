import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { socketCorsOptions, allowSocketOrigin } from '../config/cors.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { requireObjectId, requireString } from '../utils/validation.js';
import { roomDto, publicUser } from '../utils/serializers.js';
import { joinRoom, leaveRoom, setRoomMediaState, updateRoomGoal, currentActiveRooms } from '../services/room.service.js';
import { assertActiveRoomMember, ensureRoomMemberCache } from '../services/presence.room-cache.js';
import { createRoomMessage } from '../services/message.service.js';
import { registerSocket, renewSocket, removeSocket, cleanupExpiredPresence, isUserOnline } from '../services/presence.service.js';
import { cancelMatch } from '../services/matchmaking.service.js';
import { checkSocketRateLimit } from '../middleware/rateLimit.js';
import { publishPresence, publishRoomJoin, publishRoomLeave } from './publishers.js';
import { setSocketServer, userSocketRoom, studySocketRoom } from './runtime.js';

let io;
let pubClient;
let subClient;
let presenceJanitor;

const socketError = (error) => ({
  code: error.code || 'SOCKET_ERROR',
  message: error.statusCode && error.statusCode < 500 ? error.message : 'The request could not be completed'
});

function bindRequest(socket, event, handler) {
  socket.on(event, async (payload = {}, ack) => {
    try {
      const data = await handler(payload || {});
      if (typeof ack === 'function') ack({ ok: true, data });
    } catch (error) {
      if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      else socket.emit('server:error', socketError(error));
      if (!error.statusCode || error.statusCode >= 500) console.error(`[socket] ${event} failed`, error);
    }
  });
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a boolean`);
  return value;
}

async function verifyRoomMembership(roomId, userId) {
  const allowed = await assertActiveRoomMember(roomId, userId);
  if (!allowed) throw new AppError(403, 'ROOM_MEMBERSHIP_REQUIRED', 'Join this active room first');
}

function messageDto(message) {
  return {
    id: String(message._id),
    roomId: String(message.roomId),
    sender: { id: String(message.senderId), displayName: message.senderName },
    body: message.body,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt
  };
}

async function setupConnection(socket) {
  const user = socket.data.user;
  const userId = String(user._id);
  await socket.join(userSocketRoom(userId));
  const presence = await registerSocket(userId, socket.id);
  const activeRooms = await currentActiveRooms(userId);
  for (const room of activeRooms) {
    await ensureRoomMemberCache(room._id, userId);
    await socket.join(studySocketRoom(room._id));
  }
  if (presence.becameOnline) publishPresence(userId, true);
  socket.emit('connection:ready', {
    user: publicUser(user, true),
    activeRoomIds: activeRooms.map((room) => String(room._id)),
    serverTime: new Date().toISOString()
  });

  const heartbeat = setInterval(async () => {
    try {
      const state = await renewSocket(userId, socket.id);
      if (state.becameOnline) publishPresence(userId, true);
    } catch (error) {
      console.error('[presence] heartbeat failed', error.message);
    }
  }, env.presenceHeartbeatMs);
  heartbeat.unref?.();

  bindRequest(socket, 'room:join', async (payload) => {
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const result = await joinRoom({ roomId, userId, source: 'socket' });
    await io.in(userSocketRoom(userId)).socketsJoin(studySocketRoom(roomId));
    if (result.joined) {
      publishRoomJoin({ roomId, user: publicUser(user, true), session: result.session, room: result.room });
    }
    return { room: roomDto(result.room), joined: result.joined, session: { id: String(result.session._id), joinedAt: result.session.joinedAt } };
  });

  bindRequest(socket, 'room:leave', async (payload) => {
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const result = await leaveRoom({ roomId, userId });
    if (result.left) {
      publishRoomLeave({ roomId, userId, leftAt: result.leftAt, durationSeconds: result.durationSeconds, roomClosed: result.roomClosed, memberCount: result.room.members.length });
    }
    await io.in(userSocketRoom(userId)).socketsLeave(studySocketRoom(roomId));
    return { left: result.left, roomClosed: result.roomClosed, leftAt: result.leftAt || null, durationSeconds: result.durationSeconds || 0 };
  });

  bindRequest(socket, 'room:goal', async (payload) => {
    if (!(await checkSocketRateLimit(userId, 'room-goal', 10, 10))) throw new AppError(429, 'RATE_LIMITED', 'Room goals are being updated too frequently');
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const goal = requireString(payload.goal, 'goal', { min: 0, max: 200 });
    const room = await updateRoomGoal({ roomId, userId, goal });
    const update = { roomId, goal: room.goal, userId, updatedAt: room.updatedAt };
    socket.to(studySocketRoom(roomId)).emit('room:goal', update);
    return update;
  });

  bindRequest(socket, 'message', async (payload) => {
    if (!(await checkSocketRateLimit(userId, 'message', 30, 10))) throw new AppError(429, 'RATE_LIMITED', 'You are sending messages too quickly');
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const body = requireString(payload.body, 'message', { min: 1, max: 2000 });
    const message = await createRoomMessage({ roomId, sender: user, body, clientMessageId: payload.clientMessageId });
    const dto = messageDto(message);
    socket.to(studySocketRoom(roomId)).emit('message', dto);
    return dto;
  });

  bindRequest(socket, 'mic_toggle', async (payload) => {
    if (!(await checkSocketRateLimit(userId, 'media-toggle', 20, 5))) throw new AppError(429, 'RATE_LIMITED', 'Media controls are being toggled too quickly');
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const enabled = requireBoolean(payload.enabled, 'enabled');
    await verifyRoomMembership(roomId, userId);
    const state = await setRoomMediaState({ roomId, userId, field: 'micEnabled', enabled });
    const event = { roomId, userId, enabled, state, at: new Date().toISOString() };
    socket.to(studySocketRoom(roomId)).emit('mic_toggle', event);
    return event;
  });

  bindRequest(socket, 'camera_toggle', async (payload) => {
    if (!(await checkSocketRateLimit(userId, 'media-toggle', 20, 5))) throw new AppError(429, 'RATE_LIMITED', 'Media controls are being toggled too quickly');
    const roomId = requireObjectId(payload.roomId, 'roomId');
    const enabled = requireBoolean(payload.enabled, 'enabled');
    await verifyRoomMembership(roomId, userId);
    const state = await setRoomMediaState({ roomId, userId, field: 'cameraEnabled', enabled });
    const event = { roomId, userId, enabled, state, at: new Date().toISOString() };
    socket.to(studySocketRoom(roomId)).emit('camera_toggle', event);
    return event;
  });

  const bindSignal = (eventName, expectedType, dataField) => {
    bindRequest(socket, eventName, async (payload) => {
      if (!(await checkSocketRateLimit(userId, 'webrtc-signal', 30, 10))) throw new AppError(429, 'RATE_LIMITED', 'WebRTC signaling is being sent too quickly');
      const roomId = requireObjectId(payload.roomId, 'roomId');
      await verifyRoomMembership(roomId, userId);
      const signalData = payload[dataField];
      const validData = expectedType
        ? signalData && typeof signalData === 'object' && JSON.stringify(signalData).length <= 256_000
        : signalData === null || (signalData && typeof signalData === 'object' && JSON.stringify(signalData).length <= 256_000);
      if (!validData) throw new AppError(400, 'INVALID_SIGNAL', 'WebRTC signal payload is invalid or too large');
      if (expectedType && signalData.type !== expectedType) throw new AppError(400, 'INVALID_SIGNAL', `Signal description type must be ${expectedType}`);
      const toUserId = payload.toUserId ? requireObjectId(payload.toUserId, 'toUserId') : null;
      if (toUserId) {
        if (toUserId === userId) throw new AppError(400, 'INVALID_SIGNAL_TARGET', 'Cannot signal yourself');
        await verifyRoomMembership(roomId, toUserId);
        if (!(await isUserOnline(toUserId))) throw new AppError(409, 'PEER_OFFLINE', 'The target student is not currently connected');
      }
      const outgoing = { roomId, fromUserId: userId, [dataField]: signalData, at: new Date().toISOString() };
      if (toUserId) io.to(userSocketRoom(toUserId)).emit(eventName, outgoing);
      else socket.to(studySocketRoom(roomId)).emit(eventName, outgoing);
      return { delivered: true, toUserId };
    });
  };
  bindSignal('webrtc:offer', 'offer', 'description');
  bindSignal('webrtc:answer', 'answer', 'description');
  bindSignal('webrtc:ice-candidate', null, 'candidate');

  socket.on('disconnect', async (reason) => {
    clearInterval(heartbeat);
    try {
      const state = await removeSocket(userId, socket.id);
      if (state.becameOffline) {
        publishPresence(userId, false);
        await cancelMatch(userId);
      }
    } catch (error) {
      console.error('[presence] disconnect cleanup failed', { userId, reason, error: error.message });
    }
  });
}

export async function createSocketServer(httpServer) {
  pubClient = redis.duplicate();
  subClient = redis.duplicate();
  pubClient.on('error', (error) => console.error('[socket-redis] publisher error', error));
  subClient.on('error', (error) => console.error('[socket-redis] subscriber error', error));
  await Promise.all([pubClient.connect(), subClient.connect()]);

  io = new Server(httpServer, {
    cors: socketCorsOptions,
    allowRequest: allowSocketOrigin,
    maxHttpBufferSize: 1024 * 1024,
    connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: false }
  });
  io.adapter(createAdapter(pubClient, subClient));
  setSocketServer(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('AUTH_REQUIRED'));
      const claims = jwt.verify(token, env.jwtAccessSecret, { issuer: env.jwtIssuer, audience: env.jwtAudience });
      if (claims.typ !== 'access' || !claims.sub) return next(new Error('INVALID_TOKEN'));
      const user = await User.findOne({ _id: claims.sub, isDisabled: false }).select('_id displayName email subjects subjectKeys availability timezone bio');
      if (!user) return next(new Error('ACCOUNT_UNAVAILABLE'));
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('AUTH_REQUIRED'));
    }
  });

  io.on('connection', (socket) => {
    setupConnection(socket).catch((error) => {
      console.error('[socket] connection setup failed', error);
      socket.disconnect(true);
    });
  });

  presenceJanitor = setInterval(async () => {
    try {
      const expiredUserIds = await cleanupExpiredPresence();
      for (const userId of expiredUserIds) {
        publishPresence(userId, false);
        await cancelMatch(userId);
      }
    } catch (error) {
      console.error('[presence] janitor failed', error.message);
    }
  }, Math.max(env.presenceHeartbeatMs, 15000));
  presenceJanitor.unref?.();
  return io;
}

export async function closeSocketServer() {
  if (presenceJanitor) clearInterval(presenceJanitor);
  if (io) await new Promise((resolve) => io.close(resolve));
  if (pubClient?.isOpen) await pubClient.quit();
  if (subClient?.isOpen) await subClient.quit();
}
