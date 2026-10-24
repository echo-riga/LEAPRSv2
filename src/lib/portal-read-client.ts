'use client';

import type { portalReaders } from '@/lib/portal-reads';

type Readers = typeof portalReaders;
const pending = new Map<string, Promise<unknown>>();

// In-flight deduplication only. Completed responses are never retained across
// navigation, account changes, or permission changes.
export function readPortal<K extends keyof Readers>(kind: K, input: Parameters<Readers[K]>[0], accountId?: string): Promise<Awaited<ReturnType<Readers[K]>>> {
  const key = JSON.stringify({ kind, input });
  const pendingKey = accountId ? accountId + ':' + key : undefined;
  let request = pendingKey ? pending.get(pendingKey) : undefined;
  if (!request) {
    request = fetch('/api/portal/read', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: key,
    }).then(async response => {
      if (!response.ok) throw new Error('Unable to load page data. Please try again.');
      return response.json();
    }).finally(() => { if (pendingKey) pending.delete(pendingKey); });
    if (pendingKey) pending.set(pendingKey, request);
  }
  return request as Promise<Awaited<ReturnType<Readers[K]>>>;
}
