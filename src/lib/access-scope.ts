import { eq, type SQL } from 'drizzle-orm';
import { capdevs, requests } from '@/db/schema';

type Access = { userId: string; role: string; department: string };

export function capdevAccessScope(access: Access): SQL | undefined {
  return access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined;
}

export function requestAccessScope(access: Access): SQL | undefined {
  return access.role === 'employee' ? eq(requests.userId, access.userId) : capdevAccessScope(access);
}
