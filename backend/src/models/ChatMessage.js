import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  senderName: { type: String, required: true, maxlength: 60 },
  body: { type: String, required: true, minlength: 1, maxlength: 2000 },
  clientMessageId: { type: String, required: true, maxlength: 80 }
}, { timestamps: { createdAt: true, updatedAt: false } });

chatMessageSchema.index({ roomId: 1, createdAt: -1 });
chatMessageSchema.index({ roomId: 1, senderId: 1, clientMessageId: 1 }, { unique: true });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
