'use server';

import { db } from '@/db';
import { connections, users, capdevs, capdevFieldDefinitions, requestFieldDefinitions, requests, requestStatusUpdates, passwordResets, notifications, notificationReads, auditLogs } from '@/db/schema';
import { sql, count, and, eq, getTableColumns, lte, desc, or, isNull, isNotNull, ne, ilike, inArray, type SQL } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { sendPasswordResetEmail } from '@/lib/email';
import {
  createRequestEvaluationForm,
  getEvaluationSummary,
  type EvaluationSummary,
} from '@/lib/google-forms';
import { hashPassword } from 'better-auth/crypto';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';



export interface DbStatus {
  success: boolean;
  latencyMs?: number;
  testedAt?: string;
  writeSuccess?: boolean;
  totalChecks?: number;
  errorMessage?: string;
}

export type AppRole = 'admin' | 'employee' | 'employee-department' | 'viewer' | 'viewer-full';
export type UserAccess = { userId: string; role: AppRole; department: string };

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'];
const SELF_REGISTRATION_ROLES = ['employee', 'viewer', 'viewer-full'] as const;
const unauthorized = { success: false as const, error: 'You do not have permission to perform this action.' };

async function getCurrentAccess(): Promise<UserAccess | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  const [storedUser] = await db.select({ role: users.role, department: users.department }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!storedUser) return { userId: session.user.id, role: 'employee', department: 'Unassigned' };
  return {
    userId: session.user.id,
    role: VALID_ROLES.includes(storedUser.role as AppRole) ? storedUser.role as AppRole : 'employee',
    department: storedUser.department,
  };
}

async function getActorSnapshot(access: UserAccess) {
  const { data: session } = await auth.getSession();
  return {
    actorId: access.userId,
    actorName: session?.user?.name || session?.user?.email || 'Unknown user',
    actorEmail: session?.user?.email || null,
  };
}

async function writeAuditLog(access: UserAccess, entry: {
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'stopped' | 'resumed';
  entityType: 'capdev' | 'request' | 'status_update' | 'user' | 'capdev_field' | 'request_field';
  entityId?: string | number | null;
  entityLabel: string;
  details?: Record<string, unknown>;
}) {
  const actor = await getActorSnapshot(access);
  const details = { ...(entry.details || {}) };
  if (typeof details.capdevId === 'number' && typeof details.capdevAipCode !== 'string') {
    const [capdev] = await db.select({ aipCode: capdevs.aipCode }).from(capdevs).where(eq(capdevs.id, details.capdevId)).limit(1);
    if (capdev) details.capdevAipCode = capdev.aipCode;
  }
  await db.insert(auditLogs).values({
    ...actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    entityLabel: entry.entityLabel,
    details,
  });
}

export type AuditLogItem = typeof auditLogs.$inferSelect;

export async function getAuditLogs(input: { search?: string; action?: string; entityType?: string; page?: number; pageSize?: number } = {}) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return { success: false as const, logs: [] as AuditLogItem[], total: 0, error: unauthorized.error };
  try {
    const pageSize = Math.min(50, Math.max(1, input.pageSize || 12));
    const page = Math.max(1, input.page || 1);
    const conditions: SQL[] = [];
    if (input.action) conditions.push(eq(auditLogs.action, input.action));
    if (input.entityType) conditions.push(eq(auditLogs.entityType, input.entityType));
    const search = input.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(
        ilike(auditLogs.actorName, pattern),
        ilike(auditLogs.actorEmail, pattern),
        ilike(auditLogs.entityLabel, pattern),
        ilike(auditLogs.entityId, pattern),
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [logs, totals] = await Promise.all([
      db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ value: count() }).from(auditLogs).where(where),
    ]);
    const capdevIds = Array.from(new Set(logs.flatMap((log) => {
      const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details as Record<string, unknown> : {};
      return typeof details.capdevId === 'number' && typeof details.capdevAipCode !== 'string' ? [details.capdevId] : [];
    })));
    const capdevRows = capdevIds.length > 0
      ? await db.select({ id: capdevs.id, aipCode: capdevs.aipCode }).from(capdevs).where(inArray(capdevs.id, capdevIds))
      : [];
    const aipCodesByCapdevId = new Map(capdevRows.map((capdev) => [capdev.id, capdev.aipCode]));
    const enrichedLogs = logs.map((log) => {
      const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details as Record<string, unknown> : {};
      const capdevAipCode = typeof details.capdevId === 'number' ? aipCodesByCapdevId.get(details.capdevId) : undefined;
      return capdevAipCode ? { ...log, details: { ...details, capdevAipCode } } : log;
    });
    return { success: true as const, logs: enrichedLogs, total: totals[0]?.value || 0 };
  } catch (error) {
    console.error('Failed to get audit logs:', error);
    return { success: false as const, logs: [] as AuditLogItem[], total: 0, error: 'Unable to load audit logs.' };
  }
}

function canAccessCapdev(access: UserAccess, capdev: { department: string }) {
  return access.role === 'admin' || access.role === 'viewer-full' || access.role === 'employee' || capdev.department === access.department;
}

function canManageRequests(access: UserAccess) {
  return access.role === 'admin' || access.role === 'employee' || access.role === 'employee-department';
}

function canControlRequestStop(access: UserAccess) {
  return access.role === 'admin' || access.role === 'employee-department';
}

async function getAccessibleCapdev(access: UserAccess, capdevId: number) {
  const [capdev] = await db.select().from(capdevs).where(eq(capdevs.id, capdevId)).limit(1);
  return capdev && canAccessCapdev(access, capdev) ? capdev : null;
}

async function getAccessibleRequest(access: UserAccess, requestId: number) {
  const [record] = await db.select({ request: getTableColumns(requests), capdevDepartment: capdevs.department }).from(requests).innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(eq(requests.id, requestId)).limit(1);
  if (!record) return null;
  if (access.role === 'employee') return record.request.userId === access.userId ? record.request : null;
  if (access.role === 'employee-department') return record.capdevDepartment === access.department ? record.request : null;
  if (access.role === 'viewer') return record.capdevDepartment === access.department ? record.request : null;
  return record.request;
}

export async function getCurrentUserAccess() {
  const access = await getCurrentAccess();
  return access ? { success: true as const, ...access } : { success: false as const, error: 'You must be signed in.' };
}

export async function checkDrizzleConnection(): Promise<DbStatus> {
  const testedAt = new Date().toISOString();
  const start = Date.now();

  try {
    // 1. Test Read Connection
    await db.execute(sql`SELECT NOW()`);
    const latencyMs = Date.now() - start;

    // 2. Test Write Connection (Log check to Neon via Drizzle)
    let writeSuccess = false;
    try {
      await db.insert(connections).values({
        status: 'success',
      });
      writeSuccess = true;
    } catch (e: any) {
      console.error('Database write error:', e);
    }

    // 3. Count Checks (Test aggregation/read query)
    let totalChecks = 0;
    try {
      const countRes = await db.select({ value: count() }).from(connections);
      totalChecks = countRes[0].value || 0;
    } catch (e: any) {
      console.error('Database aggregation error:', e);
    }

    return {
      success: true,
      latencyMs,
      testedAt,
      writeSuccess,
      totalChecks,
    };
  } catch (error: any) {
    console.error('Database connection check failed:', error);
    return {
      success: false,
      testedAt,
      errorMessage: error.message || 'Unknown database connection error',
    };
  }
}

export async function getOrCreateUserRole(userId: string, email: string): Promise<string> {
  try {
    const access = await getCurrentAccess();
    if (!access || access.userId !== userId) return 'employee';
    const existing = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing.length > 0) {
      return existing[0].role;
    }

    const role = 'employee';

    await db.insert(users).values({
      id: userId,
      role: role,
    });

    return role;
  } catch (error) {
    console.error('Error fetching or creating user role:', error);
    return 'employee';
  }
}

