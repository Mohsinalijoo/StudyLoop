import { asyncHandler } from '../utils/asyncHandler.js';
import { getStudyLeaderboard } from '../services/leaderboard.service.js';

export const leaderboard = asyncHandler(async (_req, res) => {
  const entries = await getStudyLeaderboard(5);
  res.json({ data: entries });
});
