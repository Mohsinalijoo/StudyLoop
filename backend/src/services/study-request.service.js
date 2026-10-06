import mongoose from 'mongoose';
import { StudyRequest } from '../models/StudyRequest.js';
import { User } from '../models/User.js';
import { Room } from '../models/Room.js';
import { Session } from '../models/Session.js';
import { AppError } from '../utils/AppError.js';
import { normalizeSubject } from '../utils/validation.js';
import { withDistributedLock } from './distributedLock.js';
import { cacheRoomMember } from './presence.room-cache.js';
import { attachUserSocketsToRoom, publishRoomJoin, publishStudyRequestReceived, publishStudyRequestUpdated } from '../sockets/publishers.js';
import { roomDto, publicUser } from '../utils/serializers.js';

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_LIMIT = 50;

const sameId = (left, right) => String(left?._id ?? left) === String(right?._id ?? right);
const expireAt = (milliseconds) => new Date(Date.now() + milliseconds);

function populatedRequestQuery(query) {
  const roomPopulation = {
    path: 'roomId',
    select: 'title subject goal type capacity members host status createdAt',
    populate: { path: 'members', select: 'displayName subjects availability' }
  };
  const resultRoomPopulation = {
    path: 'resultRoomId',
    select: 'title subject goal type capacity members host status createdAt',
    populate: { path: 'members', select: 'displayName subjects availability' }
  };
  return query
    .populate('fromUserId', 'displayName subjects availability timezone bio')
    .populate('toUserId', 'displayName subjects availability timezone bio')
    .populate(roomPopulation)
    .populate(resultRoomPopulation);
}

function requestDto(request) {
  if (!request) return null;
  const fromUser = request.fromUserId?._id ? publicUser(request.fromUserId) : null;
  const toUser = request.toUserId?._id ? publicUser(request.toUserId) : null;
  const room = request.roomId?._id ? roomDto(request.roomId) : null;
  const resultRoom = request.resultRoomId?._id ? roomDto(request.resultRoomId) : null;
  return {
    id: String(request._id),
    kind: request.kind,
    fromUser,
    toUser,
    room,
    roomId: request.roomId?._id ? String(request.roomId._id) : request.roomId ? String(request.roomId) : null,
    subject: request.subject,
    status: request.status,
    resultRoom,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    respondedAt: request.respondedAt || null
  };
}

async function getPopulatedRequest(requestId) {
  const doc = await populatedRequestQuery(StudyRequest.findById(requestId)).lean();
  return requestDto(doc);
}

async function notifyRequestParties(request) {
  const dto = await getPopulatedRequest(request._id || request.id);
  if (dto) publishStudyRequestUpdated([dto.fromUser?.id, dto.toUser?.id].filter(Boolean), dto);
  return dto;
}

async function expireUserRequests(userId) {
  const now = new Date();
  await StudyRequest.updateMany({
    $or: [{ fromUserId: userId }, { toUserId: userId }],
    status: 'pending',
    expiresAt: { $lte: now }
  }, { $set: { status: 'expired', respondedAt: now } });
}

