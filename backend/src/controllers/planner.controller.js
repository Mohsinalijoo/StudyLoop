import { PlannerTask } from '../models/PlannerTask.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireObjectId, requireString } from '../utils/validation.js';

function dateKey(value, label = 'date') {
  const key = requireString(value, label, { min: 10, max: 10 });
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} is not a valid calendar date`);
  }
  return key;
}

function taskDto(task) {
  return {
    id: String(task._id),
    title: task.title,
    details: task.details || '',
    date: task.date,
    startTime: task.startTime || '',
    reminderAt: task.reminderAt || null,
    completed: Boolean(task.completed),
    completedAt: task.completedAt || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function optionalTime(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'startTime must use 24-hour HH:MM format');
  }
  return value;
}

function optionalReminder(value) {
  if (value === undefined || value === null || value === '') return null;
  const reminderAt = new Date(value);
  if (Number.isNaN(reminderAt.getTime())) throw new AppError(400, 'VALIDATION_ERROR', 'reminderAt must be a valid date and time');
  return reminderAt;
}

export const listTasks = asyncHandler(async (req, res) => {
  const from = dateKey(req.query.from, 'from');
  const to = dateKey(req.query.to, 'to');
  if (from > to) throw new AppError(400, 'INVALID_DATE_RANGE', 'The start date must be before the end date');
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (spanDays > 62) throw new AppError(400, 'DATE_RANGE_TOO_LARGE', 'Request no more than 63 calendar days at a time');
  const tasks = await PlannerTask.find({ userId: req.auth.userId, date: { $gte: from, $lte: to } })
    .sort({ date: 1, startTime: 1, createdAt: 1 }).lean();
  res.json({ data: tasks.map(taskDto) });
});

export const createTask = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const task = await PlannerTask.create({
    userId: req.auth.userId,
    title: requireString(body.title, 'title', { min: 1, max: 120 }),
    details: typeof body.details === 'string' ? body.details.trim().slice(0, 300) : '',
    date: dateKey(body.date),
    startTime: optionalTime(body.startTime),
    reminderAt: optionalReminder(body.reminderAt)
  });
  res.status(201).json({ data: { task: taskDto(task) } });
});

export const updateTask = asyncHandler(async (req, res) => {
  const taskId = requireObjectId(req.params.taskId, 'taskId');
  if (typeof req.body?.completed !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'completed must be a boolean');
  }
  const update = {
    completed: req.body.completed,
    completedAt: req.body.completed ? new Date() : null
  };
  const task = await PlannerTask.findOneAndUpdate(
    { _id: taskId, userId: req.auth.userId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!task) throw new AppError(404, 'PLANNER_TASK_NOT_FOUND', 'Planner task not found');
  res.json({ data: { task: taskDto(task) } });
});

export const deleteTask = asyncHandler(async (req, res) => {
  const taskId = requireObjectId(req.params.taskId, 'taskId');
  const task = await PlannerTask.findOneAndDelete({ _id: taskId, userId: req.auth.userId });
  if (!task) throw new AppError(404, 'PLANNER_TASK_NOT_FOUND', 'Planner task not found');
  res.json({ data: { deleted: true, id: String(task._id) } });
});
