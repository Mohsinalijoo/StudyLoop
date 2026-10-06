import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { normalizeSubject, requireAvailability, requireString } from '../utils/validation.js';
import { requestMatch, cancelMatch, matchmakingStatus } from '../services/matchmaking.service.js';

export const findBuddy = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.anyField !== undefined && typeof body.anyField !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'anyField must be a boolean');
  }
  const anyField = body.anyField === true;
  const availability = body.availability ? requireAvailability(body.availability) : req.user.availability;
  let subject = 'Any field';
  if (!anyField) {
    const requestedSubject = requireString(body.subject, 'subject', { min: 2, max: 80 });
    const key = normalizeSubject(requestedSubject);
    const label = req.user.subjects.find((item) => normalizeSubject(item) === key);
    if (!label) throw new AppError(400, 'SUBJECT_NOT_IN_PROFILE', 'Select one of the study fields saved on your profile');
    subject = label;
  }
  const result = await requestMatch({ user: req.user, subject, availability, anyField });
  res.status(result.status === 'matched' ? 200 : 202).json({ data: result });
});

export const cancel = asyncHandler(async (req, res) => {
  res.json({ data: await cancelMatch(req.auth.userId) });
});

export const status = asyncHandler(async (req, res) => {
  res.json({ data: await matchmakingStatus(req.auth.userId) });
});
