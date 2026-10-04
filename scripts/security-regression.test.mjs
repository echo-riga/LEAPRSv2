import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMoney, validateRequestInput } from '../src/lib/request-validation.ts';
import { manilaDate, manilaDateBoundary } from '../src/lib/manila-date.ts';
import { verificationCode, hashVerificationCode } from '../src/lib/verification-code.ts';

const request = { capdevId: 10, setting: 'internal', description: 'Training', requestedBudget: '5000.00', additionalInfo: {} };
test('request payload cannot set workflow, identity, or timestamps', () => {
  const result = validateRequestInput({ ...request, status: 'completed', isStopped: true, id: 2,
    userId: 'another-user', updatedById: 'admin', createdAt: new Date() });
  assert.deepEqual(result, request);
});
test('invalid amounts and excessive precision are rejected', () => {
  for (const amount of ['-5000', '0', 'NaN', 'Infinity', '1e3', '12.345', '10000000000', '', null, {}, Infinity]) {
    assert.throws(() => validateMoney(amount));
  }
  assert.equal(validateMoney('0.01'), '0.01');
  assert.equal(validateMoney('9999999999.99'), '9999999999.99');
});
test('invalid request setting, project ID, and dynamic data are rejected', () => {
  for (const override of [{ setting: 'completed' }, { capdevId: 0 }, { capdevId: '10' }, { capdevId: 1.5 }, { additionalInfo: [] }, { description: null }]) {
    assert.throws(() => validateRequestInput({ ...request, ...override }));
  }
});
test('Manila Today remains correct before 8 AM and across year boundaries', () => {
  assert.equal(manilaDate(new Date('2026-10-03T17:00:00Z')), '2026-10-04');
  assert.equal(manilaDate(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
});
test('date filters cover the complete Manila day', () => {
  assert.equal(manilaDateBoundary('2026-10-04').toISOString(), '2026-10-03T16:00:00.000Z');
  assert.equal(manilaDateBoundary('2026-10-04', true).toISOString(), '2026-10-04T15:59:59.999Z');
  assert.throws(() => manilaDateBoundary('2026-02-30'));
  assert.throws(() => manilaDateBoundary('invalid'));
});
test('verification codes are six digits and hashes are purpose/account bound', () => {
  for (let i = 0; i < 100; i++) assert.match(verificationCode(), /^[1-9]\d{5}$/);
  const hash = hashVerificationCode('reset', 'a@example.test', '123456', 'test-secret');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, '123456');
  assert.notEqual(hash, hashVerificationCode('signup', 'a@example.test', '123456', 'test-secret'));
  assert.notEqual(hash, hashVerificationCode('reset', 'b@example.test', '123456', 'test-secret'));
  assert.throws(() => hashVerificationCode('reset', 'a@example.test', '123456', ''));
});
