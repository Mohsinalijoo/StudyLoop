import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { accept, cancel, decline, list, sendDirect, sendRoomRequest } from '../controllers/study-request.controller.js';

const router = Router();
router.use(requireAuth);
const sendRequestLimit = rateLimit({
  name: 'study-request-send',
  limit: 8,
  windowSeconds: 60,
  key: (req) => req.auth.userId
});

router.get('/', list);
router.post('/direct', sendRequestLimit, sendDirect);
router.post('/rooms/:roomId', sendRequestLimit, sendRoomRequest);
router.post('/:requestId/accept', accept);
router.post('/:requestId/decline', decline);
router.delete('/:requestId', cancel);

export default router;
