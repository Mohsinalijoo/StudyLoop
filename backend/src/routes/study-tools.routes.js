import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createFlashcard, deleteFlashcard, getNote, listFlashcards, saveNote } from '../controllers/study-tools.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/notes/me', getNote);
router.put('/notes/me', saveNote);
router.get('/flashcards', listFlashcards);
router.post('/flashcards', createFlashcard);
router.delete('/flashcards/:flashcardId', deleteFlashcard);

export default router;
