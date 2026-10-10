import { User } from '../models/User.js';
import { Room } from '../models/Room.js';
import { Session } from '../models/Session.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { StudyNote } from '../models/StudyNote.js';
import { Flashcard } from '../models/Flashcard.js';
import { StudyRequest } from '../models/StudyRequest.js';
import { PlannerTask } from '../models/PlannerTask.js';
import { cancelMatch } from './matchmaking.service.js';
import { currentActiveRooms, leaveRoom } from './room.service.js';
import { revokeAllRefreshTokens } from './token.service.js';
import { revokeAllPasswordResetTokens } from './password-reset.service.js';
import { removeUserPresence } from './presence.service.js';
import { getSocketServer, userSocketRoom } from '../sockets/runtime.js';
import { publishPresence, publishRoomLeave } from '../sockets/publishers.js';
import { withDistributedLock } from './distributedLock.js';
import { AppError } from '../utils/AppError.js';

const sameId = (left, right) => String(left?._id ?? left) === String(right?._id ?? right);

export async function permanentlyDeleteAccount(userId) {
  const id = String(userId);
  const user = await User.findOne({ _id: id, isDisabled: false }).select('_id');
  if (!user) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'The account no longer exists');

  await cancelMatch(id);

  const activeRooms = await currentActiveRooms(id);
  for (const activeRoom of activeRooms) {
    const result = await leaveRoom({ roomId: activeRoom._id, userId: id });
    if (result.left) {
      publishRoomLeave({
        roomId: activeRoom._id,
        userId: id,
        leftAt: result.leftAt,
        durationSeconds: result.durationSeconds,
        roomClosed: result.roomClosed,
        memberCount: result.room.members.length
      });
    }
  }

  // Remove this account's references from active and archived rooms. Transfer
  // room ownership to a remaining member, or clear it on an empty closed room.
  const associatedRooms = await Room.find({
    $or: [{ host: user._id }, { members: user._id }, { participantIds: user._id }]
  }).select('_id').lean();
  for (const { _id: roomId } of associatedRooms) {
    await withDistributedLock(`lock:room:${roomId}`, async () => {
      const room = await Room.findById(roomId);
      if (!room) return;
      room.members = (room.members || []).filter((memberId) => !sameId(memberId, user._id));
      room.participantIds = (room.participantIds || []).filter((participantId) => !sameId(participantId, user._id));
      if (sameId(room.host, user._id)) room.host = room.members[0] || null;
      if (room.status === 'active' && room.members.length === 0) {
        room.status = 'closed';
        room.closedAt = room.closedAt || new Date();
      }
      await room.save();
    });
  }

  await Promise.all([
    ChatMessage.deleteMany({ senderId: user._id }),
    Session.deleteMany({ userId: user._id }),
    StudyNote.deleteMany({ userId: user._id }),
    Flashcard.deleteMany({ userId: user._id }),
    PlannerTask.deleteMany({ userId: user._id }),
    StudyRequest.deleteMany({ $or: [{ fromUserId: user._id }, { toUserId: user._id }] })
  ]);

  await Promise.all([
    revokeAllRefreshTokens(user._id),
    revokeAllPasswordResetTokens(user._id)
  ]);

  // End every open socket before removing the user record. The Redis adapter
  // makes this apply to connected tabs on other API instances as well.
  getSocketServer().in(userSocketRoom(id)).disconnectSockets(true);
  const presence = await removeUserPresence(id);
  if (presence.wasOnline) publishPresence(id, false);

  const deleted = await User.deleteOne({ _id: user._id });
  if (deleted.deletedCount !== 1) throw new AppError(500, 'ACCOUNT_DELETE_FAILED', 'The account could not be deleted');

  return { deleted: true };
}
