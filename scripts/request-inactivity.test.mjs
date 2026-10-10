import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, requestInactivity, validInactivityDays, inactivityMessage } from '../src/lib/request-inactivity.ts';
const now = new Date('2026-10-10T00:00:00Z');
const ago = (days) => new Date(now.getTime() - days * DAY_MS);
const request = { id: 42, capdevId: 5, status: 'in_progress', createdAt: ago(10), archivedAt: null };

test('threshold uses full elapsed days from the latest activity', () => {
  assert.equal(requestInactivity(request, { id: 8, createdAt: ago(2.99) }, 3, { now }), null);
  const info = requestInactivity(request, { id: 8, createdAt: ago(3) }, 3, { now });
  assert.equal(info.days, 3);
  assert.equal(info.latestUpdateId, 8);
  assert.equal(info.reminderKey, 'request:42:update:8');
  assert.equal(info.link, '/portal/capdev/5/requests/42/status?reminder=1#request-status-update-8');
  assert.equal(info.dueAt.getTime(), now.getTime());
});
test('new progress resets the reminder and creates a new episode identity', () => {
  const before = requestInactivity(request, { id: 8, createdAt: ago(4) }, 3, { now });
  assert.equal(requestInactivity(request, { id: 9, createdAt: now }, 3, { now }), null);
  const after = requestInactivity(request, { id: 9, createdAt: ago(4) }, 3, { now });
  assert.notEqual(after.reminderKey, before.reminderKey);
});
test('requests without updates link to their submission record', () => {
  const info = requestInactivity(request, null, 3, { now });
  assert.equal(info.days, 10);
  assert.equal(info.latestUpdateId, null);
  assert.equal(info.reminderKey, 'request:42:submitted');
  assert.ok(info.link.endsWith('#request-status-start'));
});
test('concluded, legacy completed, and archived records do not remind', () => {
  for (const status of ['completed', 'denied']) assert.equal(requestInactivity({ ...request, status }, null, 3, { now }), null);
  assert.equal(requestInactivity({ ...request, archivedAt: now }, null, 3, { now }), null);
  for (const override of [{ parentArchived: true }, { legacyComplete: true }]) assert.equal(requestInactivity(request, null, 3, { now, ...override }), null);
});
test('invalid settings and dates cannot generate reminders', () => {
  for (const value of [0, 366, 1.5, NaN, '3', null]) {
    assert.equal(validInactivityDays(value), false);
    assert.equal(requestInactivity(request, null, value, { now }), null);
  }
  assert.equal(requestInactivity({ ...request, createdAt: 'invalid' }, null, 3, { now }), null);
  assert.equal(requestInactivity({ ...request, createdAt: ago(-1) }, null, 3, { now }), null);
  assert.ok(validInactivityDays(1));
  assert.ok(validInactivityDays(365));
  assert.equal(inactivityMessage(1), 'No progress for 1 day.');
  assert.equal(inactivityMessage(3), 'No progress for 3 days.');
});
