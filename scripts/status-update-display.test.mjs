import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedStatusValues, showPrimaryStatus, showStandaloneRemarks } from '../src/lib/status-update-display.ts';

const fields = [{ id: 2, name: 'Action' }, { id: 1, name: 'Office' }, { id: 3, name: 'Attachments' }];
test('saved values follow current configuration order, including attachments', () => {
  const info = { 'field:1': 'City Planning', 'field:3': [{ id: 'file1', name: 'test.png' }], 'field:2': 'Signed by' };
  assert.deepEqual(orderedStatusValues(info, fields).map(([key]) => key), ['field:2', 'field:1', 'field:3']);
  assert.deepEqual(orderedStatusValues(info, [...fields].reverse()).map(([key]) => key), ['field:3', 'field:1', 'field:2']);
});
test('canonical values override legacy names and historical fields remain readable', () => {
  assert.deepEqual(orderedStatusValues({ Office: 'Old', 'field:1': 'Current', Retired: 'History' }, fields), [['field:1', 'Current'], ['Retired', 'History']]);
  assert.deepEqual(orderedStatusValues({ Action: 'Signed by', Office: 'Planning' }, fields), [['Action', 'Signed by'], ['Office', 'Planning']]);
});
test('empty values are omitted while zero and false remain visible', () => {
  assert.deepEqual(orderedStatusValues({ empty: '', files: [], missing: null, amount: 0, approved: false }, []), [['amount', 0], ['approved', false]]);
});
test('attachment-only entries never show the generic fallback', () => {
  const values = orderedStatusValues({ 'field:3': [{ id: 'file1', name: 'test.png' }] }, fields);
  assert.equal(showPrimaryStatus('Status updated', values), false);
  assert.equal(showPrimaryStatus('Status updated', []), false);
  assert.equal(showPrimaryStatus('Awaiting signature', values), true);
});
test('configured status and remarks appear once, and stopper reasons remain visible', () => {
  const values = [['field:2', 'Signed by'], ['field:4', 'Reviewed']];
  assert.equal(showPrimaryStatus('Signed by', values), false);
  assert.equal(showStandaloneRemarks('Reviewed', values), false);
  assert.equal(showStandaloneRemarks('Other notes', values), true);
  assert.equal(showPrimaryStatus('Signed by', values, true), true);
});
