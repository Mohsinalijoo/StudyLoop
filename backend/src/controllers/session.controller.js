import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/validation.js';
import { listUserSessions } from '../services/session.service.js';

export const mine = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 100);
  res.json({ data: await listUserSessions(req.auth.userId, limit) });
});
