import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const authStub = 'data:text/javascript,' + encodeURIComponent(`export const auth = { handler: () => ({ GET: async () => Response.json({ forwarded: true }), POST: async () => Response.json({ forwarded: true }) }) };`);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/auth/server') return { url: authStub, shortCircuit: true };
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, context);
} });
const { POST } = await import('../src/app/api/auth/[...path]/route.ts');
const request = (endpoint, email) => new Request(`https://leaprs.test/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });

test('direct self-sign-up requests reject external and spoofed domains', async () => {
  for (const email of ['user@gmail.com', 'user@plpasig.edu.ph.example.com', 'user@sub.plpasig.edu.ph']) {
    const response = await POST(request('sign-up/email', email));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'EMAIL_DOMAIN_NOT_ALLOWED');
  }
});
test('school sign-up and admin creation are forwarded without restricting existing sign-in', async () => {
  for (const [endpoint, email] of [['sign-up/email', 'user@plpasig.edu.ph'], ['admin/create-user', 'user@gmail.com'], ['sign-in/email', 'user@gmail.com']]) {
    const response = await POST(request(endpoint, email));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).forwarded, true);
  }
});