export async function getDepartmentOptions() {
  try {
    const [userDepartments, capdevDepartments] = await Promise.all([
      db.select({ department: users.department }).from(users),
      db.select({ department: capdevs.department }).from(capdevs),
    ]);
    return Array.from(new Set([...userDepartments, ...capdevDepartments]
      .map((record) => record.department.trim())
      .filter((department) => department && department !== 'Unassigned')))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Failed to load department options:', error);
    return [];
  }
}

export async function completeSelfRegistration(input: { role: string; department: string }) {
  const access = await getCurrentAccess();
  const role = input.role as (typeof SELF_REGISTRATION_ROLES)[number];
  const department = input.department.trim();
  if (!access) return unauthorized;
  if (!SELF_REGISTRATION_ROLES.includes(role) || !department || department.length > 255) {
    return { success: false, error: 'Provide a valid role and department.' };
  }

  try {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, access.userId)).limit(1);
    if (existing) return { success: false, error: 'This account has already been registered.' };
    await db.insert(users).values({ id: access.userId, role, department });
    await writeAuditLog(access, { action: 'created', entityType: 'user', entityId: access.userId, entityLabel: access.userId, details: { role, department, source: 'self_registration' } });
    return { success: true };
  } catch (error) {
    console.error('Failed to complete self-registration:', error);
    return { success: false, error: 'Unable to complete registration.' };
  }
}

export async function getAllUsers() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return [];
    return await db.select().from(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return [];
  }
}

export type DirectoryUser = { id: string; name: string | null; email: string; createdAt: Date; role: string; department: string };

export async function getUsersDirectory(): Promise<DirectoryUser[]> {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return [];

  try {
    const [{ data: authUsers, error: authError }, appUsers] = await Promise.all([
      auth.admin.listUsers({ query: { limit: 100 } }),
      db.select().from(users),
    ]);
    if (authError || !authUsers) throw new Error(authError?.message || 'Neon Auth did not return users.');
    const appUsersById = new Map(appUsers.map((user) => [user.id, user]));
    return authUsers.users.map((user) => ({
      id: user.id,
      name: user.name || null,
      email: user.email,
      createdAt: user.createdAt,
      role: appUsersById.get(user.id)?.role || 'employee',
      department: appUsersById.get(user.id)?.department || 'Unassigned',
    }));
  } catch (error) {
    console.error('Failed to fetch Neon Auth users:', error);
    return [];
  }
}

export async function updateUserRole(userId: string, newRole: string, department?: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin' || !VALID_ROLES.includes(newRole as AppRole)) return unauthorized;
    await db.update(users).set({ role: newRole, ...(department ? { department } : {}) }).where(eq(users.id, userId));
    await writeAuditLog(access, { action: 'updated', entityType: 'user', entityId: userId, entityLabel: userId, details: { role: newRole, ...(department ? { department } : {}) } });
    return { success: true };
  } catch (error) {
    console.error('Failed to update user role:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function updateDirectoryUser(userId: string, input: { name: string; email: string; role: string; department: string }) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || !VALID_ROLES.includes(input.role as AppRole)) return unauthorized;
  try {
    const { error } = await auth.admin.updateUser({ userId, data: { name: input.name, email: input.email } });
    if (error) return { success: false, error: error.message || 'Unable to update the Neon Auth user.' };
    await db.update(users).set({ role: input.role, department: input.department }).where(eq(users.id, userId));
    await writeAuditLog(access, { action: 'updated', entityType: 'user', entityId: userId, entityLabel: input.name || input.email, details: { email: input.email, role: input.role, department: input.department } });
    return { success: true };
  } catch (error) {
    console.error('Failed to update user directory record:', error);
    return { success: false, error: 'Unable to update the user.' };
  }
}

export async function createUser(userId: string, role: string, department = 'Unassigned') {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin' || !VALID_ROLES.includes(role as AppRole)) return unauthorized;
    await db.insert(users).values({
      id: userId,
      role: role,
      department,
    });
    await writeAuditLog(access, { action: 'created', entityType: 'user', entityId: userId, entityLabel: userId, details: { role, department } });
    return { success: true };
  } catch (error) {
    console.error('Failed to create user in DB:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function createDirectoryUser(input: { name: string; email: string; password: string; role: string; department: string }) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || !VALID_ROLES.includes(input.role as AppRole)) return unauthorized;
  try {
    const { data, error } = await auth.admin.createUser({ email: input.email, password: input.password, name: input.name });
    if (error || !data?.user) return { success: false, error: error?.message || 'Unable to create the Neon Auth user.' };
    await db.insert(users).values({ id: data.user.id, role: input.role, department: input.department });
    await writeAuditLog(access, { action: 'created', entityType: 'user', entityId: data.user.id, entityLabel: input.name || input.email, details: { email: input.email, role: input.role, department: input.department } });
    return { success: true, user: data.user };
  } catch (error) {
    console.error('Failed to create user directory record:', error);
    return { success: false, error: 'Unable to create the user.' };
  }
}

export async function deleteUser(userId: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin' || access.userId === userId) return unauthorized;
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    await db.delete(users).where(eq(users.id, userId));
    await writeAuditLog(access, { action: 'deleted', entityType: 'user', entityId: userId, entityLabel: userId, details: target ? { role: target.role, department: target.department } : {} });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete user from DB:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function deleteDirectoryUser(userId: string) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || access.userId === userId) return unauthorized;
  try {
    const [{ data: authUsers }, targetRows] = await Promise.all([
      auth.admin.listUsers({ query: { limit: 100 } }),
      db.select().from(users).where(eq(users.id, userId)).limit(1),
    ]);
    const targetAuthUser = authUsers?.users?.find((user) => user.id === userId);
    const { error } = await auth.admin.removeUser({ userId });
    if (error) return { success: false, error: error.message || 'Unable to delete the Neon Auth user.' };
    await db.delete(users).where(eq(users.id, userId));
    const target = targetRows[0];
    await writeAuditLog(access, { action: 'deleted', entityType: 'user', entityId: userId, entityLabel: targetAuthUser?.name || targetAuthUser?.email || userId, details: { email: targetAuthUser?.email || null, role: target?.role || null, department: target?.department || null } });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete user directory record:', error);
    return { success: false, error: 'Unable to delete the user.' };
  }
}

export type CapdevInput = {
  aipCode: string;
  description: string;
  budget: string;
  department: string;
  additionalInfo: Record<string, unknown>;
  updatedById: string;
};

async function getMissingRequiredCapdevFields(additionalInfo: Record<string, unknown>) {
  const fields = await db
    .select({ name: capdevFieldDefinitions.name, type: capdevFieldDefinitions.type, isRequired: capdevFieldDefinitions.isRequired, section: capdevFieldDefinitions.section })
    .from(capdevFieldDefinitions)
    .where(eq(capdevFieldDefinitions.isActive, true));

  return fields
    .filter((field) => field.isRequired || field.section === 'required')
    .filter((field) => {
      const value = additionalInfo[field.name];
      if (field.type === 'file') return !Array.isArray(value) || value.length === 0;
      if (field.type === 'table') {
        if (!Array.isArray(value) || value.length === 0) return true;
        return !value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      }
      return value === undefined || value === null || String(value).trim().length === 0;
    })
    .map((field) => field.name);
}

export async function getAllCapdevs() {
  try {
    const access = await getCurrentAccess();
    if (!access) return [];
    const records = await db.select().from(capdevs).orderBy(capdevs.aipCode);
    return records.filter((capdev) => canAccessCapdev(access, capdev));
  } catch (error) {
    console.error('Failed to fetch CapDev projects:', error);
    return [];
  }
}

export async function getAnalyticsData() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevs: [], requests: [], statusUpdates: [] };
    const [capdevData, requestData, statusUpdateData] = await Promise.all([
      db.select({ id: capdevs.id, aipCode: capdevs.aipCode, description: capdevs.description, department: capdevs.department, initialBudget: capdevs.initialBudget, budget: capdevs.budget, createdAt: capdevs.createdAt }).from(capdevs),
      db.select({ id: requests.id, capdevId: requests.capdevId, setting: requests.setting, createdAt: requests.createdAt }).from(requests),
      db.select({ requestId: requestStatusUpdates.requestId, markAsComplete: requestStatusUpdates.markAsComplete }).from(requestStatusUpdates),
    ]);

    const permittedCapdevs = capdevData.filter((capdev) => canAccessCapdev(access, capdev));
    const permittedIds = new Set(permittedCapdevs.map((capdev) => capdev.id));
    const permittedRequests = requestData.filter((request) => permittedIds.has(request.capdevId));
    const permittedRequestIds = new Set(permittedRequests.map((request) => request.id));
    return {
      capdevs: permittedCapdevs.map((capdev) => ({ ...capdev, initialBudget: String(capdev.initialBudget), budget: String(capdev.budget), createdAt: capdev.createdAt.toISOString() })),
      requests: permittedRequests.map((request) => ({ ...request, createdAt: request.createdAt.toISOString() })),
      statusUpdates: statusUpdateData.filter((update) => permittedRequestIds.has(update.requestId)),
    };
  } catch (error) {
    console.error('Failed to fetch analytics data:', error);
    return { capdevs: [], requests: [], statusUpdates: [] };
  }
}

