import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, index: true },
  passwordHash: { type: String, required: true, select: false },
  subjects: { type: [String], required: true, default: [], validate: [(items) => items.length >= 1 && items.length <= 10, 'Choose 1–10 study fields'] },
  subjectKeys: { type: [String], required: true, default: [], index: true },
  availability: { type: String, enum: ['now', 'later', 'flexible'], default: 'flexible', index: true },
  timezone: { type: String, trim: true, maxlength: 80, default: '' },
  bio: { type: String, trim: true, maxlength: 300, default: '' },
  isDisabled: { type: Boolean, default: false, index: true }
}, {
  timestamps: true,
  toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.subjectKeys; delete ret.__v; return ret; } },
  toObject: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.subjectKeys; delete ret.__v; return ret; } }
});

userSchema.index({ displayName: 'text', bio: 'text', subjects: 'text' });

export const User = mongoose.model('User', userSchema);
