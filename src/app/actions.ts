'use server';

import { db } from '@/db';
import { connections, users, capdevs, capdevFieldDefinitions, requestFieldDefinitions, requests, requestStatusUpdates } from '@/db/schema';
import { sql, count, eq, getTableColumns } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';

export interface DbStatus {
  success: boolean;
  latencyMs?: number;
  testedAt?: string;
  writeSuccess?: boolean;
  totalChecks?: number;
  errorMessage?: string;
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
    return await db.select().from(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return [];
  }
}

export async function updateUserRole(userId: string, newRole: string) {
  try {
    await db.update(users).set({ role: newRole }).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error('Failed to update user role:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function createUser(userId: string, role: string) {
  try {
    await db.insert(users).values({
      id: userId,
      role: role,
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to create user in DB:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function deleteUser(userId: string) {
  try {
    await db.delete(users).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error('Failed to delete user from DB:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export type CapdevInput = {
  aipCode: string;
  budget: string;
  department: string;
  startDate: string;
  endDate: string;
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
    return await db.select().from(capdevs).orderBy(capdevs.aipCode);
  } catch (error) {
    console.error('Failed to fetch CapDev projects:', error);
    return [];
  }
}

export async function createCapdev(data: CapdevInput) {
  try {
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [created] = await db.insert(capdevs).values(data).returning();
    return { success: true, capdev: created };
  } catch (error) {
    console.error('Failed to create CapDev project:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateCapdev(id: number, data: CapdevInput) {
  try {
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [updated] = await db
      .update(capdevs)
      .set({ ...data, updatedAt: new Date() })
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
    const [capdev] = await db.select().from(capdevs).where(eq(capdevs.id, id)).limit(1);
    return capdev ?? null;
  } catch (error) {
    console.error('Failed to fetch CapDev project:', error);
    return null;
  }
}

export async function deleteCapdev(id: number) {
  try {
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
  requestedBudget: string;
  startDate: string;
  endDate: string;
  additionalInfo: Record<string, unknown>;
  updatedById: string;
};

export async function getRequestsByCapdev(capdevId: number) {
  try {
    return await db
      .select({
        ...getTableColumns(requests),
        isComplete: sql<boolean>`EXISTS (
          SELECT 1 FROM request_status_updates
          WHERE request_status_updates.request_id = ${requests.id}
            AND request_status_updates.mark_as_complete = true
        )`,
      })
      .from(requests)
      .where(eq(requests.capdevId, capdevId))
      .orderBy(requests.createdAt);
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    return [];
  }
}

export async function getRequestById(id: number) {
  try {
    const [request] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
    return request ?? null;
  } catch (error) {
    console.error('Failed to fetch request:', error);
    return null;
  }
}

export async function createRequest(data: RequestInput) {
  try {
    const { data: session } = await auth.getSession();
    if (!session?.user) return { success: false, error: 'You must be signed in to create a request.' };

    const [created] = await db.insert(requests).values({
      ...data,
      userId: session.user.id,
      updatedById: session.user.id,
      requestorName: session.user.name || session.user.email || 'Requestor',
    }).returning();
    return { success: true, request: created };
  } catch (error) {
    console.error('Failed to create request:', error);
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateRequest(id: number, data: RequestInput) {
  try {
    const [updated] = await db.update(requests).set({ ...data, updatedAt: new Date() }).where(eq(requests.id, id)).returning();
    return { success: true, request: updated };
  } catch (error) {
    console.error('Failed to update request:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function deleteRequest(id: number) {
  try {
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
    const { data: session } = await auth.getSession();
    if (!session?.user) return { success: false, error: 'You must be signed in to upload files.', files: [] as StatusAttachment[] };

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
    return await db.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.requestId, requestId)).orderBy(requestStatusUpdates.createdAt);
  } catch (error) {
    console.error('Failed to fetch request status updates:', error);
    return [];
  }
}

export async function createRequestStatusUpdate(data: StatusUpdateInput) {
  try {
    const { data: session } = await auth.getSession();
    if (!session?.user) return { success: false, error: 'You must be signed in to add a status update.' };
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
          ${session.user.id},
          ${session.user.name || session.user.email || 'Staff member'},
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
        RETURNING capdevs.id
      )
      SELECT request_id FROM inserted_update
    `);
    if (result.rows.length === 0) throw new Error('This request is already complete or no longer exists');
    return { success: true };
  } catch (error) {
    console.error('Failed to create request status update:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database insert failed' };
  }
}
