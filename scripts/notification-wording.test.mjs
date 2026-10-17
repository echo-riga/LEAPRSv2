import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRequestNotification } from '../src/lib/notification-wording.ts';

const request = {
  requestorName: 'Genrey Jarina',
  setting: 'internal',
  requestedBudget: '111.00',
};

test('new request copy identifies the requestor and keeps the amount concise', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'new_request',
    title: 'New Requisition: In-House',
    message: 'Genrey Jarina submitted a request for ₱111.00',
  }, request), {
    title: 'New In-House request: Genrey Jarina',
    message: 'Requested ₱111.00.',
  });
});

test('status update copy explains the marked status without losing the author note', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Update: [DENIED]',
    message: 'Maria Santos: Missing supporting document.',
  }, request), {
    title: "Genrey Jarina's Request Timeline",
    message: 'Update status: Denied • Maria Santos: Missing supporting document.',
  });
});

test('timeline action remains in the detail line', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Request Resumed',
    message: 'Maria Santos resumed progress.',
  }, request), {
    title: "Genrey Jarina's Request Timeline",
    message: 'Progress resumed • Maria Santos resumed progress.',
  });
});

test('historical resolution copy removes the vague duplicated legacy message', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'denied',
    title: 'Genrey Jarina · Request Denied',
    message: 'The request for Genrey Jarina was resolved as denied.',
  }, request), {
    title: 'Request denied: Genrey Jarina',
    message: '',
  });
});

test('inactivity copy keeps the live elapsed-day wording', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'inactivity_reminder',
    title: 'Request Inactivity Reminder',
    message: 'old reminder text',
  }, request, 'No progress for 10 days.'), {
    title: 'No activity: Genrey Jarina',
    message: 'No progress for 10 days.',
  });
});
