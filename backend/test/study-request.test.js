import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyRequest } from '../src/models/StudyRequest.js';

const validBase = {
  fromUserId: '64b000000000000000000001',
  toUserId: '64b000000000000000000002',
  subject: 'Mathematics',
  expiresAt: new Date(Date.now() + 60_000),
  purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
};

test('valid direct and room study requests pass model validation', async () => {
  await assert.doesNotReject(new StudyRequest({ ...validBase, kind: 'direct' }).validate());
  await assert.doesNotReject(new StudyRequest({
    ...validBase,
    kind: 'room',
    roomId: '64b000000000000000000003'
  }).validate());
});

test('room requests require a room and direct requests cannot target one', async () => {
  await assert.rejects(new StudyRequest({ ...validBase, kind: 'room' }).validate(), /roomId/);
  await assert.rejects(new StudyRequest({
    ...validBase,
    kind: 'direct',
    roomId: '64b000000000000000000003'
  }).validate(), /roomId/);
});

test('accepted requests must point to the resulting room', async () => {
  await assert.rejects(new StudyRequest({
    ...validBase,
    kind: 'direct',
    status: 'accepted'
  }).validate(), /resultRoomId/);
  await assert.doesNotReject(new StudyRequest({
    ...validBase,
    kind: 'direct',
    status: 'accepted',
    resultRoomId: '64b000000000000000000003'
  }).validate());
});
