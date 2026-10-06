import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeSubject, parseLimit, parseSubjects, requireAvailability, requireObjectId, requireString } from '../utils/validation.js';
import { publicUser } from '../utils/serializers.js';
import { isUserOnline, onlineStatuses, onlineUserIds } from '../services/presence.service.js';
import { cancelMatch } from '../services/matchmaking.service.js';

export const getMe = asyncHandler(async (req, res) => {
  res.json({ data: { user: publicUser(req.user, await isUserOnline(req.auth.userId)) } });
});

export const updateMe = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const update = {};
  if (Object.hasOwn(body, 'displayName')) update.displayName = requireString(body.displayName, 'displayName', { min: 2, max: 60 });
  if (Object.hasOwn(body, 'subjects')) {
    const { labels, keys } = parseSubjects(body.subjects);
    update.subjects = labels;
    update.subjectKeys = keys;
  }
  if (Object.hasOwn(body, 'availability')) update.availability = requireAvailability(body.availability);
  if (Object.hasOwn(body, 'timezone')) update.timezone = typeof body.timezone === 'string' ? body.timezone.trim().slice(0, 80) : '';
  if (Object.hasOwn(body, 'bio')) update.bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 300) : '';
  if (!Object.keys(update).length) throw new AppError(400, 'EMPTY_UPDATE', 'Provide at least one editable profile field');
  const user = await User.findByIdAndUpdate(req.auth.userId, { $set: update }, { new: true, runValidators: true });
  if (update.subjectKeys || update.availability) await cancelMatch(req.auth.userId);
  res.json({ data: { user: publicUser(user, await isUserOnline(req.auth.userId)) } });
});

export const listUsers = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 20, 100);
  const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 10000);
  const filter = { _id: { $ne: req.auth.userId }, isDisabled: false };
  if (req.query.subject) {
    const subjectKey = normalizeSubject(requireString(req.query.subject, 'subject', { min: 2, max: 80 }));
    if (!subjectKey) throw new AppError(400, 'INVALID_SUBJECT', 'A valid subject is required');
    filter.subjectKeys = subjectKey;
  }
  if (req.query.availability) filter.availability = requireAvailability(req.query.availability);
  if (req.query.q) {
    const query = requireString(req.query.q, 'q', { min: 1, max: 80 });
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ displayName: new RegExp(escaped, 'i') }, { subjects: new RegExp(escaped, 'i') }, { bio: new RegExp(escaped, 'i') }];
  }
  if (req.query.online !== undefined) {
    if (req.query.online !== 'true') throw new AppError(400, 'VALIDATION_ERROR', 'online only accepts true when supplied');
    const onlineIds = await onlineUserIds();
    if (!onlineIds.length) return res.json({ data: [], pagination: { page, limit, returned: 0 } });
    filter._id = { ...filter._id, $in: onlineIds };
  }
  const users = await User.find(filter).select('displayName subjects availability timezone bio')
    .sort({ displayName: 1 }).skip((page - 1) * limit).limit(limit).lean();
  const statuses = await onlineStatuses(users.map((user) => String(user._id)));
  let data = users.map((user) => publicUser(user, statuses.get(String(user._id))));
  if (req.query.online === 'true') data = data.filter((user) => user.online);
  res.json({ data, pagination: { page, limit, returned: data.length } });
});

export const getUser = asyncHandler(async (req, res) => {
  const userId = requireObjectId(req.params.userId, 'userId');
  if (userId === req.auth.userId) return res.json({ data: { user: publicUser(req.user, await isUserOnline(userId)) } });
  const user = await User.findOne({ _id: userId, isDisabled: false }).select('displayName subjects availability timezone bio');
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Student not found');
  res.json({ data: { user: publicUser(user, await isUserOnline(userId)) } });
});
