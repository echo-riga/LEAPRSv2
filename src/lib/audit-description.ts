type Details = Record<string, unknown>;
type AuditEntry = { action: string; entityType: string; entityLabel: string; details: unknown };

export function requestLabel(name: unknown) {
  return typeof name === 'string' && name.trim() ? `${name.trim()}'s request` : 'the request';
}

export function auditChanges(before: Details, after: Details, labels: Record<string, string>) {
  return Object.entries(labels).flatMap(([key, label]) => {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (/budget|amount/i.test(key) && from !== null && to !== null && Number(from) === Number(to)) return [];
    return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ field: key, label, from, to }];
  });
}

const labels: Record<string, string> = {
  admin: 'Admin', employee: 'Employee', 'employee-department': 'Employee (All Department Requests)',
  viewer: 'Viewer', 'viewer-full': 'Viewer (All Departments)', internal: 'In-House', external: 'External',
  in_progress: 'In progress', completed: 'Completed', denied: 'Denied', pending: 'Pending', accepted: 'Accepted',
  text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown', file: 'File upload',
  combobox: 'Suggestions only', combobox_custom: 'Suggestions or custom entry',
  full: 'Full width', half: 'Half width', left: 'Left', right: 'Right',
};

function valueText(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (/budget|amount/i.test(field) && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
  }
  if (Array.isArray(value)) return value.map((item) => valueText(item)).join(', ') || 'None';
  if (typeof value === 'object') {
    const record = value as Details;
    if (typeof record.name === 'string') return record.name;
    return Object.entries(record).map(([key, item]) => `${key}: ${valueText(item)}`).join(', ') || 'None';
  }
  return labels[String(value)] || String(value);
}

export function describeAudit(entry: AuditEntry) {
  const d: Details = entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details) ? entry.details as Details : {};
  const isRequest = entry.entityType === 'request' || entry.entityType === 'status_update';
  const userLabel = /^[0-9a-f-]{36}$/i.test(entry.entityLabel) ? (d.email || 'a user account') : entry.entityLabel;
  const storedRequestName = /'s request$/i.test(entry.entityLabel) ? entry.entityLabel.slice(0, -10) : undefined;
  const target = isRequest ? requestLabel(d.requestorName || storedRequestName)
    : entry.entityType === 'capdev' ? `CapDev project ${entry.entityLabel}`
    : entry.entityType === 'user' ? userLabel === 'a user account' ? 'a user account' : `user account for ${userLabel}`
    : entry.entityType.endsWith('_field') && !/layout|department options/i.test(entry.entityLabel) ? `form field “${entry.entityLabel}”` : entry.entityLabel;
  const actions: Record<string, string> = { created: 'Created', updated: 'Updated', deleted: 'Deleted', archived: 'Archived', restored: 'Restored', stopped: 'Paused', resumed: 'Resumed' };
  let summary = `${actions[entry.action] || 'Changed'} ${target}.`;
  if (entry.entityType === 'status_update') summary = entry.action === 'created'
    ? `${d.isStopperResponse ? 'Added a response to the pause on' : 'Added a progress update to'} ${target}.`
    : `${actions[entry.action] || 'Updated'} a progress update for ${target}.`;
  if (entry.action === 'status_changed') summary = `Changed the status of ${target}${d.previousStatus ? ` from ${valueText(d.previousStatus)}` : ''} to ${valueText(d.status)}.`;
  if (entry.entityType === 'system_setting' && typeof d.enabled === 'boolean') summary = `${d.enabled ? 'Enabled' : 'Disabled'} maintenance mode.`;
  if (d.source === 'role_approval') summary = `${d.decision === 'accepted' ? 'Approved' : 'Declined'} the role request for ${userLabel}.`;
  const changes = Array.isArray(d.changes) ? d.changes.filter((c): c is Details => Boolean(c) && typeof c === 'object' && typeof c.label === 'string') : [];
  const lines = changes.map((c) => `Changed ${String(c.label).toLowerCase()} from ${valueText(c.from, String(c.field))} to ${valueText(c.to, String(c.field))}.`);
  if (changes.length === 1 && entry.action === 'updated') {
    const c = changes[0];
    summary = `Changed ${String(c.label).toLowerCase()} for ${target} from ${valueText(c.from, String(c.field))} to ${valueText(c.to, String(c.field))}.`;
    lines.length = 0;
  }
  const changedFields = new Set(changes.map((c) => c.field));
  const metadata: Record<string, string> = { capdevAipCode: 'CapDev AIP code', requestDescription: 'Activity', department: 'Department', role: 'Role', requestedRole: 'Requested role', email: 'Email', setting: 'Request type', requestedBudget: 'Requested budget', initialBudget: 'Initial budget', statusMark: 'Progress status', reason: 'Reason for pause', statusUpdate: 'Update', remarks: 'Remarks', deductedAmount: 'Amount deducted', restoredBudget: 'Budget restored', type: 'Field type', isRequired: 'Required', included: 'Available departments', excluded: 'Hidden departments' };
  for (const [key, label] of Object.entries(metadata)) {
    if (!changedFields.has(key) && d[key] !== undefined && d[key] !== null && d[key] !== '' && !(key === 'restoredBudget' && Number(d[key]) === 0)) lines.push(`${label}: ${valueText(d[key], key)}`);
  }
  if (entry.action === 'updated' && !Array.isArray(d.changes)) lines.push('Previous values were not recorded for this entry.');
  return { summary, lines };
}
