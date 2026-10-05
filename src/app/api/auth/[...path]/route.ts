import { auth } from '@/lib/auth/server';
import { isAllowedSignupEmail, SIGNUP_EMAIL_ERROR } from '@/lib/signup-email';

const handlers = auth.handler();
export const GET = handlers.GET;

export async function POST(...args: Parameters<typeof handlers.POST>) {
  const [request] = args;
  if (new URL(request.url).pathname.replace(/\/$/, '').endsWith('/sign-up/email')) {
    let body: { email?: unknown };
    try { body = await request.clone().json(); }
    catch { return Response.json({ message: 'Invalid sign-up request.' }, { status: 400 }); }
    if (!isAllowedSignupEmail(body?.email)) {
      return Response.json({ code: 'EMAIL_DOMAIN_NOT_ALLOWED', message: SIGNUP_EMAIL_ERROR }, { status: 400 });
    }
  }
  return handlers.POST(...args);
}
