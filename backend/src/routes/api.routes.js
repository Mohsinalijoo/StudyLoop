import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import roomRoutes from './room.routes.js';
import matchmakingRoutes from './matchmaking.routes.js';
import sessionRoutes from './session.routes.js';
import studyToolsRoutes from './study-tools.routes.js';
import studyRequestRoutes from './study-request.routes.js';
import plannerRoutes from './planner.routes.js';
import statsRoutes from './stats.routes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/rooms', roomRoutes);
router.use('/matchmaking', matchmakingRoutes);
router.use('/sessions', sessionRoutes);
router.use('/study-tools', studyToolsRoutes);
router.use('/study-requests', studyRequestRoutes);
router.use('/planner', plannerRoutes);
router.use('/stats', statsRoutes);

export default router;