export async function createDirectStudyRequest({ fromUser, toUserId, subject }) {
  if (sameId(fromUser._id, toUserId)) throw new AppError(400, 'SELF_STUDY_REQUEST', 'You cannot send a study request to yourself');
  const recipient = await User.findOne({ _id: toUserId, isDisabled: false }).select('_id');
  if (!recipient) throw new AppError(404, 'STUDENT_NOT_FOUND', 'That Studyloop student could not be found');

  const pairKey = [String(fromUser._id), String(toUserId)].sort().join(':');
  const result = await withDistributedLock(`lock:study-request:direct:${pairKey}`, async () => {
    const now = new Date();
    await StudyRequest.updateMany({
      kind: 'direct',
      fromUserId: fromUser._id,
      toUserId,
      status: 'pending',
      expiresAt: { $lte: now }
    }, { $set: { status: 'expired', respondedAt: now } });
    await StudyRequest.updateMany({
      kind: 'direct',
      fromUserId: toUserId,
      toUserId: fromUser._id,
      status: 'pending',
      expiresAt: { $lte: now }
    }, { $set: { status: 'expired', respondedAt: now } });

    const reversePending = await StudyRequest.findOne({
      kind: 'direct', fromUserId: toUserId, toUserId: fromUser._id,
      status: 'pending', expiresAt: { $gt: now }
    }).select('_id');
    if (reversePending) {
      throw new AppError(409, 'STUDY_REQUEST_ALREADY_RECEIVED', 'This student has already sent you a request. Respond to it in your requests inbox.');
    }

    const existing = await StudyRequest.findOne({
      kind: 'direct', fromUserId: fromUser._id, toUserId,
      status: 'pending', expiresAt: { $gt: now }
    });
    if (existing) return { requestId: existing._id, created: false };

    const request = await StudyRequest.create({
      kind: 'direct',
      fromUserId: fromUser._id,
      toUserId,
      subject,
      status: 'pending',
      expiresAt: expireAt(REQUEST_TTL_MS),
      purgeAt: expireAt(HISTORY_TTL_MS)
    });
    return { requestId: request._id, created: true };
  });

  const dto = await getPopulatedRequest(result.requestId);
  if (result.created && dto) publishStudyRequestReceived(String(toUserId), dto);
  return { request: dto, alreadyPending: !result.created };
}

export async function createRoomJoinRequest({ fromUser, roomId }) {
  const result = await withDistributedLock(`lock:study-request:room:${roomId}:${fromUser._id}`, async () => {
    const now = new Date();
    await StudyRequest.updateMany({
      kind: 'room', fromUserId: fromUser._id, roomId,
      status: 'pending', expiresAt: { $lte: now }
    }, { $set: { status: 'expired', respondedAt: now } });

    const room = await Room.findOne({ _id: roomId, status: 'active', type: 'group' });
    if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'Active group room not found');
    if (sameId(room.host, fromUser._id)) throw new AppError(400, 'ROOM_OWNER_REQUEST', 'You own this room and do not need to request access');
    if (room.members.some((memberId) => sameId(memberId, fromUser._id))) {
      throw new AppError(409, 'ALREADY_ROOM_MEMBER', 'You are already a member of this room');
    }
    if (room.members.length >= room.capacity) throw new AppError(409, 'ROOM_FULL', 'This room has reached its participant limit');

    const existing = await StudyRequest.findOne({
      kind: 'room', fromUserId: fromUser._id, roomId,
      status: 'pending', expiresAt: { $gt: now }
    });
    if (existing) return { requestId: existing._id, ownerId: room.host, created: false };

    const request = await StudyRequest.create({
      kind: 'room',
      fromUserId: fromUser._id,
      toUserId: room.host,
      roomId: room._id,
      subject: room.subject,
      status: 'pending',
      expiresAt: expireAt(REQUEST_TTL_MS),
      purgeAt: expireAt(HISTORY_TTL_MS)
    });
    return { requestId: request._id, ownerId: room.host, created: true };
  });

  const dto = await getPopulatedRequest(result.requestId);
  if (result.created && dto) publishStudyRequestReceived(String(result.ownerId), dto);
  return { request: dto, alreadyPending: !result.created };
}

export async function listStudyRequests(userId) {
  await expireUserRequests(userId);
  const now = new Date();
  const incomingQuery = StudyRequest.find({
    toUserId: userId,
    status: 'pending',
    expiresAt: { $gt: now }
  }).sort({ createdAt: -1 }).limit(REQUEST_LIMIT);
  const outgoingQuery = StudyRequest.find({
    fromUserId: userId,
    status: { $in: ['pending', 'accepted', 'declined', 'expired'] },
    purgeAt: { $gt: now }
  }).sort({ createdAt: -1 }).limit(REQUEST_LIMIT);
  const [incomingDocs, outgoingDocs] = await Promise.all([
    populatedRequestQuery(incomingQuery).lean(),
    populatedRequestQuery(outgoingQuery).lean()
  ]);
  return {
    incoming: incomingDocs.map(requestDto),
    outgoing: outgoingDocs.map(requestDto)
  };
}