export async function getMonitoringReportData() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevs: [], requests: [], capdevFields: [], requestFields: [] };
    const [capdevData, requestData, capdevFields, requestFields] = await Promise.all([
      db.select().from(capdevs).orderBy(capdevs.aipCode),
      db.select().from(requests).orderBy(requests.createdAt),
      db.select().from(capdevFieldDefinitions).where(eq(capdevFieldDefinitions.isActive, true)).orderBy(capdevFieldDefinitions.sortOrder),
      db.select().from(requestFieldDefinitions).where(eq(requestFieldDefinitions.isActive, true)).orderBy(requestFieldDefinitions.sortOrder),
    ]);
    const permittedCapdevs = capdevData.filter((capdev) => canAccessCapdev(access, capdev));
    const permittedIds = new Set(permittedCapdevs.map((capdev) => capdev.id));
    return { capdevs: permittedCapdevs, requests: requestData.filter((request) => permittedIds.has(request.capdevId)), capdevFields, requestFields };
  } catch (error) {
    console.error('Failed to fetch monitoring report data:', error);
    return { capdevs: [], requests: [], capdevFields: [], requestFields: [] };
  }
}

type MonitoringField = { name: string; source: 'capdev' | 'request'; key?: string };

function monitoringCellValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item)).join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function columnLetter(column: number) {
  let result = '';
  for (let current = column; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(((current - 1) % 26) + 65) + result;
  return result;
}

export async function generateMonitoringSheet(input: { capdevIds: number[]; capdevFieldIds: number[]; requestFieldIds: number[]; capdevFixedFields: string[]; requestFixedFields: string[] }) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return unauthorized;
    if (input.capdevIds.length === 0) return { success: false, error: 'Select at least one CapDev project.' };
    const [allCapdevs, allRequests, capdevFields, requestFields] = await Promise.all([
      db.select().from(capdevs), db.select().from(requests),
      db.select().from(capdevFieldDefinitions).where(eq(capdevFieldDefinitions.isActive, true)).orderBy(capdevFieldDefinitions.sortOrder),
      db.select().from(requestFieldDefinitions).where(eq(requestFieldDefinitions.isActive, true)).orderBy(requestFieldDefinitions.sortOrder),
    ]);
    const selectedCapdevs = allCapdevs.filter((capdev) => input.capdevIds.includes(capdev.id) && canAccessCapdev(access, capdev));
    const selectedCapdevsById = new Map(selectedCapdevs.map((capdev) => [capdev.id, capdev]));
    const selectedRequests = allRequests.filter((request) => selectedCapdevsById.has(request.capdevId));
    const fields: MonitoringField[] = [
      ...input.capdevFixedFields.map((key) => ({ name: key, source: 'capdev' as const, key })),
      ...capdevFields.filter((field) => input.capdevFieldIds.includes(field.id)).map((field) => ({ name: field.name, source: 'capdev' as const })),
      ...input.requestFixedFields.map((key) => ({ name: key, source: 'request' as const, key })),
      ...requestFields.filter((field) => input.requestFieldIds.includes(field.id)).map((field) => ({ name: field.name, source: 'request' as const })),
    ];
    const capacityColumns = Math.max(1, fields.length);
    const originalCapacityColumns = 8;
    const template = await readFile(path.join(process.cwd(), 'public', 'monitoring-sheet-template.xlsx'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Sheet1');
    if (!sheet) return { success: false, error: 'Monitoring sheet template was not found.' };

    ['B1:BT1', 'BU1:CI1', 'B2:I2', 'J2:K2', 'L2:O2', 'P2:AE2', 'AF2:AR2', 'AS2:BC2', 'BD2:BJ2', 'BK2:BT2', 'BV2:BX2', 'BY2:CA2', 'CB2:CD2', 'CE2:CH2', 'CI2:CI3'].forEach((range) => sheet.unMergeCells(range));
    const delta = capacityColumns - originalCapacityColumns;
    if (delta > 0) sheet.spliceColumns(10, 0, ...Array.from({ length: delta }, () => []));
    if (delta < 0) sheet.spliceColumns(2 + capacityColumns, -delta);

    const sectionDefinitions = [
      { label: 'CAPDEV PROPOSAL (To be filled out by HRDO)', width: 2 },
      { label: 'I. LBP FORM 4 DETAILS (To be filled out by OFFICES)', width: 4 },
      { label: 'II. ACTIVITY DESIGN DETAILS (To be filled out by OFFICES)', width: 16 },
      { label: 'III. BUDGETARY REQUIREMENTS (Fill Color = Obligated/Utilized) (To be filled out by OFFICES)', width: 13 },
      { label: 'IV. DOCUMENT TRACKER DETAILS (To be filled out by OFFICES)', width: 11 },
      { label: 'V. TERMINAL REPORT DETAILS (To be filled out by OFFICES)', width: 7 },
      { label: 'VI. ATTACHMENT (To be filled out by OFFICES)', width: 10 },
    ];
    const headerStyle = { ...sheet.getCell('B3').style };
    const dataStyle = { ...sheet.getCell('B4').style };
    for (let offset = 0; offset < capacityColumns; offset += 1) {
      const column = 2 + offset;
      sheet.getColumn(column).width = 14;
      sheet.getCell(3, column).style = { ...headerStyle };
      sheet.getCell(4, column).style = { ...dataStyle };
      sheet.getCell(3, column).value = fields[offset]?.name || '';
    }

    let cursor = 2 + capacityColumns;
    sheet.mergeCells(2, 2, 2, cursor - 1);
    sheet.getCell(2, 2).value = 'CAPACITY DEVELOPMENT';
    for (const section of sectionDefinitions) {
      sheet.mergeCells(2, cursor, 2, cursor + section.width - 1);
      sheet.getCell(2, cursor).value = section.label;
      if (section.label.startsWith('I. LBP')) {
        for (let column = cursor; column < cursor + section.width; column += 1) sheet.getCell(2, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF47D45A' } };
      }
      cursor += section.width;
    }
    const attachmentEnd = cursor - 1;
    cursor += 1;
    const ratingSections = [
      { label: 'HRDO RATING PRE-IMPLEMENTATION', width: 3 }, { label: 'HRDO RATING DURING-IMPLEMENTATION', width: 3 },
      { label: 'HRDO RATING POST-IMPLEMENTATION', width: 3 }, { label: 'AVERAGE ACTIVITY RATING', width: 4 }, { label: 'HRDO ANALYSIS', width: 1 },
    ];
    for (const section of ratingSections) {
      if (section.width > 1) sheet.mergeCells(2, cursor, 2, cursor + section.width - 1);
      sheet.getCell(2, cursor).value = section.label;
      cursor += section.width;
    }
    for (const row of [2, 3]) {
      for (let column = 2; column < cursor; column += 1) {
        const cell = sheet.getCell(row, column);
        const fill = cell.fill;
        const isWhiteOrUnfilled = fill?.type !== 'pattern' || fill.pattern !== 'solid' || fill.fgColor?.argb === 'FFFFFFFF';
        if (isWhiteOrUnfilled) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF47D45A' } };
      }
    }
    sheet.mergeCells(1, 2, 1, attachmentEnd);
    sheet.mergeCells(1, attachmentEnd + 1, 1, cursor - 1);
    sheet.getCell(1, 2).value = `${new Date().getFullYear()} CONSOLIDATED COMPETENCY-BASED LEARNING & DEVELOPMENT INTERVENTIONS (CapDev)`;
    sheet.getCell(1, attachmentEnd + 1).value = 'To be filled out by HRDO';

    if (selectedRequests.length > 1) sheet.duplicateRow(4, selectedRequests.length - 1, true);
    const rowCount = Math.max(1, selectedRequests.length);
    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      const row = 4 + rowOffset;
      const request = selectedRequests[rowOffset];
      const capdev = request ? selectedCapdevsById.get(request.capdevId) : undefined;
      const capdevInfo = (capdev?.additionalInfo || {}) as Record<string, unknown>;
      const requestInfo = (request?.additionalInfo || {}) as Record<string, unknown>;
      for (let offset = 0; offset < capacityColumns; offset += 1) {
        const cell = sheet.getCell(row, 2 + offset);
        cell.style = { ...dataStyle };
        const field = fields[offset];
        const record = field?.source === 'capdev' ? capdev : request;
        cell.value = field ? monitoringCellValue(field.key ? record?.[field.key as keyof typeof record] : field.source === 'capdev' ? capdevInfo[field.name] : requestInfo[field.name]) : '';
      }
      for (let column = 2 + capacityColumns; column < cursor; column += 1) {
        const cell = sheet.getCell(row, column);
        cell.value = '';
      }
    }
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 3, topLeftCell: 'B4' }];
    workbook.calcProperties.fullCalcOnLoad = true;
    const output = await workbook.xlsx.writeBuffer();
    return { success: true, fileName: `Monitoring-Sheet-${new Date().getFullYear()}.xlsx`, base64: Buffer.from(output).toString('base64'), columns: `${columnLetter(2)}:${columnLetter(1 + capacityColumns)}` };
  } catch (error) {
    console.error('Failed to generate monitoring sheet:', error);
    return { success: false, error: 'Unable to generate the monitoring sheet.' };
  }
}

