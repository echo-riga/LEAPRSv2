import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import { notifications, requests, capdevs } from '@/db/schema';
import { activeReminderCondition } from '@/lib/request-reminders';
type UserAccess = { userId: string; role: string; department: string };
const REQUEST_NOTIFICATION_TYPES = ['new_request', 'status_update', 'completed', 'denied', 'inactivity_reminder'];
const ALL_NOTIFICATION_TYPES = ['capdev_created', ...REQUEST_NOTIFICATION_TYPES];
const OWNER_NOTIFICATION_TYPES = ['status_update', 'completed', 'denied', 'inactivity_reminder'];

export function notificationAudienceCondition(access: UserAccess): SQL {
  const hasLiveRecord = or(
    and(isNotNull(notifications.requestId), isNotNull(requests.id)),
    and(isNull(notifications.requestId), isNotNull(notifications.capdevId), isNotNull(capdevs.id)),
  )!;
  const isAnotherUsersAction = and(
    isNotNull(notifications.actorId),
    ne(notifications.actorId, access.userId),
  )!;

  let isInvolved: SQL;
  if (access.role === 'admin') {
    isInvolved = inArray(notifications.type, REQUEST_NOTIFICATION_TYPES);
  } else if (access.role === 'employee') {
    isInvolved = and(
      inArray(notifications.type, OWNER_NOTIFICATION_TYPES),
      eq(requests.userId, access.userId),
    )!;
  } else if (access.role === 'employee-department') {
    isInvolved = inArray(notifications.type, REQUEST_NOTIFICATION_TYPES);
  } else if (access.role === 'viewer') {
    isInvolved = and(
      inArray(notifications.type, ALL_NOTIFICATION_TYPES),
      eq(capdevs.department, access.department),
    )!;
  } else {
    isInvolved = inArray(notifications.type, ALL_NOTIFICATION_TYPES);
  }

  const standardVisibility = and(hasLiveRecord, isInvolved, or(
    and(ne(notifications.type, 'inactivity_reminder'), isAnotherUsersAction),
    activeReminderCondition(),
  ))!;
  return access.role === 'admin'
    ? or(eq(notifications.type, 'role_approval'), standardVisibility)!
    : standardVisibility;
}

