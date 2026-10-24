import { and, eq, sql, type SQL } from 'drizzle-orm';
import { capdevFolders, capdevs, requests } from '@/db/schema';

type Access = { userId: string; role: string; department: string };

export function activeFolderScope(): SQL {
  return sql`exists (select 1 from ${capdevFolders} where ${capdevFolders.id} = ${capdevs.folderId} and ${capdevFolders.isActive} = true)`;
}

export function capdevAccessScope(access: Access, activeOnly = false): SQL | undefined {
  return and(
    access.role !== 'admin' || activeOnly ? activeFolderScope() : undefined,
    access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined,
  );
}

export function requestAccessScope(access: Access): SQL | undefined {
  return and(capdevAccessScope(access), access.role === 'employee' ? eq(requests.userId, access.userId) : undefined);
}