export async function createCapdev(data: CapdevInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(data.aipCode?.trim() || '')) {
      return { success: false, error: 'AIP Code must follow the format: 0000-000-0-0-00-000-000' };
    }
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [created] = await db.insert(capdevs).values({ ...data, updatedById: access.userId, initialBudget: data.budget }).returning();
    await writeAuditLog(access, { action: 'created', entityType: 'capdev', entityId: created.id, entityLabel: created.aipCode, details: { department: created.department, initialBudget: created.initialBudget } });
    void createNotification({
      actorId: access.userId,
      capdevId: created.id,
      title: `New CapDev Project: ${created.aipCode}`,
      message: `Created for ${created.department} with balance ₱${Number(created.initialBudget).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      link: `/admin/capdev/${created.id}/requests`,
      type: 'capdev_created',
    });
    return { success: true, capdev: created };
  } catch (error) {
    console.error('Failed to create CapDev project:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateCapdev(id: number, data: CapdevInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(data.aipCode?.trim() || '')) {
      return { success: false, error: 'AIP Code must follow the format: 0000-000-0-0-00-000-000' };
    }
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [updated] = await db
      .update(capdevs)
      .set({ aipCode: data.aipCode, description: data.description, department: data.department, additionalInfo: data.additionalInfo, updatedById: access.userId, updatedAt: new Date() })
      .where(eq(capdevs.id, id))
      .returning();
    if (!updated) return { success: false, error: 'CapDev project not found.' };
    await writeAuditLog(access, { action: 'updated', entityType: 'capdev', entityId: updated.id, entityLabel: updated.aipCode, details: { department: updated.department } });
    return { success: true, capdev: updated };
  } catch (error) {
    console.error('Failed to update CapDev project:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function getCapdevById(id: number) {
  try {
    const access = await getCurrentAccess();
    return access ? await getAccessibleCapdev(access, id) : null;
  } catch (error) {
    console.error('Failed to fetch CapDev project:', error);
    return null;
  }
}

export async function getCapdevBudgetHistory(capdevId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !await getAccessibleCapdev(access, capdevId)) return [];
    return await db
      .select({ authorName: requestStatusUpdates.authorName, amount: requests.requestedBudget, createdAt: requestStatusUpdates.createdAt })
      .from(requestStatusUpdates)
      .innerJoin(requests, eq(requestStatusUpdates.requestId, requests.id))
      .where(and(eq(requests.capdevId, capdevId), eq(requestStatusUpdates.subtractsRequestedAmount, true)))
      .orderBy(requestStatusUpdates.createdAt);
  } catch (error) {
    console.error('Failed to fetch CapDev budget history:', error);
    return [];
  }
}

export async function deleteCapdev(id: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const actor = await getActorSnapshot(access);
    // Delete child records first, then the project, in one database statement.
    // The dependencies between the CTEs ensure PostgreSQL respects the foreign keys.
    const result = await db.execute(sql`
      WITH deleted_status_updates AS (
        DELETE FROM request_status_updates
        WHERE request_id IN (SELECT id FROM requests WHERE capdev_id = ${id})
        RETURNING id
      ),
      deleted_requests AS (
        DELETE FROM requests
        WHERE capdev_id = ${id}
          AND (SELECT COUNT(*) FROM deleted_status_updates) >= 0
        RETURNING id
      ),
      deleted_capdev AS (
        DELETE FROM capdevs
        WHERE id = ${id}
          AND (SELECT COUNT(*) FROM deleted_requests) >= 0
        RETURNING id, aip_code, department
      ),
      inserted_audit AS (
        INSERT INTO audit_logs (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, details)
        SELECT ${actor.actorId}, ${actor.actorName}, ${actor.actorEmail}, 'deleted', 'capdev', id::text, aip_code,
          jsonb_build_object('department', department)
        FROM deleted_capdev
        RETURNING id
      )
      SELECT id FROM inserted_audit
    `);
    if (result.rows.length === 0) return { success: false, error: 'CapDev project not found.' };
    return { success: true };
  } catch (error) {
    console.error('Failed to delete CapDev project:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function getDynamicFieldCounts() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevFieldsCount: 0, requestFieldsCount: 0 };
    const capdevCount = await db
      .select({ value: count() })
      .from(capdevFieldDefinitions)
      .where(eq(capdevFieldDefinitions.isActive, true));

    const requestCount = await db
      .select({ value: count() })
      .from(requestFieldDefinitions)
      .where(eq(requestFieldDefinitions.isActive, true));

    return {
      capdevFieldsCount: capdevCount[0]?.value || 0,
      requestFieldsCount: requestCount[0]?.value || 0,
    };
  } catch (error) {
    console.error('Failed to get dynamic field counts:', error);
    return { capdevFieldsCount: 0, requestFieldsCount: 0 };
  }
}

export async function getCapdevFieldDefinitions() {
  try {
    if (!await getCurrentAccess()) return [];
    return await db
      .select()
      .from(capdevFieldDefinitions)
      .where(eq(capdevFieldDefinitions.isActive, true))
      .orderBy(capdevFieldDefinitions.sortOrder);
  } catch (error) {
    console.error('Failed to get CapDev fields:', error);
    return [];
  }
}

export async function saveCapdevFieldDefinition(data: {
  id?: number;
  name: string;
  type: string;
  options?: any | null; // Dropdown options array
  isRequired: boolean;
  section: string;
  width: string;
  placeholder?: string | null;
  sortOrder?: number;
  updatedById: string;
}) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (data.id) {
      await db
        .update(capdevFieldDefinitions)
        .set({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.section,
          width: data.width,
          placeholder: data.placeholder || null,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        })
        .where(eq(capdevFieldDefinitions.id, data.id));
      await writeAuditLog(access, { action: 'updated', entityType: 'capdev_field', entityId: data.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired } });
      return { success: true, id: data.id };
    } else {
      const existing = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${capdevFieldDefinitions.sortOrder}), 0)` })
        .from(capdevFieldDefinitions);
      const nextOrder = (existing[0]?.maxOrder || 0) + 1;

      const [inserted] = await db
        .insert(capdevFieldDefinitions)
        .values({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.section,
          width: data.width,
          placeholder: data.placeholder || null,
          sortOrder: data.sortOrder !== undefined ? data.sortOrder : nextOrder,
          updatedById: data.updatedById,
        })
        .returning({ id: capdevFieldDefinitions.id });
      await writeAuditLog(access, { action: 'created', entityType: 'capdev_field', entityId: inserted.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired } });
      return { success: true, id: inserted.id };
    }
  } catch (error) {
    console.error('Failed to save CapDev field:', error);
    return { success: false, error: 'Database save failed' };
  }
}

