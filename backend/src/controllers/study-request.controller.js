import { asyncHandler } from '../utils/asyncHandler.js';
import { requireObjectId, requireString } from '../utils/validation.js';
import {
  cancelStudyRequest,
  createDirectStudyRequest,
  createRoomJoinRequest,
  listStudyRequests,
  respondToStudyRequest
} from '../services/study-request.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await listStudyRequests(req.auth.userId);
  res.json({ data: result });
});

export const sendDirect = asyncHandler(async (req, res) => {
  const toUserId = requireObjectId(req.body?.toUserId, 'toUserId');
  const subject = req.body?.subject === undefined
    ? req.user.subjects[0]
    : requireString(req.body.subject, 'subject', { min: 2, max: 80 });
  const result = await createDirectStudyRequest({ fromUser: req.user, toUserId, subject });
  res.status(result.alreadyPending ? 200 : 201).json({ data: result });
});

export const sendRoomRequest = asyncHandler(async (req, res) => {
  const roomId = requireObjectId(req.params.roomId, 'roomId');
  const result = await createRoomJoinRequest({ fromUser: req.user, roomId });
  res.status(result.alreadyPending ? 200 : 201).json({ data: result });
});

export const accept = asyncHandler(async (req, res) => {
  const requestId = requireObjectId(req.params.requestId, 'requestId');
  const result = await respondToStudyRequest({ requestId, actorId: req.auth.userId, action: 'accept' });
  res.json({ data: result });
});

export const decline = asyncHandler(async (req, res) => {
  const requestId = requireObjectId(req.params.requestId, 'requestId');
  const result = await respondToStudyRequest({ requestId, actorId: req.auth.userId, action: 'decline' });
  res.json({ data: result });
});

export const cancel = asyncHandler(async (req, res) => {
  const requestId = requireObjectId(req.params.requestId, 'requestId');
  const result = await cancelStudyRequest({ requestId, actorId: req.auth.userId });
  res.json({ data: result });
});
