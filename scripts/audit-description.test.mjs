import test from 'node:test';
import assert from 'node:assert/strict';
import { auditChanges, describeAudit } from '../src/lib/audit-description.ts';

const request = { action: 'updated', entityType: 'request', entityLabel: 'Request #30' };

test('budget edits describe the requestor and both amounts without database IDs', () => {
  const changes = auditChanges({ requestedBudget: '10000.00' }, { requestedBudget: '15000' }, { requestedBudget: 'Requested budget' });
  const result = describeAudit({ ...request, details: { requestorName: 'Genrey', changes } });
  assert.equal(result.summary, "Changed requested budget for Genrey's request from ₱10,000.00 to ₱15,000.00.");
  assert.doesNotMatch(JSON.stringify(result), /#30/);
});

test('decimal formatting alone is not a budget change', () => {
  assert.deepEqual(auditChanges({ requestedBudget: '10000.00' }, { requestedBudget: '10000' }, { requestedBudget: 'Requested budget' }), []);
});

test('older entries expose available details without inventing previous values', () => {
  const result = describeAudit({ ...request, details: { requestedBudget: '15000' } });
  assert.equal(result.summary, 'Updated the request.');
  assert.ok(result.lines.includes('Previous values were not recorded for this entry.'));
  assert.ok(result.lines.includes('Requested budget: ₱15,000.00'));
});

test('deleted request snapshots retain names and budget restoration', () => {
  const result = describeAudit({ ...request, action: 'deleted', entityLabel: "Genrey's request", details: { restoredBudget: '1200' } });
  assert.equal(result.summary, "Deleted Genrey's request.");
  assert.ok(result.lines.includes('Budget restored: ₱1,200.00'));
});

test('status changes translate stored status values into readable English', () => {
  const result = describeAudit({ ...request, action: 'status_changed', details: { requestorName: 'Genrey', previousStatus: 'in_progress', status: 'completed' } });
  assert.equal(result.summary, "Changed the status of Genrey's request from In progress to Completed.");
});

test('progress updates show the full explanation and deducted amount', () => {
  const text = 'Required documents were received.\nBudget approved for processing.';
  const result = describeAudit({ ...request, action: 'created', entityType: 'status_update', details: { requestorName: 'Genrey', statusUpdate: text, statusMark: 'pending', deductedAmount: '500' } });
  assert.ok(result.lines.includes(`Update: ${text}`));
  assert.ok(result.lines.includes('Amount deducted: ₱500.00'));
});

test('user archive and restore actions are readable', () => {
  const entry = { entityType: 'user', entityLabel: 'Alex Santos', details: { role: 'employee', department: 'CCS' } };
  assert.equal(describeAudit({ ...entry, action: 'archived' }).summary, 'Archived user account for Alex Santos.');
  assert.equal(describeAudit({ ...entry, action: 'restored' }).summary, 'Restored user account for Alex Santos.');
});

test('progress archive, restore, and delete entries describe the actual action', () => {
  for (const [action, verb] of [['archived', 'Archived'], ['restored', 'Restored'], ['deleted', 'Deleted']]) {
    const result = describeAudit({ entityType: 'status_update', entityLabel: "Genrey's request", action, details: { requestorName: 'Genrey', statusUpdate: 'Documents received.' } });
    assert.equal(result.summary, `${verb} a progress update for Genrey's request.`);
  }
});