async function acceptDirectRequest(requestId, actorId) {
  const mongoSession = await mongoose.startSession();
  let accepted;
  try {
    await mongoSession.withTransaction(async () => {
      const now = new Date();
      const request = await StudyRequest.findOne({
        _id: requestId,
        kind: 'direct',
        toUserId: actorId,
        status: 'pending',
        expiresAt: { $gt: now }
      }).session(mongoSession);
      if (!request) throw new AppError(409, 'STUDY_REQUEST_NOT_PENDING', 'This study request is no longer pending');

      const users = await User.find({
        _id: { $in: [request.fromUserId, request.toUserId] },
        isDisabled: false
      }).session(mongoSession);
      const requester = users.find((user) => sameId(user._id, request.fromUserId));
      const recipient = users.find((user) => sameId(user._id, request.toUserId));
      if (!requester || !recipient) throw new AppError(404, 'STUDENT_NOT_FOUND', 'One of the students is no longer available');

      const roomId = new mongoose.Types.ObjectId();
      const joinedAt = new Date();
      const subject = request.subject || requester.subjects?.[0] || recipient.subjects?.[0] || 'General study';
      const subjectKey = normalizeSubject(subject) || 'general-study';
      const title = `1:1 ${subject} study session`.slice(0, 80);
      const [room] = await Room.create([{
        _id: roomId,
        title,
        subject,
        subjectKey,
        type: 'pair',
        capacity: 2,
        host: recipient._id,
        members: [recipient._id, requester._id],
        participantIds: [recipient._id, requester._id],
        status: 'active'
      }], { session: mongoSession });
      await Session.create([
        { roomId, userId: recipient._id, joinedAt, source: 'request' },
        { roomId, userId: requester._id, joinedAt, source: 'request' }
      ], { session: mongoSession, ordered: true });

      request.status = 'accepted';
      request.resultRoomId = roomId;
      request.respondedAt = now;
      await request.save({ session: mongoSession });
      accepted = { roomId, requester, recipient };
    });
  } finally {
    await mongoSession.endSession();
  }

  await Promise.all([
    cacheRoomMember(accepted.roomId, accepted.recipient._id),
    cacheRoomMember(accepted.roomId, accepted.requester._id)
  ]);
  await Promise.all([
    attachUserSocketsToRoom(accepted.recipient._id, accepted.roomId),
    attachUserSocketsToRoom(accepted.requester._id, accepted.roomId)
  ]);
  const resultRoom = await Room.findById(accepted.roomId)
    .populate('members', 'displayName subjects availability').lean();
  const dto = await notifyRequestParties({ _id: requestId });
  return { request: dto, resultRoom: roomDto(resultRoom) };
}

