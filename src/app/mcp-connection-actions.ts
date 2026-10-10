'use server';

import { getSessionIdentity, getUserAccess, oauthConfig } from '@/lib/mcp/oauth';

export async function getMcpConnectionInfo() {
  try {
    const identity = await getSessionIdentity();
    if (!identity || !await getUserAccess(identity.userId, identity.name, identity.email)) {
      return { success: false as const, error: 'Sign in to an active LEAPRS account to view connection details.' };
    }
    const config = oauthConfig();
    if (!config) return { success: false as const, error: 'AI app connections are not configured yet.' };
    return { success: true as const, serverUrl: config.resource };
  } catch {
    return { success: false as const, error: 'Unable to load connection details. Try again.' };
  }
}
