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
    message: 'Genrey Jarina submitted a request for ₱111',
  }, request), {
    title: 'New In-House request: Genrey Jarina',
    message: 'Requested ₱111.',
  });
});

test('status update copy explains the marked status without losing the author note', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Update: [DENIED]',
    message: 'Maria Santos: Missing supporting document.',
  }, request), {
    title: "Genrey Jarina's Request Update",
    message: 'Denied • Maria Santos: Missing supporting document.',
  });
});

test('stopped request copy keeps the reason without repeating the actor', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Request Stopped',
    message: 'Maria Santos stopped progress: Missing supporting document.',
  }, request), {
    title: "Genrey Jarina's Request Update",
    message: 'Progress stopped • Missing supporting document.',
  });
});

test('resumed request copy uses only the action', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Request Resumed',
    message: 'Maria Santos resumed progress.',
  }, request), {
    title: "Genrey Jarina's Request Update",
    message: 'Progress resumed',
  });
});

test('reopened request copy uses only the action', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'status_update',
    title: 'Genrey Jarina · Request Reopened',
    message: 'The completed request for Genrey Jarina was returned to In Progress.',
  }, request), {
    title: "Genrey Jarina's Request Update",
    message: 'Request reopened',
  });
});

test('historical resolution copy removes the vague duplicated legacy message', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'denied',
    title: 'Genrey Jarina · Request Denied',
    message: 'The request for Genrey Jarina was resolved as denied.',
  }, request), {
    title: "Genrey Jarina's Request Denied",
    message: '',
  });
});

test('inactivity copy keeps the live elapsed-day wording', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'inactivity_reminder',
    title: 'Request Inactivity Reminder',
    message: 'old reminder text',
  }, request, 'No progress for 10 days.'), {
    title: "Genrey Jarina's Request",
    message: 'No progress for 10 days.',
  });
});

test('current resolution copy keeps the actor detail under the requestor-first title', () => {
  assert.deepEqual(formatRequestNotification({
    type: 'completed',
    title: 'Genrey Jarina · Request Completed',
    message: 'Resolved by Maria Santos.',
  }, request), {
    title: "Genrey Jarina's Request Completed",
    message: 'Resolved by Maria Santos.',
  });
});