export async function deleteCapdevFieldDefinition(id: number, updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const [field] = await db.select({ name: capdevFieldDefinitions.name }).from(capdevFieldDefinitions).where(eq(capdevFieldDefinitions.id, id)).limit(1);
    await db
      .update(capdevFieldDefinitions)
      .set({
        isActive: false,
        updatedById: updatedById,
        updatedAt: new Date(),
      })
      .where(eq(capdevFieldDefinitions.id, id));
    await writeAuditLog(access, { action: 'deleted', entityType: 'capdev_field', entityId: id, entityLabel: field?.name || `CapDev field #${id}` });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete CapDev field:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function updateCapdevFieldsOrder(idOrderArray: number[], updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (idOrderArray.length === 0) return { success: true };
    const orderRows = idOrderArray.map((id, index) => sql`(${id}::integer, ${index + 1}::integer)`);
    // The Neon HTTP driver cannot use Drizzle callback transactions. This is one
    // PostgreSQL statement, so every field order is updated atomically instead.
    await db.execute(sql`
      UPDATE capdev_field_definitions AS field
      SET sort_order = ordered.sort_order,
          updated_by_id = ${updatedById},
          updated_at = NOW()
      FROM (VALUES ${sql.join(orderRows, sql`, `)}) AS ordered(id, sort_order)
      WHERE field.id = ordered.id
    `);
    await writeAuditLog(access, { action: 'updated', entityType: 'capdev_field', entityLabel: 'CapDev field order', details: { fieldIds: idOrderArray } });
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder CapDev fields:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function getRequestFieldDefinitions() {
  try {
    if (!await getCurrentAccess()) return [];
    return await db
      .select()
      .from(requestFieldDefinitions)
      .where(eq(requestFieldDefinitions.isActive, true))
      .orderBy(requestFieldDefinitions.sortOrder);
  } catch (error) {
    console.error('Failed to get Request fields:', error);
    return [];
  }
}

export async function saveRequestFieldDefinition(data: {
  id?: number;
  name: string;
  type: string;
  options?: unknown[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  placeholder?: string | null;
  sortOrder?: number;
  updatedById: string;
}) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (data.id) {
      await db
        .update(requestFieldDefinitions)
        .set({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.section,
          width: data.width,
          placeholder: data.placeholder || null,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        })
        .where(eq(requestFieldDefinitions.id, data.id));
      await writeAuditLog(access, { action: 'updated', entityType: 'request_field', entityId: data.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired } });
      return { success: true, id: data.id };
    }

    const existing = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${requestFieldDefinitions.sortOrder}), 0)` })
      .from(requestFieldDefinitions);
    const nextOrder = (existing[0]?.maxOrder || 0) + 1;

    const [inserted] = await db
      .insert(requestFieldDefinitions)
      .values({
        name: data.name,
        type: data.type,
        options: data.options || null,
        isRequired: data.isRequired,
        section: data.section,
        width: data.width,
        placeholder: data.placeholder || null,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : nextOrder,
        updatedById: data.updatedById,
      })
      .returning({ id: requestFieldDefinitions.id });
    await writeAuditLog(access, { action: 'created', entityType: 'request_field', entityId: inserted.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired } });
    return { success: true, id: inserted.id };
  } catch (error) {
    console.error('Failed to save Request field:', error);
    return { success: false, error: 'Database save failed' };
  }
}

export async function deleteRequestFieldDefinition(id: number, updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const [field] = await db.select({ name: requestFieldDefinitions.name }).from(requestFieldDefinitions).where(eq(requestFieldDefinitions.id, id)).limit(1);
    await db
      .update(requestFieldDefinitions)
      .set({ isActive: false, updatedById, updatedAt: new Date() })
      .where(eq(requestFieldDefinitions.id, id));
    await writeAuditLog(access, { action: 'deleted', entityType: 'request_field', entityId: id, entityLabel: field?.name || `Request field #${id}` });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete Request field:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function updateRequestFieldsOrder(idOrderArray: number[], updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (idOrderArray.length === 0) return { success: true };
    const orderRows = idOrderArray.map((id, index) => sql`(${id}::integer, ${index + 1}::integer)`);
    // See updateCapdevFieldsOrder: a single statement is compatible with Neon HTTP
    // and preserves all-or-nothing ordering updates.
    await db.execute(sql`
      UPDATE request_field_definitions AS field
      SET sort_order = ordered.sort_order,
          updated_by_id = ${updatedById},
          updated_at = NOW()
      FROM (VALUES ${sql.join(orderRows, sql`, `)}) AS ordered(id, sort_order)
      WHERE field.id = ordered.id
    `);
    await writeAuditLog(access, { action: 'updated', entityType: 'request_field', entityLabel: 'Request field order', details: { fieldIds: idOrderArray } });
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder Request fields:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export type RequestInput = {
  capdevId: number;
  userId: string;
  setting: string;
  description: string;
  requestedBudget: string;
  additionalInfo: Record<string, unknown>;
  updatedById: string;
};

export async function getRequestsByCapdev(capdevId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !await getAccessibleCapdev(access, capdevId)) return [];
    const records = await db
      .select(getTableColumns(requests))
      .from(requests)
      .where(eq(requests.capdevId, capdevId))
      .orderBy(requests.createdAt);
    return access.role === 'employee' ? records.filter((request) => request.userId === access.userId) : records;
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    return [];
  }
}

export async function getRequestById(id: number) {
  try {
    const access = await getCurrentAccess();
    return access ? await getAccessibleRequest(access, id) : null;
  } catch (error) {
    console.error('Failed to fetch request:', error);
    return null;
  }
}

