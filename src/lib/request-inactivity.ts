export const DEFAULT_INACTIVITY_DAYS = 7;
export const INACTIVITY_SETTING_KEY = 'request_inactivity_days';
export const DAY_MS = 86_400_000;

export type RequestInactivity = {
  days: number;
  lastActivityAt: Date;
  latestUpdateId: number | null;
  reminderKey: string;
  link: string;
  dueAt: Date;
};

export function validInactivityDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365;
}

export function requestInactivity(
  request: { id: number; capdevId: number; status: string; createdAt: Date | string; archivedAt?: Date | string | null },
  latest: { id: number; createdAt: Date | string } | null,
  threshold: number,
  options: { parentArchived?: boolean; legacyComplete?: boolean; now?: Date } = {},
): RequestInactivity | null {
  if (!validInactivityDays(threshold) || request.status !== 'in_progress' || request.archivedAt || options.parentArchived || options.legacyComplete) return null;
  const lastActivityAt = new Date(latest?.createdAt ?? request.createdAt);
  const elapsed = (options.now ?? new Date()).getTime() - lastActivityAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed < threshold * DAY_MS) return null;
  const target = latest ? 'request-status-update-' + latest.id : 'request-status-start';
  return {
    days: Math.floor(elapsed / DAY_MS), lastActivityAt, latestUpdateId: latest?.id ?? null,
    reminderKey: 'request:' + request.id + ':' + (latest ? 'update:' + latest.id : 'submitted'),
    link: '/portal/capdev/' + request.capdevId + '/requests/' + request.id + '/status?reminder=1#' + target,
    dueAt: new Date(lastActivityAt.getTime() + threshold * DAY_MS),
  };
}

export function inactivityMessage(days: number) {
  return 'No progress for ' + days + (days === 1 ? ' day.' : ' days.');
}
