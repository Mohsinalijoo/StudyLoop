import mongoose from 'mongoose';

const flashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  topic: { type: String, required: true, trim: true, maxlength: 60, default: 'General' },
  front: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  back: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 }
}, { timestamps: true });

flashcardSchema.index({ userId: 1, topic: 1, updatedAt: -1 });

export const Flashcard = mongoose.model('Flashcard', flashcardSchema);
