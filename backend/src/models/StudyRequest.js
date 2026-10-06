import mongoose from 'mongoose';

const studyRequestSchema = new mongoose.Schema({
  kind: { type: String, enum: ['direct', 'room'], required: true, index: true },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null, index: true },
  subject: { type: String, trim: true, required: true, minlength: 2, maxlength: 80 },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'], default: 'pending', index: true },
  resultRoomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  expiresAt: { type: Date, required: true, index: true },
  purgeAt: { type: Date, required: true },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

studyRequestSchema.index({ toUserId: 1, status: 1, createdAt: -1 });
studyRequestSchema.index({ fromUserId: 1, createdAt: -1 });
studyRequestSchema.index(
  { fromUserId: 1, toUserId: 1 },
  { unique: true, partialFilterExpression: { kind: 'direct', status: 'pending' } }
);
studyRequestSchema.index(
  { fromUserId: 1, roomId: 1 },
  { unique: true, partialFilterExpression: { kind: 'room', status: 'pending' } }
);
studyRequestSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

studyRequestSchema.pre('validate', function validateRequestShape() {
  if (this.kind === 'room' && !this.roomId) this.invalidate('roomId', 'Room join requests must reference a room');
  if (this.kind === 'direct' && this.roomId) this.invalidate('roomId', 'Direct study requests cannot reference a room');
  if (this.status === 'accepted' && !this.resultRoomId) this.invalidate('resultRoomId', 'Accepted requests must reference the resulting room');
});

export const StudyRequest = mongoose.model('StudyRequest', studyRequestSchema);
