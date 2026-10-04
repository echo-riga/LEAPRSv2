import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/analytics-metrics.ts', import.meta.url), 'utf8')
  .replace("'@/lib/manila-date'", JSON.stringify(new URL('../src/lib/manila-date.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { summarizeAnalytics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const filters = { departments: ['HR'], capdevIds: [1], dateFrom: '2026-03-01', dateTo: '2026-03-31', snapshotDate: '2026-03-31' };
const data = {
  capdevs: [{ id: 1, aipCode: 'AIP-001', department: 'HR', initialBudget: '1000.00', createdAt: '2026-01-01T00:00:00+08:00' }],
  requests: [{ id: 10, capdevId: 1, requestorName: 'Test User', description: 'Training', setting: 'internal', status: 'completed', isStopped: false, activeStopperId: null, createdAt: '2026-01-15T00:00:00+08:00' }],
  requestEvents: [
    { requestId: 10, createdAt: '2026-02-10T00:00:00+08:00', complete: false, denied: false, stopped: false, resumed: false, deductedAmount: '250.00' },
    { requestId: 10, createdAt: '2026-03-10T00:00:00+08:00', complete: true, denied: false, stopped: false, resumed: false, deductedAmount: null },
  ],
};

test('creation and completion use their own activity dates', () => {
  const result = summarizeAnalytics(data, filters, '2026-10-04');
  assert.equal(result.activityRequests.length, 0);
  assert.equal(result.completedCount, 1);
  assert.equal(result.budgetDeducted, 0);
});

test('status and balances are reconstructed at the selected date', () => {
  const beforeCompletion = summarizeAnalytics(data, { ...filters, snapshotDate: '2026-02-28' }, '2026-10-04');
  assert.equal(beforeCompletion.inProgressCount, 1);
  assert.equal(beforeCompletion.remainingBudget, 750);
  const februaryActivity = summarizeAnalytics(data, { ...filters, dateFrom: '2026-02-01', dateTo: '2026-02-28' }, '2026-10-04');
  assert.equal(februaryActivity.budgetDeducted, 250);
  const afterCompletion = summarizeAnalytics(data, filters, '2026-10-04');
  assert.equal(afterCompletion.inProgressCount, 0);
  assert.equal(afterCompletion.remainingBudget, 750);
});

test('stop and resume events change the historical stopped count', () => {
  const active = { ...data, requests: [{ ...data.requests[0], status: 'in_progress' }], requestEvents: [
    { requestId: 10, createdAt: '2026-02-01T00:00:00+08:00', complete: false, denied: false, stopped: true, resumed: false, deductedAmount: null },
    { requestId: 10, createdAt: '2026-03-15T00:00:00+08:00', complete: false, denied: false, stopped: false, resumed: true, deductedAmount: null },
  ] };
  assert.equal(summarizeAnalytics(active, { ...filters, snapshotDate: '2026-02-28' }, '2026-10-04').stoppedCount, 1);
  assert.equal(summarizeAnalytics(active, filters, '2026-10-04').inProgressCount, 1);
});
