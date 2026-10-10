import mongoose from 'mongoose';

const plannerTaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, match: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  details: { type: String, trim: true, maxlength: 300, default: '' },
  startTime: { type: String, match: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, default: '' },
  reminderAt: { type: Date, default: null },
  completed: { type: Boolean, default: false, index: true },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

plannerTaskSchema.index({ userId: 1, date: 1, startTime: 1 });

export const PlannerTask = mongoose.model('PlannerTask', plannerTaskSchema);
