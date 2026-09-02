'use server';

import { db } from '@/db';
import { connections, users, capdevs, capdevFieldDefinitions, requestFieldDefinitions, requests, requestStatusUpdates } from '@/db/schema';
import { sql, count, and, eq, getTableColumns } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
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

export type AppRole = 'admin' | 'employee' | 'viewer' | 'viewer-full';
export type UserAccess = { userId: string; role: AppRole; department: string };

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'viewer', 'viewer-full'];
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

function canAccessCapdev(access: UserAccess, capdev: { department: string }) {
  return access.role === 'admin' || access.role === 'viewer-full' || access.role === 'employee' || capdev.department === access.department;
}

async function getAccessibleCapdev(access: UserAccess, capdevId: number) {
  const [capdev] = await db.select().from(capdevs).where(eq(capdevs.id, capdevId)).limit(1);
  return capdev && canAccessCapdev(access, capdev) ? capdev : null;
}

async function getAccessibleRequest(access: UserAccess, requestId: number) {
  const [record] = await db.select({ request: getTableColumns(requests), capdevDepartment: capdevs.department }).from(requests).innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(eq(requests.id, requestId)).limit(1);
  if (!record) return null;
  if (access.role === 'employee') return record.request.userId === access.userId ? record.request : null;
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

    // Determine role. If email has "admin", set to admin. Else employee.
    const role = email.toLowerCase().includes('admin') ? 'admin' : 'employee';

    await db.insert(users).values({
      id: userId,
      role: role,
    });

    return role;
  } catch (error) {
    console.error('Error fetching or creating user role:', error);
    return email.toLowerCase().includes('admin') ? 'admin' : 'employee';
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

export async function updateUserRole(userId: string, newRole: string, department?: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin' || !VALID_ROLES.includes(newRole as AppRole)) return unauthorized;
    await db.update(users).set({ role: newRole, ...(department ? { department } : {}) }).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error('Failed to update user role:', error);
    return { success: false, error: 'Database update failed' };
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
    return { success: true };
  } catch (error) {
    console.error('Failed to create user in DB:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function deleteUser(userId: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin' || access.userId === userId) return unauthorized;
    await db.delete(users).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error('Failed to delete user from DB:', error);
    return { success: false, error: 'Database delete failed' };
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
    if (!access || access.role === 'employee') return { capdevs: [], requests: [], statusUpdates: [] };
    const [capdevData, requestData, statusUpdateData] = await Promise.all([
      db.select({ id: capdevs.id, department: capdevs.department, initialBudget: capdevs.initialBudget, budget: capdevs.budget, createdAt: capdevs.createdAt }).from(capdevs),
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
    if (!access || access.role === 'employee') return { capdevs: [], requests: [], capdevFields: [], requestFields: [] };
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
    if (!access || access.role === 'employee') return unauthorized;
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
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [created] = await db.insert(capdevs).values({ ...data, updatedById: access.userId, initialBudget: data.budget }).returning();
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
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [updated] = await db
      .update(capdevs)
      .set({ aipCode: data.aipCode, description: data.description, department: data.department, additionalInfo: data.additionalInfo, updatedById: access.userId, updatedAt: new Date() })
      .where(eq(capdevs.id, id))
      .returning();
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
        RETURNING id
      )
      SELECT id FROM deleted_capdev
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
    if (!access || access.role === 'employee') return { capdevFieldsCount: 0, requestFieldsCount: 0 };
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
    await db
      .update(capdevFieldDefinitions)
      .set({
        isActive: false,
        updatedById: updatedById,
        updatedAt: new Date(),
      })
      .where(eq(capdevFieldDefinitions.id, id));
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
    await db
      .update(requestFieldDefinitions)
      .set({ isActive: false, updatedById, updatedAt: new Date() })
      .where(eq(requestFieldDefinitions.id, id));
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
    if (!access || (access.role !== 'admin' && access.role !== 'employee')) return unauthorized;
    if (!await getAccessibleCapdev(access, data.capdevId)) return unauthorized;
    const { data: session } = await auth.getSession();

    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, data.capdevId)).limit(1);
    if (!capdev || Number(data.requestedBudget) > Number(capdev.budget)) return { success: false, error: 'Requested budget exceeds the remaining CapDev budget.' };
    const [created] = await db.insert(requests).values({
      ...data,
      userId: access.userId,
      updatedById: access.userId,
      requestorName: session?.user?.name || session?.user?.email || 'Requestor',
    }).returning();
    return { success: true, request: created };
  } catch (error) {
    console.error('Failed to create request:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateRequest(id: number, data: RequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || (access.role !== 'admin' && access.role !== 'employee')) return unauthorized;
    const existing = await getAccessibleRequest(access, id);
    if (!existing) return { success: false, error: 'Request not found.' };
    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, existing.capdevId)).limit(1);
    const [deduction] = await db.select({ id: requestStatusUpdates.id }).from(requestStatusUpdates).where(and(eq(requestStatusUpdates.requestId, id), eq(requestStatusUpdates.subtractsRequestedAmount, true))).limit(1);
    if (deduction && Number(data.requestedBudget) !== Number(existing.requestedBudget)) return { success: false, error: 'Requested budget cannot be changed after it has been deducted.' };
    if (!deduction && (!capdev || Number(data.requestedBudget) > Number(capdev.budget))) return { success: false, error: 'Requested budget exceeds the remaining CapDev budget.' };
    const [updated] = await db.update(requests).set({ ...data, capdevId: existing.capdevId, userId: existing.userId, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, id)).returning();
    return { success: true, request: updated };
  } catch (error) {
    console.error('Failed to update request:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function deleteRequest(id: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || (access.role !== 'admin' && access.role !== 'employee') || !await getAccessibleRequest(access, id)) return unauthorized;
    await db.delete(requests).where(eq(requests.id, id));
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
  markAsComplete: boolean;
  subtractsRequestedAmount: boolean;
};

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
    if (!access || (access.role !== 'admin' && access.role !== 'employee')) return { ...unauthorized, files: [] as StatusAttachment[] };

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

export async function createRequestStatusUpdate(data: StatusUpdateInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || (access.role !== 'admin' && access.role !== 'employee') || !await getAccessibleRequest(access, data.requestId)) return unauthorized;
    const { data: session } = await auth.getSession();
    // Neon HTTP does not implement Drizzle's callback transaction API. This single
    // PostgreSQL statement is still atomic: it creates the update and applies the
    // optional budget deduction together, or applies neither one.
    const result = await db.execute(sql`
      WITH target_request AS (
        SELECT id, capdev_id, requested_budget
        FROM requests
        WHERE id = ${data.requestId}
      ),
      inserted_update AS (
        INSERT INTO request_status_updates (
          request_id, user_id, author_name, status_update, remarks, files,
          mark_as_complete, subtracts_requested_amount
        )
        SELECT
          target_request.id,
          ${access.userId},
          ${session?.user?.name || session?.user?.email || 'Staff member'},
          ${data.statusUpdate},
          ${data.remarks || null},
          ${JSON.stringify(data.files)}::jsonb,
          ${data.markAsComplete},
          ${data.subtractsRequestedAmount}
        FROM target_request
        WHERE NOT EXISTS (
          SELECT 1
          FROM request_status_updates
          WHERE request_id = ${data.requestId}
            AND mark_as_complete = true
        )
        AND (
          ${data.subtractsRequestedAmount} = false
          OR EXISTS (
            SELECT 1 FROM capdevs
            WHERE capdevs.id = target_request.capdev_id
              AND capdevs.budget >= target_request.requested_budget
          )
        )
        RETURNING request_id, subtracts_requested_amount
      ),
      deducted_budget AS (
        UPDATE capdevs
        SET budget = capdevs.budget - target_request.requested_budget,
            updated_at = NOW()
        FROM target_request
        JOIN inserted_update ON inserted_update.request_id = target_request.id
        WHERE capdevs.id = target_request.capdev_id
          AND inserted_update.subtracts_requested_amount = true
          AND capdevs.budget >= target_request.requested_budget
        RETURNING capdevs.id
      )
      SELECT request_id FROM inserted_update
    `);
    if (result.rows.length === 0) throw new Error('This request is already complete, no longer exists, or exceeds the remaining CapDev budget.');
    return { success: true };
  } catch (error) {
    console.error('Failed to create request status update:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database insert failed' };
  }
}
