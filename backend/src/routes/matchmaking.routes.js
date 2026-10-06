import { Router } from 'express';
import { cancel, findBuddy, status } from '../controllers/matchmaking.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();
router.use(requireAuth);
router.post('/', rateLimit({ name: 'matchmaking', limit: 10, windowSeconds: 60, key: (req) => req.auth.userId }), findBuddy);
router.get('/', status);
router.delete('/', cancel);

export default router;
