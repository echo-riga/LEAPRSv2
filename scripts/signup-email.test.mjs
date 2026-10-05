import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSignupEmail } from '../src/lib/signup-email.ts';

test('self-sign-up allows only the exact school email domain', () => {
  for (const email of ['person@plpasig.edu.ph', ' Person@PLPASIG.EDU.PH ']) assert.equal(isAllowedSignupEmail(email), true);
  for (const email of ['person@gmail.com', 'person@sub.plpasig.edu.ph', 'person@plpasig.edu.ph.example.com', 'person@otherplpasig.edu.ph', 'person@@plpasig.edu.ph', '@plpasig.edu.ph', 'per son@plpasig.edu.ph', null, {}, '']) assert.equal(isAllowedSignupEmail(email), false);
});
