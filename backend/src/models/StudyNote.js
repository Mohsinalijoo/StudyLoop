import mongoose from 'mongoose';

const studyNoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  body: { type: String, default: '', maxlength: 500, trim: true }
}, { timestamps: true });

export const StudyNote = mongoose.model('StudyNote', studyNoteSchema);
