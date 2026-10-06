import { Router } from 'express';
import { getMe, getUser, listUsers, updateMe } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/', listUsers);
router.get('/:userId', getUser);

export default router;
