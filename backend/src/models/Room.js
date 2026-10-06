import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  title: { type: String, trim: true, minlength: 2, maxlength: 80, required: true },
  subject: { type: String, trim: true, maxlength: 80, required: true },
  goal: { type: String, trim: true, default: '', maxlength: 200 },
  subjectKey: { type: String, required: true, index: true },
  type: { type: String, enum: ['pair', 'group'], required: true, index: true },
  capacity: { type: Number, min: 2, max: 4, required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
  closedAt: { type: Date, default: null }
}, { timestamps: true });

roomSchema.index({ status: 1, subjectKey: 1, createdAt: -1 });
roomSchema.index({ members: 1, status: 1 });
roomSchema.index({ participantIds: 1, status: 1 });

export const Room = mongoose.model('Room', roomSchema);