async function acceptRoomJoinRequest(request, actorId) {
  const mongoSession = await mongoose.startSession();
  let accepted;
  try {
    accepted = await withDistributedLock(`lock:room:${request.roomId}`, async () => {
      let transactionResult;
      await mongoSession.withTransaction(async () => {
        const now = new Date();
        const freshRequest = await StudyRequest.findOne({
          _id: request._id,
          kind: 'room',
          toUserId: actorId,
          status: 'pending',
          expiresAt: { $gt: now }
        }).session(mongoSession);
        if (!freshRequest) throw new AppError(409, 'STUDY_REQUEST_NOT_PENDING', 'This study request is no longer pending');

        const room = await Room.findOne({ _id: freshRequest.roomId, status: 'active', type: 'group' }).session(mongoSession);
        if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'This room is no longer active');
        if (!sameId(room.host, actorId)) throw new AppError(403, 'ROOM_OWNER_REQUIRED', 'Only the room owner can approve join requests');
        const requester = await User.findOne({ _id: freshRequest.fromUserId, isDisabled: false }).session(mongoSession);
        if (!requester) throw new AppError(404, 'STUDENT_NOT_FOUND', 'The requesting student is no longer available');

        const alreadyMember = room.members.some((memberId) => sameId(memberId, requester._id));
        if (!alreadyMember) {
          if (room.members.length >= room.capacity) throw new AppError(409, 'ROOM_FULL', 'This room has reached its participant limit');
          room.members.addToSet(requester._id);
          room.participantIds.addToSet(requester._id);
          await room.save({ session: mongoSession });
        }

        let activeSession = await Session.findOne({ roomId: room._id, userId: requester._id, leftAt: null })
          .sort({ joinedAt: -1 }).session(mongoSession);
        if (!activeSession) {
          const [createdSession] = await Session.create([{
            roomId: room._id,
            userId: requester._id,
            joinedAt: new Date(),
            source: 'request'
          }], { session: mongoSession });
          activeSession = createdSession;
        }

        freshRequest.status = 'accepted';
        freshRequest.resultRoomId = room._id;
        freshRequest.respondedAt = now;
        await freshRequest.save({ session: mongoSession });
        transactionResult = { roomId: room._id, requester, room, activeSession, joined: !alreadyMember };
      });
      return transactionResult;
    });
  } finally {
    await mongoSession.endSession();
  }

  await cacheRoomMember(accepted.roomId, accepted.requester._id);
  await attachUserSocketsToRoom(accepted.requester._id, accepted.roomId);
  if (accepted.joined) {
    publishRoomJoin({
      roomId: accepted.roomId,
      user: publicUser(accepted.requester),
      session: accepted.activeSession,
      room: accepted.room
    });
  }
  const dto = await notifyRequestParties({ _id: request._id });
  const resultRoom = await Room.findById(accepted.roomId)
    .populate('members', 'displayName subjects availability').lean();
  return { request: dto, resultRoom: roomDto(resultRoom) };
}

export async function respondToStudyRequest({ requestId, actorId, action }) {
  return withDistributedLock(`lock:study-request:${requestId}`, async () => {
    const request = await StudyRequest.findById(requestId);
    if (!request) throw new AppError(404, 'STUDY_REQUEST_NOT_FOUND', 'Study request not found');
    if (!sameId(request.toUserId, actorId)) {
      throw new AppError(403, 'STUDY_REQUEST_RECIPIENT_REQUIRED', 'Only the invited student can respond to this request');
    }
    if (request.status !== 'pending') throw new AppError(409, 'STUDY_REQUEST_NOT_PENDING', 'This study request is no longer pending');
    if (request.expiresAt <= new Date()) {
      request.status = 'expired';
      request.respondedAt = new Date();
      await request.save();
      await notifyRequestParties(request);
      throw new AppError(409, 'STUDY_REQUEST_EXPIRED', 'This study request has expired');
    }

    if (action === 'decline') {
      request.status = 'declined';
      request.respondedAt = new Date();
      await request.save();
      const dto = await notifyRequestParties(request);
      return { request: dto, resultRoom: null };
    }
    if (action !== 'accept') throw new AppError(400, 'INVALID_REQUEST_ACTION', 'Choose accept or decline');

    if (request.kind === 'direct') return acceptDirectRequest(request._id, actorId);
    if (request.kind === 'room') return acceptRoomJoinRequest(request, actorId);
    throw new AppError(400, 'INVALID_REQUEST_TYPE', 'This study request has an unsupported type');
  });
}

export async function cancelStudyRequest({ requestId, actorId }) {
  return withDistributedLock(`lock:study-request:${requestId}`, async () => {
    const request = await StudyRequest.findById(requestId);
    if (!request) throw new AppError(404, 'STUDY_REQUEST_NOT_FOUND', 'Study request not found');
    if (!sameId(request.fromUserId, actorId)) {
      throw new AppError(403, 'STUDY_REQUEST_SENDER_REQUIRED', 'Only the student who sent this request can cancel it');
    }
    if (request.status !== 'pending') throw new AppError(409, 'STUDY_REQUEST_NOT_PENDING', 'This study request is no longer pending');
    request.status = 'cancelled';
    request.respondedAt = new Date();
    await request.save();
    const dto = await notifyRequestParties(request);
    return { request: dto, cancelled: true };
  });
}
