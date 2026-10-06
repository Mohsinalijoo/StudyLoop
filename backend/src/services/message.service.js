import mongoose from 'mongoose';
import { ChatMessage } from '../models/ChatMessage.js';
import { Room } from '../models/Room.js';
import { AppError } from '../utils/AppError.js';
import { assertActiveRoomMember } from './presence.room-cache.js';

export async function createRoomMessage({ roomId, sender, body, clientMessageId }) {
  if (!(await assertActiveRoomMember(roomId, sender._id))) {
    throw new AppError(403, 'ROOM_MEMBERSHIP_REQUIRED', 'Join this active room before sending messages');
  }
  const message = String(body ?? '').trim();
  if (!message || message.length > 2000) throw new AppError(400, 'INVALID_MESSAGE', 'Message must contain 1–2000 characters');
  const safeClientId = typeof clientMessageId === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(clientMessageId)
    ? clientMessageId
    : new mongoose.Types.ObjectId().toString();
  try {
    return await ChatMessage.create({
      roomId,
      senderId: sender._id,
      senderName: sender.displayName,
      body: message,
      clientMessageId: safeClientId
    });
  } catch (error) {
    if (error?.code === 11000) {
      return ChatMessage.findOne({ roomId, senderId: sender._id, clientMessageId: safeClientId });
    }
    throw error;
  }
}

export async function getRoomMessages({ roomId, userId, before, limit = 50 }) {
  const participant = await Room.exists({ _id: roomId, participantIds: userId });
  if (!participant) throw new AppError(403, 'ROOM_MEMBERSHIP_REQUIRED', 'Only room participants can read chat history');
  const query = { roomId };
  if (before) {
    const date = new Date(before);
    if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_CURSOR', 'before must be a valid ISO date');
    query.createdAt = { $lt: date };
  }
  const messages = await ChatMessage.find(query).sort({ createdAt: -1 }).limit(limit).populate('senderId', 'displayName').lean();
  return messages.reverse().map((message) => ({
    id: String(message._id),
    roomId: String(message.roomId),
    sender: { id: String(message.senderId?._id || message.senderId), displayName: message.senderName },
    body: message.body,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt
  }));
}
