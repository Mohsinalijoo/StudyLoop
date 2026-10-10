import { StudyNote } from '../models/StudyNote.js';
import { Flashcard } from '../models/Flashcard.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireObjectId, requireString } from '../utils/validation.js';

function noteDto(note) {
  return note ? { id: String(note._id), body: note.body || '', updatedAt: note.updatedAt || null } : { id: null, body: '', updatedAt: null };
}

function flashcardDto(card) {
  return {
    id: String(card._id),
    topic: card.topic || 'General',
    front: card.front,
    back: card.back,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

export const getNote = asyncHandler(async (req, res) => {
  const note = await StudyNote.findOne({ userId: req.auth.userId }).lean();
  res.json({ data: { note: noteDto(note) } });
});

export const saveNote = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (typeof body.body !== 'string' || body.body.length > 500) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Note body must be a string of at most 500 characters');
  }
  const note = await StudyNote.findOneAndUpdate(
    { userId: req.auth.userId },
    { $set: { body: body.body } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  res.json({ data: { note: noteDto(note) } });
});

export const listFlashcards = asyncHandler(async (req, res) => {
  const cards = await Flashcard.find({ userId: req.auth.userId }).sort({ updatedAt: -1 }).lean();
  res.json({ data: cards.map(flashcardDto) });
});

export const createFlashcard = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const topic = body.topic === undefined ? 'General' : requireString(body.topic, 'topic', { min: 1, max: 60 });
  const front = requireString(body.front, 'front', { min: 1, max: 500 });
  const back = requireString(body.back, 'back', { min: 1, max: 1000 });
  const card = await Flashcard.create({ userId: req.auth.userId, topic, front, back });
  res.status(201).json({ data: { flashcard: flashcardDto(card) } });
});

export const deleteFlashcard = asyncHandler(async (req, res) => {
  const flashcardId = requireObjectId(req.params.flashcardId, 'flashcardId');
  const card = await Flashcard.findOneAndDelete({ _id: flashcardId, userId: req.auth.userId });
  if (!card) throw new AppError(404, 'FLASHCARD_NOT_FOUND', 'Flashcard not found');
  res.json({ data: { deleted: true, id: String(card._id) } });
});
