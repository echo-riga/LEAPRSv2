import { auth } from '@/lib/auth/server';
import { isAllowedSignupEmail, SIGNUP_EMAIL_ERROR } from '@/lib/signup-email';
import { writeAuthAudit } from '@/lib/auth-audit';
import { authResponseIdentity, type AuthEvent, type AuthIdentity } from '@/lib/auth-audit-event';

const handlers = auth.handler();
export const GET = handlers.GET;

export async function POST(...args: Parameters<typeof handlers.POST>) {
  const [request] = args;
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const event: AuthEvent | undefined = path.endsWith('/sign-in/email') ? 'login'
    : path.endsWith('/sign-up/email') ? 'signup' : path.endsWith('/sign-out') ? 'logout' : undefined;
  if (!event) return handlers.POST(...args);
  let body: { email?: unknown } = {};
  let identity: AuthIdentity | null = null;
  const record = (success: boolean, status: number) => writeAuthAudit({
    event, success, status, headers: request.headers, email: body?.email, identity,
  });
  try {
    if (event === 'logout') {
      try { identity = (await auth.getSession()).data?.user || null; } catch { /* Still allow sign-out. */ }
    } else {
      try { body = await request.clone().json(); }
      catch {
        await record(false, 400);
        return Response.json({ message: 'Invalid authentication request.' }, { status: 400 });
      }
    }
    if (event === 'signup' && !isAllowedSignupEmail(body?.email)) {
      await record(false, 400);
      return Response.json({ code: 'EMAIL_DOMAIN_NOT_ALLOWED', message: SIGNUP_EMAIL_ERROR }, { status: 400 });
    }
    const response = await handlers.POST(...args);
    if (response.ok && event !== 'logout') {
      identity = authResponseIdentity(await response.clone().json().catch(() => null));
    }
    await record(response.ok, response.status);
    return response;
  } catch (error) {
    await record(false, 500);
    throw error;
  }
}
