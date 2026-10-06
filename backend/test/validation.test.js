import test from 'node:test';
import assert from 'node:assert/strict';
import { isObjectId, normalizeSubject, parseSubjects, requireAvailability } from '../src/utils/validation.js';
import { AppError } from '../src/utils/AppError.js';

test('normalizes subject labels consistently for matching', () => {
  assert.equal(normalizeSubject('  Computer Science  '), 'computer-science');
  assert.equal(normalizeSubject('Data & AI'), 'data-ai');
  assert.equal(normalizeSubject('Café Studies'), 'cafe-studies');
});

test('parses and deduplicates profile subject labels', () => {
  assert.deepEqual(parseSubjects(['Computer science', 'Mathematics']), {
    labels: ['Computer science', 'Mathematics'],
    keys: ['computer-science', 'mathematics']
  });
  assert.throws(() => parseSubjects([]), (error) => error instanceof AppError && error.statusCode === 400);
});

test('availability accepts only supported matchmaking values', () => {
  assert.equal(requireAvailability('flexible'), 'flexible');
  assert.throws(() => requireAvailability('available-now'), (error) => error instanceof AppError && error.code === 'VALIDATION_ERROR');
});

test('ObjectId validation requires a 24-character hexadecimal value', () => {
  assert.equal(isObjectId('507f1f77bcf86cd799439011'), true);
  assert.equal(isObjectId('not-an-object-id'), false);
  assert.equal(isObjectId('507f1f77bcf86cd79943901z'), false);
});
