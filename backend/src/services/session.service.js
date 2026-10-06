import { Session } from '../models/Session.js';

export async function listUserSessions(userId, limit = 50) {
  const sessions = await Session.find({ userId }).sort({ joinedAt: -1 }).limit(limit)
    .populate('roomId', 'title subject type status')
    .lean();
  const now = Date.now();
  return sessions.map((session) => ({
    id: String(session._id),
    room: session.roomId ? {
      id: String(session.roomId._id),
      title: session.roomId.title,
      subject: session.roomId.subject,
      type: session.roomId.type,
      status: session.roomId.status
    } : null,
    joinedAt: session.joinedAt,
    leftAt: session.leftAt,
    durationSeconds: session.leftAt
      ? session.durationSeconds
      : Math.max(0, Math.floor((now - new Date(session.joinedAt).getTime()) / 1000)),
    active: !session.leftAt,
    source: session.source
  }));
}
