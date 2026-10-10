export const NOTIFICATION_FILTERS = [
  { type: 'inactivity_reminder', label: 'Inactivity Reminders' },
  { type: 'new_request', label: 'Request Submissions' },
  { type: 'status_update', label: 'Status Updates' },
  { type: 'completed', label: 'Completed Requests' },
  { type: 'denied', label: 'Denied Requests' },
  { type: 'capdev_created', label: 'CapDev Creation' },
  { type: 'role_approval', label: 'Role Approvals' },
] as const;

export type NotificationFilterType = (typeof NOTIFICATION_FILTERS)[number]['type'];
export const DEFAULT_EMAIL_TYPES: NotificationFilterType[] = NOTIFICATION_FILTERS.map(item => item.type);

export function validateEmailTypes(value: unknown): NotificationFilterType[] {
  if (!Array.isArray(value) || value.length > DEFAULT_EMAIL_TYPES.length ||
    value.some(type => !DEFAULT_EMAIL_TYPES.includes(type)) || new Set(value).size !== value.length) {
    throw new Error('Select valid email notification types.');
  }
  return DEFAULT_EMAIL_TYPES.filter(type => value.includes(type));
}
