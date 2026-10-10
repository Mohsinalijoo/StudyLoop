import { getSocketServer, studySocketRoom, userSocketRoom } from './runtime.js';

export async function attachUserSocketsToRoom(userId, roomId) {
  await getSocketServer().in(userSocketRoom(userId)).socketsJoin(studySocketRoom(roomId));
}

export async function detachUserSocketsFromRoom(userId, roomId) {
  await getSocketServer().in(userSocketRoom(userId)).socketsLeave(studySocketRoom(roomId));
}

export function publishPresence(userId, online) {
  getSocketServer().emit('presence:changed', { userId: String(userId), online, at: new Date().toISOString() });
}

export function publishRoomJoin({ roomId, user, session, room }) {
  getSocketServer().to(studySocketRoom(roomId)).emit('user_joined', {
    roomId: String(roomId),
    user,
    joinedAt: session?.joinedAt || new Date().toISOString(),
    memberCount: room?.members?.length
  });
}

export function publishRoomClosed({ roomId, closedAt }) {
  getSocketServer().to(studySocketRoom(roomId)).emit('room:closed', {
    roomId: String(roomId),
    closedAt: closedAt || new Date().toISOString()
  });
}

export function publishRoomLeave({ roomId, userId, leftAt, durationSeconds, roomClosed, memberCount }) {
  const io = getSocketServer();
  const channel = studySocketRoom(roomId);
  io.to(channel).emit('user_left', {
    roomId: String(roomId),
    userId: String(userId),
    leftAt,
    durationSeconds,
    memberCount,
    roomClosed
  });
  if (roomClosed) io.to(channel).emit('room:closed', { roomId: String(roomId), closedAt: leftAt });
}

export function publishMatchFound(userIds, payload) {
  const io = getSocketServer();
  const channel = studySocketRoom(payload.room.id);
  for (const userId of userIds) {
    io.in(userSocketRoom(userId)).socketsJoin(channel);
    io.to(userSocketRoom(userId)).emit('match:found', payload);
  }
  for (const user of payload.participants) {
    io.to(channel).emit('user_joined', {
      roomId: payload.room.id,
      user,
      joinedAt: payload.matchedAt,
      memberCount: payload.participants.length
    });
  }
}

export function publishMatchFailed(userIds, message = 'A study match could not be opened. Tap Find Study Buddy to try again.') {
  const io = getSocketServer();
  for (const userId of userIds) io.to(userSocketRoom(userId)).emit('match:failed', { message });
}

export function publishStudyRequestReceived(userId, request) {
  getSocketServer().to(userSocketRoom(userId)).emit('study-request:received', request);
}

export function publishStudyRequestUpdated(userIds, request) {
  const io = getSocketServer();
  for (const userId of new Set(userIds.map(String))) {
    if (userId) io.to(userSocketRoom(userId)).emit('study-request:updated', request);
  }
}
