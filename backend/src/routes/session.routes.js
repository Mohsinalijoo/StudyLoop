import { Router } from 'express';
import { mine } from '../controllers/session.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.get('/me', requireAuth, mine);
export default router;
