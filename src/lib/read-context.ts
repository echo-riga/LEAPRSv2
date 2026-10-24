import { AsyncLocalStorage } from 'node:async_hooks';

// Only share access checks within one HTTP read. Never cache a user's role
// or session between requests, including requests on the same server instance.
const context = new AsyncLocalStorage<{ access?: Promise<unknown> }>();

export function withReadContext<T>(read: () => Promise<T>) {
  return context.run({}, read);
}

export function readAccessOnce<T>(load: () => Promise<T>): Promise<T> {
  const scope = context.getStore();
  if (!scope) return load();
  scope.access ??= load();
  return scope.access as Promise<T>;
}
