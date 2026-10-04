import { createHmac, randomInt } from 'node:crypto';

export function verificationCode() { return randomInt(100000, 1000000).toString(); }
export function hashVerificationCode(purpose: string, email: string, code: string, secret: string) {
  if (!secret) throw new Error('Verification service is not configured.');
  return createHmac('sha256', secret).update(`${purpose}\0${email}\0${code}`).digest('hex');
}
