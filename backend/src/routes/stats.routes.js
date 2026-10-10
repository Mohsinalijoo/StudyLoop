import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { leaderboard } from '../controllers/stats.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/leaderboard', leaderboard);

export default router;
