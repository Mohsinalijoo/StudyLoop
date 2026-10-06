import mongoose from 'mongoose';
import { AppError } from './AppError.js';

export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export function requireObjectId(value, label = 'id') {
  if (!isObjectId(value) || !mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(400, 'INVALID_ID', `A valid ${label} is required`);
  }
  return value;
}

export function requireString(value, label, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== 'string') throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a string`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be between ${min} and ${max} characters`);
  }
  return normalized;
}

export function normalizeSubject(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export function parseSubjects(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new AppError(400, 'VALIDATION_ERROR', 'subjects must contain between 1 and 10 study fields');
  }
  const labels = [...new Set(value.map((item) => requireString(item, 'subject', { min: 2, max: 80 })))];
  return { labels, keys: labels.map(normalizeSubject) };
}

export function requireAvailability(value) {
  const allowed = ['now', 'later', 'flexible'];
  if (!allowed.includes(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `availability must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function parseLimit(value, fallback = 20, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
