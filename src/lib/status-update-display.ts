type DisplayField = { id: number; name: string };

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

export function orderedStatusValues(info: Record<string, unknown>, fields: DisplayField[]): [string, unknown][] {
  const entries: [string, unknown][] = [];
  const knownKeys = new Set<string>();
  for (const field of fields) {
    const key = 'field:' + field.id;
    knownKeys.add(key);
    knownKeys.add(field.name);
    const storedKey = Object.prototype.hasOwnProperty.call(info, key) ? key : field.name;
    const value = info[storedKey];
    if (hasDisplayValue(value)) entries.push([storedKey, value]);
  }
  // Keep historical values whose field was removed, after the configured fields.
  for (const [key, value] of Object.entries(info)) {
    if (!knownKeys.has(key) && hasDisplayValue(value)) entries.push([key, value]);
  }
  return entries;
}

export function showPrimaryStatus(text: string, values: [string, unknown][], isStopper = false) {
  if (isStopper) return Boolean(text.trim());
  const value = text.trim();
  return Boolean(value) && value !== 'Status updated' && !values.some(([, stored]) => typeof stored === 'string' && stored.trim() === value);
}

export function showStandaloneRemarks(text: string | null, values: [string, unknown][]) {
  return Boolean(text?.trim()) && !values.some(([, stored]) => typeof stored === 'string' && stored.trim() === text?.trim());
}