export async function createRequest(data: RequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return unauthorized;
    if (!await getAccessibleCapdev(access, data.capdevId)) return unauthorized;
    const { data: session } = await auth.getSession();

    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, data.capdevId)).limit(1);
    if (!capdev || Number(data.requestedBudget) > Number(capdev.budget)) return { success: false, error: 'Requested amount exceeds the remaining CapDev balance.' };
    const [created] = await db.insert(requests).values({
      ...data,
      userId: access.userId,
      updatedById: access.userId,
      requestorName: session?.user?.name || session?.user?.email || 'Requestor',
    }).returning();
    await writeAuditLog(access, { action: 'created', entityType: 'request', entityId: created.id, entityLabel: `Request #${created.id}`, details: { capdevId: created.capdevId, setting: created.setting, requestedBudget: created.requestedBudget, requestorName: created.requestorName } });
    void createNotification({
      actorId: access.userId,
      capdevId: created.capdevId,
      requestId: created.id,
      title: `New Requisition: ${created.setting || 'CapDev Request'}`,
      message: `${created.requestorName || 'Staff'} submitted request #${created.id} for ₱${Number(created.requestedBudget).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      link: `/admin/capdev/${created.capdevId}/requests/${created.id}/status`,
      type: 'new_request',
    });
    return { success: true, request: created };
  } catch (error) {
    console.error('Failed to create request:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateRequest(id: number, data: RequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return unauthorized;
    const existing = await getAccessibleRequest(access, id);
    if (!existing) return { success: false, error: 'Request not found.' };
    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, existing.capdevId)).limit(1);
    const [deduction] = await db.select({ id: requestStatusUpdates.id }).from(requestStatusUpdates).where(and(eq(requestStatusUpdates.requestId, id), eq(requestStatusUpdates.subtractsRequestedAmount, true))).limit(1);
    if (deduction && Number(data.requestedBudget) !== Number(existing.requestedBudget)) return { success: false, error: 'Requested budget cannot be changed after it has been deducted.' };
    if (!deduction && (!capdev || Number(data.requestedBudget) > Number(capdev.budget))) return { success: false, error: 'Requested budget exceeds the remaining CapDev budget.' };
    const [updated] = await db.update(requests).set({ ...data, capdevId: existing.capdevId, userId: existing.userId, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, id)).returning();
    if (!updated) return { success: false, error: 'Request not found.' };
    await writeAuditLog(access, { action: 'updated', entityType: 'request', entityId: updated.id, entityLabel: `Request #${updated.id}`, details: { capdevId: updated.capdevId, setting: updated.setting, requestedBudget: updated.requestedBudget } });
    return { success: true, request: updated };
  } catch (error) {
    console.error('Failed to update request:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function deleteRequest(id: number) {
  try {
    const access = await getCurrentAccess();
    const existing = access ? await getAccessibleRequest(access, id) : null;
    if (!access || !canManageRequests(access) || !existing) return unauthorized;
    const actor = await getActorSnapshot(access);

    // Delete child records (status updates) first, then the request in one atomic database execution
    const result = await db.execute(sql`
      WITH deleted_status_updates AS (
        DELETE FROM request_status_updates
        WHERE request_id = ${id}
        RETURNING id
      ),
      deleted_request AS (
        DELETE FROM requests
        WHERE id = ${id}
          AND (SELECT COUNT(*) FROM deleted_status_updates) >= 0
        RETURNING id, capdev_id, setting, requestor_name
      ),
      inserted_audit AS (
        INSERT INTO audit_logs (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, details)
        SELECT ${actor.actorId}, ${actor.actorName}, ${actor.actorEmail}, 'deleted', 'request', deleted_request.id::text, 'Request #' || deleted_request.id,
          jsonb_build_object('capdevId', deleted_request.capdev_id, 'capdevAipCode', capdev.aip_code, 'setting', deleted_request.setting, 'requestorName', deleted_request.requestor_name)
        FROM deleted_request
        INNER JOIN capdevs AS capdev ON capdev.id = deleted_request.capdev_id
        RETURNING id
      )
      SELECT id FROM inserted_audit
    `);
    if (result.rows.length === 0) return { success: false, error: 'Request not found.' };
    return { success: true };
  } catch (error) {
    console.error('Failed to delete request:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export type StatusUpdateInput = {
  requestId: number;
  userId: string;
  statusUpdate: string;
  remarks?: string;
  files: StatusAttachment[];
  statusMark?: 'pending' | 'denied' | 'accepted' | 'completed' | null;
  markAsComplete?: boolean;
  subtractsRequestedAmount?: boolean;
  deductedAmount?: string;
  isStopperResponse?: boolean;
  stopperId?: number;
};

export type StopRequestInput = { requestId: number; reason: string; files: StatusAttachment[] };

export type StatusAttachment = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
};

const MAX_STATUS_ATTACHMENTS = 10;
const MAX_STATUS_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function getGoogleDriveAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken || !process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID) {
    throw new Error('Google Drive storage is not configured.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Unable to authorize Google Drive storage.');

  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error('Google Drive did not return an access token.');
  return token.access_token;
}

async function uploadFileToGoogleDrive(file: File, accessToken: string): Promise<StatusAttachment> {
  const boundary = `leaprs-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    await file.arrayBuffer(),
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (!response.ok) {
    console.error('Google Drive file upload failed:', response.status, await response.text());
    throw new Error(`Google Drive could not upload “${file.name}”.`);
  }

  const uploaded = await response.json() as { id?: string; name?: string; mimeType?: string; webViewLink?: string };
  if (!uploaded.id || !uploaded.name) throw new Error(`Google Drive did not return a file for “${file.name}”.`);
  return {
    id: uploaded.id,
    name: uploaded.name,
    mimeType: uploaded.mimeType || file.type || 'application/octet-stream',
    url: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`,
  };
}

export async function uploadFilesToGoogleDrive(formData: FormData) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return { ...unauthorized, files: [] as StatusAttachment[] };

    const files = formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > MAX_STATUS_ATTACHMENTS) return { success: false, error: `You can attach up to ${MAX_STATUS_ATTACHMENTS} files at once.`, files: [] as StatusAttachment[] };
    if (files.reduce((total, file) => total + file.size, 0) > MAX_STATUS_ATTACHMENT_BYTES) return { success: false, error: 'Attachments must total 20 MB or less.', files: [] as StatusAttachment[] };
    if (files.length === 0) return { success: true, files: [] as StatusAttachment[] };

    const accessToken = await getGoogleDriveAccessToken();
    const uploadedFiles = await Promise.all(files.map((file) => uploadFileToGoogleDrive(file, accessToken)));
    return { success: true, files: uploadedFiles };
  } catch (error) {
    console.error('Failed to upload status update files:', error);
    return { success: false, error: error instanceof Error ? error.message : 'File upload failed.', files: [] as StatusAttachment[] };
  }
}

export async function getRequestStatusUpdates(requestId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !await getAccessibleRequest(access, requestId)) return [];
    return await db.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.requestId, requestId)).orderBy(requestStatusUpdates.createdAt);
  } catch (error) {
    console.error('Failed to fetch request status updates:', error);
    return [];
  }
}

async function ensureRequestEvaluationForms(request: typeof requests.$inferSelect) {
  const [capdev] = await db.select({ aipCode: capdevs.aipCode }).from(capdevs).where(eq(capdevs.id, request.capdevId)).limit(1);
  if (!capdev) throw new Error('The request CapDev project was not found.');

  let participantFeedbackFormId = request.participantFeedbackFormId;
  let participantFeedbackFormUrl = request.participantFeedbackFormUrl;
  let supervisorEvaluationFormId = request.supervisorEvaluationFormId;
  let supervisorEvaluationFormUrl = request.supervisorEvaluationFormUrl;

  if (!participantFeedbackFormId || !participantFeedbackFormUrl) {
    const form = await createRequestEvaluationForm({ kind: 'participant', requestId: request.id, aipCode: capdev.aipCode });
    participantFeedbackFormId = form.formId;
    participantFeedbackFormUrl = form.responderUrl;
    await db.update(requests).set({ participantFeedbackFormId, participantFeedbackFormUrl }).where(eq(requests.id, request.id));
  }

  if (!supervisorEvaluationFormId || !supervisorEvaluationFormUrl) {
    const form = await createRequestEvaluationForm({ kind: 'supervisor', requestId: request.id, aipCode: capdev.aipCode });
    supervisorEvaluationFormId = form.formId;
    supervisorEvaluationFormUrl = form.responderUrl;
    await db.update(requests).set({ supervisorEvaluationFormId, supervisorEvaluationFormUrl }).where(eq(requests.id, request.id));
  }

  return {
    participantFeedbackFormId,
    participantFeedbackFormUrl,
    supervisorEvaluationFormId,
    supervisorEvaluationFormUrl,
  };
}

export async function getOrCreateRequestEvaluationForms(requestId: number) {
  try {
    const access = await getCurrentAccess();
    const request = access ? await getAccessibleRequest(access, requestId) : null;
    if (!request) return { success: false as const, error: unauthorized.error };
    if (request.status !== 'completed') return { success: false as const, error: 'Evaluation forms are available after completion.' };
    const forms = await ensureRequestEvaluationForms(request);
    return { success: true as const, forms };
  } catch (error) {
    console.error('Failed to prepare request evaluation forms:', error);
    return { success: false as const, error: error instanceof Error ? error.message : 'Unable to generate evaluation forms.' };
  }
}

