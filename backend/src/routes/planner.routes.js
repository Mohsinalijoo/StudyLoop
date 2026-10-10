import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createTask, deleteTask, listTasks, updateTask } from '../controllers/planner.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/tasks', listTasks);
router.post('/tasks', createTask);
router.patch('/tasks/:taskId', updateTask);
router.delete('/tasks/:taskId', deleteTask);

export default router;
