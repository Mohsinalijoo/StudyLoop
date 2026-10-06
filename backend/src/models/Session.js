import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joinedAt: { type: Date, required: true, default: Date.now },
  leftAt: { type: Date, default: null, index: true },
  durationSeconds: { type: Number, default: 0, min: 0 },
  source: { type: String, enum: ['api', 'socket', 'matchmaking'], default: 'api' }
}, { timestamps: true });

sessionSchema.index({ userId: 1, joinedAt: -1 });
sessionSchema.index({ roomId: 1, userId: 1, leftAt: 1 });

export const Session = mongoose.model('Session', sessionSchema);
