export const ARCHIVED_READ_ONLY = 'Archived records are read-only. Restore the record first.';

export function isArchiveReadOnly(record?: { archivedAt?: Date | string | null } | null, parent?: { archivedAt?: Date | string | null } | null) {
  return Boolean(record?.archivedAt || parent?.archivedAt);
}