export async function getRequestEvaluationSummary(
  requestId: number,
  kind: 'participant' | 'supervisor',
): Promise<{ success: true; summary: EvaluationSummary } | { success: false; error: string }> {
  try {
    const access = await getCurrentAccess();
    const request = access ? await getAccessibleRequest(access, requestId) : null;
    if (!request) return { success: false, error: unauthorized.error };
    if (request.status !== 'completed') return { success: false, error: 'Evaluation summaries are available after completion.' };
    const forms = await ensureRequestEvaluationForms(request);
    const formId = kind === 'participant' ? forms.participantFeedbackFormId : forms.supervisorEvaluationFormId;
    if (!formId) return { success: false, error: 'The evaluation form is unavailable.' };
    return { success: true, summary: await getEvaluationSummary(formId) };
  } catch (error) {
    console.error('Failed to generate request evaluation summary:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unable to generate the evaluation summary.' };
  }
}

export async function updateRequestStatus(requestId: number, status: 'completed' | 'denied') {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return unauthorized;
    const req = await getAccessibleRequest(access, requestId);
    if (!req) return unauthorized;

    const forms = status === 'completed' ? await ensureRequestEvaluationForms(req) : null;

    await db
      .update(requests)
      .set({
        status,
        updatedById: access.userId,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, requestId));

    await writeAuditLog(access, { action: 'status_changed', entityType: 'request', entityId: requestId, entityLabel: `Request #${requestId}`, details: { capdevId: req.capdevId, status } });

    void createNotification({
      actorId: access.userId,
      userId: req.userId || null,
      capdevId: req.capdevId,
      requestId,
      title: `Request #${requestId} ${status === 'completed' ? 'Completed' : 'Denied'}`,
      message: `Request #${requestId} was resolved as ${status}.`,
      link: `/admin/capdev/${req.capdevId}/requests/${requestId}/status`,
      type: status,
    });

    return { success: true, forms };
  } catch (error) {
    console.error('Failed to update request status:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database update failed' };
  }
}

export async function stopRequestProgress(data: StopRequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canControlRequestStop(access) || !await getAccessibleRequest(access, data.requestId)) return unauthorized;
    if (!data.reason.trim()) return { success: false, error: 'A stopper reason is required.' };
    const { data: session } = await auth.getSession();
    const [request] = await db.select().from(requests).where(eq(requests.id, data.requestId)).limit(1);
    if (!request || request.status === 'completed' || request.status === 'denied') return { success: false, error: 'This request is already concluded.' };
    if (request.isStopped) return { success: false, error: 'This request is already stopped.' };

    const [stopper] = await db.insert(requestStatusUpdates).values({
      requestId: data.requestId,
      userId: access.userId,
      authorName: session?.user?.name || session?.user?.email || 'Staff member',
      statusUpdate: data.reason.trim(),
      files: data.files || [],
      isStopper: true,
    }).returning();
    await db.update(requests).set({ isStopped: true, activeStopperId: stopper.id, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, data.requestId));
    await writeAuditLog(access, { action: 'stopped', entityType: 'request', entityId: data.requestId, entityLabel: `Request #${data.requestId}`, details: { reason: data.reason.trim(), statusUpdateId: stopper.id } });
    void createNotification({
      actorId: access.userId,
      userId: request.userId,
      capdevId: request.capdevId,
      requestId: data.requestId,
      title: `Request #${data.requestId} Stopped`,
      message: `${session?.user?.name || session?.user?.email || 'Staff'} stopped progress: ${data.reason.trim().slice(0, 90)}`,
      link: `/admin/capdev/${request.capdevId}/requests/${data.requestId}/status`,
      type: 'status_update',
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to stop request progress:', error);
    return { success: false, error: 'Unable to stop request progress.' };
  }
}

export async function resumeRequestProgress(requestId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canControlRequestStop(access) || !await getAccessibleRequest(access, requestId)) return unauthorized;
    const { data: session } = await auth.getSession();
    const [request] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    if (!request?.isStopped || !request.activeStopperId) return { success: false, error: 'This request is not stopped.' };
    await db.insert(requestStatusUpdates).values({ requestId, userId: access.userId, authorName: session?.user?.name || session?.user?.email || 'Staff member', statusUpdate: 'Progress resumed.', isResume: true, stopperId: request.activeStopperId });
    await db.update(requests).set({ isStopped: false, activeStopperId: null, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, requestId));
    await writeAuditLog(access, { action: 'resumed', entityType: 'request', entityId: requestId, entityLabel: `Request #${requestId}`, details: { stopperId: request.activeStopperId } });
    void createNotification({
      actorId: access.userId,
      userId: request.userId,
      capdevId: request.capdevId,
      requestId,
      title: `Request #${requestId} Resumed`,
      message: `${session?.user?.name || session?.user?.email || 'Staff'} resumed progress.`,
      link: `/admin/capdev/${request.capdevId}/requests/${requestId}/status`,
      type: 'status_update',
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to resume request progress:', error);
    return { success: false, error: 'Unable to resume request progress.' };
  }
}

export async function createRequestStatusUpdate(data: StatusUpdateInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access) || !await getAccessibleRequest(access, data.requestId)) return unauthorized;
    const { data: session } = await auth.getSession();

    // Check if request is already concluded (completed or denied)
    const existingReq = await db.select().from(requests).where(eq(requests.id, data.requestId)).limit(1);
    if (!existingReq[0] || existingReq[0].status === 'completed' || existingReq[0].status === 'denied') {
      return { success: false, error: 'This request is already concluded. No further updates can be added.' };
    }

    const isStopperResponse = Boolean(data.isStopperResponse);
    if (existingReq[0].isStopped) {
      if (access.role !== 'employee' || !isStopperResponse || data.stopperId !== existingReq[0].activeStopperId) {
        return { success: false, error: 'Only an employee response to the active stopper can be added while progress is stopped.' };
      }
    } else if (isStopperResponse) {
      return { success: false, error: 'This request is not currently stopped.' };
    }

    if (!isStopperResponse && (!data.statusMark || !['pending', 'completed', 'denied', 'accepted'].includes(data.statusMark))) {
      return { success: false, error: 'A valid status mark (Pending, Completed, or Denied) is required for every status update.' };
    }

    // 1. Handle budget deduction if requested
    if (data.subtractsRequestedAmount && !isStopperResponse) {
      const [alreadyDeducted] = await db
        .select({ id: requestStatusUpdates.id })
        .from(requestStatusUpdates)
        .where(and(eq(requestStatusUpdates.requestId, data.requestId), eq(requestStatusUpdates.subtractsRequestedAmount, true)))
        .limit(1);

      if (alreadyDeducted) {
        return { success: false, error: 'Budget has already been deducted for this request.' };
      }

      const [capdev] = await db
        .select({ budget: capdevs.budget })
        .from(capdevs)
        .where(eq(capdevs.id, existingReq[0].capdevId))
        .limit(1);

      const amountToDeduct = data.deductedAmount && Number(data.deductedAmount) > 0
        ? String(data.deductedAmount)
        : String(existingReq[0].requestedBudget);

      if (!capdev || Number(capdev.budget) < Number(amountToDeduct)) {
        return { success: false, error: 'Insufficient CapDev budget balance to deduct.' };
      }

      // Deduct from CapDev budget
      await db
        .update(capdevs)
        .set({
          budget: sql`${capdevs.budget} - ${amountToDeduct}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(capdevs.id, existingReq[0].capdevId));

      // Update request's requested budget with final utilized amount
      await db
        .update(requests)
        .set({
          requestedBudget: amountToDeduct,
          updatedAt: new Date(),
        })
        .where(eq(requests.id, data.requestId));
    }
    // 2. Insert status update log
    const [createdUpdate] = await db.insert(requestStatusUpdates).values({
      requestId: data.requestId,
      userId: access.userId,
      authorName: session?.user?.name || session?.user?.email || 'Staff member',
      statusUpdate: data.statusUpdate,
      remarks: data.remarks || null,
      files: data.files || [],
      statusMark: data.statusMark || null,
      markAsComplete: Boolean(data.markAsComplete),
      subtractsRequestedAmount: Boolean(data.subtractsRequestedAmount),
      isStopperResponse,
      stopperId: isStopperResponse ? data.stopperId : null,
    }).returning({ id: requestStatusUpdates.id });

    await writeAuditLog(access, {
      action: 'created',
      entityType: 'status_update',
      entityId: createdUpdate.id,
      entityLabel: `Status update for Request #${data.requestId}`,
      details: {
        requestId: data.requestId,
        capdevId: existingReq[0].capdevId,
        statusMark: data.statusMark || null,
        isStopperResponse,
        subtractsRequestedAmount: Boolean(data.subtractsRequestedAmount),
        deductedAmount: data.subtractsRequestedAmount ? (data.deductedAmount || existingReq[0].requestedBudget) : null,
      },
    });

    // 3. Send notification (notifies request owner or other staff, never the actor who posted the status update)
    void createNotification({
      actorId: access.userId,
      userId: existingReq[0].userId !== access.userId ? existingReq[0].userId : null,
      capdevId: existingReq[0].capdevId,
      requestId: data.requestId,
      title: data.statusMark
        ? `Request #${data.requestId} Update: [${data.statusMark.toUpperCase()}]`
        : `Status Update on Request #${data.requestId}`,
      message: `${session?.user?.name || session?.user?.email || 'Staff'}: ${data.statusUpdate.slice(0, 90)}`,
      link: `/admin/capdev/${existingReq[0].capdevId}/requests/${data.requestId}/status`,
      type: 'status_update',
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to create request status update:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database insert failed' };
  }
}

export type NotificationItem = {
  id: number;
  userId: string | null;
  actorId?: string | null;
  title: string;
  message: string;
  link: string;
  type: string;
  isRead: boolean;
  createdAt: Date | string;
};

const REQUEST_NOTIFICATION_TYPES = ['new_request', 'status_update', 'completed', 'denied'];
const ALL_NOTIFICATION_TYPES = ['capdev_created', ...REQUEST_NOTIFICATION_TYPES];
const OWNER_NOTIFICATION_TYPES = ['status_update', 'completed', 'denied'];

function notificationAudienceCondition(access: UserAccess): SQL {
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
    isInvolved = and(
      inArray(notifications.type, REQUEST_NOTIFICATION_TYPES),
      eq(capdevs.department, access.department),
    )!;
  } else if (access.role === 'viewer') {
    isInvolved = and(
      inArray(notifications.type, ALL_NOTIFICATION_TYPES),
      eq(capdevs.department, access.department),
    )!;
  } else {
    isInvolved = inArray(notifications.type, ALL_NOTIFICATION_TYPES);
  }

  return and(hasLiveRecord, isAnotherUsersAction, isInvolved)!;
}

