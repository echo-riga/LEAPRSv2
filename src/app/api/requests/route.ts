import { getSessionIdentity, getUserAccess } from '@/lib/mcp/oauth';
import { submitRequestService, type RequestSubmissionInput } from '@/lib/services/leaprs-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ success: false, error: 'Invalid origin.' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ success: false, error: 'Expected application/json.' }, { status: 415 });
  }

  const identity = await getSessionIdentity();
  const access = identity && await getUserAccess(identity.userId, identity.name, identity.email);
  if (!access) return Response.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ success: false, error: 'Expected a JSON object.' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const budget = input.requestedBudget;
  const dynamicFields = input.dynamicFields;
  if (typeof input.aipCode !== 'string' || !input.aipCode.trim() ||
      (input.setting !== 'internal' && input.setting !== 'external') ||
      (typeof budget !== 'string' && typeof budget !== 'number') ||
      !Number.isFinite(Number(budget)) || Number(budget) <= 0 ||
      (input.description !== undefined && typeof input.description !== 'string') ||
      (dynamicFields !== undefined && (!dynamicFields || typeof dynamicFields !== 'object' || Array.isArray(dynamicFields))) ||
      input.userConfirmed !== true || input.attachments !== undefined || input.sourceFile !== undefined) {
    return Response.json({ success: false, error: 'Invalid request data.' }, { status: 400 });
  }

  const submission: RequestSubmissionInput = {
    aipCode: input.aipCode,
    setting: input.setting,
    requestedBudget: budget,
    description: input.description as string | undefined,
    dynamicFields: dynamicFields as Record<string, unknown> | undefined,
    userConfirmed: true,
  };
  try {
    const result = await submitRequestService(access, submission);
    return Response.json(result, {
      status: result.success ? 201 : result.error.includes('permission') ? 403 : 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to create request:', error);
    return Response.json({ success: false, error: 'Request creation failed.' }, { status: 500 });
  }
}
