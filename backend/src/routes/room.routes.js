import { Router } from 'express';
import { create, deleteRoom, getOne, join, leave, list, messages } from '../controllers/room.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', list);
router.post('/', create);
router.get('/:roomId/messages', messages);
router.post('/:roomId/join', join);
router.post('/:roomId/leave', leave);
router.delete('/:roomId', deleteRoom);
router.get('/:roomId', getOne);

export default router;