export async function getNotifications(): Promise<{ success: boolean; notifications: NotificationItem[]; unreadCount: number }> {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false, notifications: [], unreadCount: 0 };

    const userReads = await db.select({ notificationId: notificationReads.notificationId })
      .from(notificationReads)
      .where(eq(notificationReads.userId, access.userId));
    const readIds = new Set(userReads.map(r => r.notificationId));

    const rows = await db.select({ notification: getTableColumns(notifications) })
      .from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .where(notificationAudienceCondition(access))
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    const formatted: NotificationItem[] = rows.map(({ notification: n }) => ({
      id: n.id,
      userId: n.userId,
      actorId: n.actorId,
      title: n.title,
      message: n.message,
      link: n.link,
      type: n.type,
      isRead: n.isRead || readIds.has(n.id),
      createdAt: n.createdAt,
    }));

    const unreadCount = formatted.filter(n => !n.isRead).length;

    return { success: true, notifications: formatted, unreadCount };
  } catch (error) {
    console.error('Failed to get notifications:', error);
    return { success: false, notifications: [], unreadCount: 0 };
  }
}

export async function markNotificationAsRead(notificationId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false };

    const [visibleNotification] = await db.select({ id: notifications.id })
      .from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .where(and(eq(notifications.id, notificationId), notificationAudienceCondition(access)))
      .limit(1);
    if (!visibleNotification) return { success: false };

    await db.insert(notificationReads).values({
      notificationId,
      userId: access.userId,
    }).onConflictDoNothing();

    return { success: true };
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    return { success: false };
  }
}

export async function markAllNotificationsAsRead() {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false };

    const unreadRows = await db.select({ id: notifications.id })
      .from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .where(notificationAudienceCondition(access));

    for (const item of unreadRows) {
      await db.insert(notificationReads).values({
        notificationId: item.id,
        userId: access.userId,
      }).onConflictDoNothing();
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    return { success: false };
  }
}

async function createNotification(data: {
  userId?: string | null;
  actorId?: string | null;
  capdevId?: number | null;
  requestId?: number | null;
  title: string;
  message: string;
  link: string;
  type?: string;
}) {
  try {
    const [created] = await db.insert(notifications).values({
      userId: data.userId || null,
      actorId: data.actorId || null,
      capdevId: data.capdevId || null,
      requestId: data.requestId || null,
      title: data.title,
      message: data.message,
      link: data.link,
      type: data.type || 'status_update',
    }).returning();
    return { success: true, notification: created };
  } catch (error) {
    console.error('Failed to create notification:', error);
    return { success: false };
  }
}

export async function requestPasswordReset(rawEmail: string) {

  try {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      return { success: false, error: 'Please enter your email address.' };
    }

    // Check if user exists in neon_auth.user
    const userResult = await db.execute(sql`
      SELECT id, email FROM neon_auth.user WHERE LOWER(email) = ${email} LIMIT 1
    `);

    if (userResult.rows.length === 0) {
      return { success: false, error: 'No account found with this email address.' };
    }

    const matchedEmail = String(userResult.rows[0].email);

    // Generate 6-digit numeric verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity

    // Remove any previous active reset codes for this email
    await db.delete(passwordResets).where(eq(passwordResets.email, email));

    // Save reset code
    await db.insert(passwordResets).values({
      email,
      code,
      expiresAt,
    });

    // Send plain text email via Resend
    await sendPasswordResetEmail(matchedEmail, code);

    return {
      success: true,
      message: 'A 6-digit verification code has been sent to your email address.',
    };
  } catch (error: any) {
    console.error('Password reset request failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send password reset email. Please try again.',
    };
  }
}

export async function verifyAndResetPassword(rawEmail: string, rawCode: string, newPassword: string) {
  try {
    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();

    if (!email || !code || !newPassword) {
      return { success: false, error: 'Please fill in all required fields.' };
    }

    if (newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    // Check code in database
    const [resetRecord] = await db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.email, email), eq(passwordResets.code, code)))
      .limit(1);

    if (!resetRecord) {
      return { success: false, error: 'Invalid verification code.' };
    }

    if (new Date() > resetRecord.expiresAt) {
      await db.delete(passwordResets).where(eq(passwordResets.id, resetRecord.id));
      return { success: false, error: 'Verification code has expired. Please request a new one.' };
    }

    // Find the user ID in neon_auth.user
    const userResult = await db.execute(sql`
      SELECT id FROM neon_auth.user WHERE LOWER(email) = ${email} LIMIT 1
    `);

    if (userResult.rows.length === 0) {
      return { success: false, error: 'User account not found.' };
    }

    const userId = String(userResult.rows[0].id);
    const hashedPassword = await hashPassword(newPassword);

    // Update the password in neon_auth.account
    await db.execute(sql`
      UPDATE neon_auth.account
      SET password = ${hashedPassword},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
    `);

    // Invalidate existing sessions for this user so they log in fresh
    await db.execute(sql`
      DELETE FROM neon_auth.session
      WHERE "userId" = ${userId}
    `);

    // Delete used reset record
    await db.delete(passwordResets).where(eq(passwordResets.email, email));

    return { success: true, message: 'Password has been successfully updated.' };
  } catch (error: any) {
    console.error('Password reset failed:', error);
    return { success: false, error: error.message || 'Failed to reset password.' };
  }
}
