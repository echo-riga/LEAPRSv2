'use server';

import { db } from '@/db';
import { isPendingAttachment, validatePendingAttachments, replacePendingAttachment, reconcilePendingAttachments, type UploadTarget } from '@/lib/background-attachments';
import { notificationAudienceCondition } from '@/lib/notification-audience';
import { requestNotificationWording } from '@/lib/notification-wording';
import { scheduleNotificationEmails } from '@/lib/notification-email';
import { insertNotificationEvent } from '@/lib/notification-events';
import { requestAccessScope } from '@/lib/access-scope';
import { emailNotificationPreferences } from '@/db/schema';
import { DEFAULT_EMAIL_TYPES, validateEmailTypes } from '@/lib/notification-types';
import { withTransaction, type Transaction } from '@/db/transaction';
import { requestStorageFolders, mcpOAuthGrants } from '@/db/schema';
import { deleteRequestRecords } from '@/lib/request-deletion';
import { writeRequestStatusUpdate } from '@/lib/request-budget';
import { validateRequestInput, validateMoney } from '@/lib/request-validation';
import { claimRequestFolder } from '@/lib/request-storage';
import { limitVerification, verificationCode, verificationHash, consumeRateLimit } from '@/lib/security';
import { manilaDate, manilaDateBoundary } from '@/lib/manila-date';
import { auditChanges, requestLabel } from '@/lib/audit-description';
import { ARCHIVED_READ_ONLY, isArchiveReadOnly } from '@/lib/archive-policy';
import { isAllowedSignupEmail, SIGNUP_EMAIL_ERROR } from '@/lib/signup-email';
import { connections, users, systemSettings, roleApprovalRequests, capdevs, capdevFieldDefinitions, requestFieldDefinitions, statusUpdateFieldDefinitions, requests, requestStatusUpdates, passwordResets, signupVerifications, notifications, notificationReads, auditLogs } from '@/db/schema';
import { sql, count, and, eq, getTableColumns, lte, gte, asc, desc, or, isNull, isNotNull, ilike, inArray, type SQL } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { sendPasswordResetEmail, sendSignupVerificationEmail } from '@/lib/email';
import {
  createRequestEvaluationForm,
  getEvaluationSummary,
  isLegacyRequestEvaluationForm,
  type EvaluationSummary,
} from '@/lib/google-forms';
import { hashPassword } from 'better-auth/crypto';
import { getPasswordValidationError } from '@/lib/password-validation';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { getRequestInactivitySummaries, readInactivityDays, syncRequestReminders } from '@/lib/request-reminders';
import { DEFAULT_INACTIVITY_DAYS, INACTIVITY_SETTING_KEY, inactivityMessage, validInactivityDays } from '@/lib/request-inactivity';
import { getDynamicFieldValue, getInvalidComboboxFields, hasComboboxOptions } from '@/lib/dynamic-fields';
import { PORTAL_CHATBOT_GUIDE } from '@/lib/portal-chatbot-guide';
import {
  findCapdevByAipCodeService,
  getRequestFormSchemaService,
  createRequestDraftService,
  submitRequestService,
  type RequestDraftInput,
  type RequestSubmissionInput,
} from '@/lib/services/leaprs-service';
import {
  extractActivityDesignWithGemini,
  type ActivityDesignFileInput,
} from '@/lib/gemini-activity-design';
import { executeMcpTool, LEAPRS_MCP_TOOLS } from '@/lib/mcp/server';

export interface DbStatus {
  success: boolean;
  latencyMs?: number;
  testedAt?: string;
  writeSuccess?: boolean;
  totalChecks?: number;
  errorMessage?: string;
}

export type AppRole = 'admin' | 'employee' | 'employee-department' | 'viewer' | 'viewer-full';
export type UserAccess = { userId: string; role: AppRole; department: string; name?: string; email?: string };

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'];
const SELF_REGISTRATION_ROLES = ['employee', 'employee-department', 'viewer', 'viewer-full'] as const;
const unauthorized = { success: false as const, error: 'You do not have permission to perform this action.' };
const MAINTENANCE_MODE_KEY = 'maintenance_mode';

async function readMaintenanceMode() {
  const [setting] = await db
    .select({ enabled: systemSettings.enabled })
    .from(systemSettings)
    .where(eq(systemSettings.key, MAINTENANCE_MODE_KEY))
    .limit(1);
  return setting?.enabled ?? false;
}

async function getCurrentAccess(): Promise<UserAccess | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  const [storedUser] = await db.select({ role: users.role, department: users.department, archivedAt: users.archivedAt }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!storedUser || storedUser.archivedAt) return null;
  const role = VALID_ROLES.includes(storedUser.role as AppRole) ? storedUser.role as AppRole : 'employee';
  if (role !== 'admin' && await readMaintenanceMode()) return null;
  return {
    userId: session.user.id,
    role,
    department: storedUser.department,
    name: session.user.name || session.user.email || 'LEAPRS User',
    email: session.user.email || undefined,
  };
}

export async function askPortalChatbot(message: string, history: Array<{ sender: 'assistant' | 'user'; text: string }> = []) {
  const access = await getCurrentAccess();
  const question = message.trim();
  if (!access) return { success: false as const, error: unauthorized.error };
  if (!question || question.length > 1200) return { success: false as const, error: 'Enter a question of up to 1,200 characters.' };

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return { success: false as const, error: 'The help service is not configured.' };

  try {
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
    const conversation = history
      .slice(-6)
      .map((item) => ({ role: item.sender === 'assistant' ? 'model' : 'user', parts: [{ text: item.text.slice(0, 1200) }] }));

    const systemInstructionText = `You are LEAPRS Help, the intelligent assistant for the Lifelong Education Advancement Program Requisition System (LEAPRS).
Current User Context: User ID "${access.userId}", Department "${access.department}", Role "${access.role}".

Tone & Structure Rules (STRICT):
- Keep every answer ultra-simple, clear, and direct (zero fluff, no greetings or pleasantries).
- Recognize all UI controls, header icons, pages, and features.
- Consistent Bolding: Always bold ALL UI names, buttons, sections, icons, request IDs, and pages (**Fullscreen**, **Settings**, **CapDev**, **Users & Access**, **Manage Users**, **View Audit Logs**, **Reports**, **Export Reports**, **Analytics**, **CapDev Configuration**, **Request Configuration**, **Add Request**, **Add Status**, Request **#30**). Do not bold ordinary words.
- When asked "What can you do?" or for general help, list your 4 core capabilities:
  1. **Activity Design Extraction**: Upload/paste activity designs to generate structured request drafts.
  2. **Live Request Status**: Check real-time progress, milestones, and blockers for specific requests (e.g. Request **#30**).
  3. **My Submissions & History**: View your submitted requests, total counts, or pending items.
  4. **Department Budget & CapDev**: Inquire about remaining departmental balances and active CapDev AIP Codes.
- When the user asks about a request's status:
  * If a request number is mentioned (e.g. "Request #30", "status of 30"), call the tool to get live database information and summarize its status, budget, and last update.
  * If no request number is provided (e.g. "what's the status of my request?", "show my requests"): call "get_my_requests_summary" to see their active submissions. If they have requests, list the IDs and statuses concisely and ask which one they need details on. If they have none, let them know how to submit one.
- When the user asks about department budget or CapDev balance, call the corresponding database tool.
- If asked about the system flow or workflow, provide this exact 4-step format:
Here is the LEAPRS workflow in 4 simple steps:
1. **CapDev Projects**: Create a parent project with an **AIP Code** and a budget.
2. **Requisition Requests**: Submit employee requests under that project using **Add Request** or by pasting an activity design in chat.
3. **Timeline Tracking**: Track progress using **Add Status**, handle blockers, and finish by marking requests as **Complete** or **Deny**.
4. **Evaluations & Reports**: Open the single seminar evaluation form for a completed request and monitor budget health in **Analytics**.
- Only if a user asks a question completely unrelated to LEAPRS (such as weather or cooking), reply: "I can only help with LEAPRS."

Verified System Grounding:
${PORTAL_CHATBOT_GUIDE}`;

    // Read-only tools exposed to the chatbot for real-time live queries
    const CHATBOT_ALLOWED_TOOLS = [
      'find_capdev_by_aip_code',
      'get_request_status',
      'get_my_requests_summary',
      'get_department_budget_balance',
      'list_available_capdev_projects',
      'get_request_form_schema',
    ];

    const availableTools = [
      {
        functionDeclarations: LEAPRS_MCP_TOOLS
          .filter((t) => CHATBOT_ALLOWED_TOOLS.includes(t.name))
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
      },
    ];

    let contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
      ...conversation,
      { role: 'user', parts: [{ text: question }] },
    ];

    // Tool calling execution loop (up to 3 turns)
    for (let turn = 0; turn < 3; turn++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents,
            tools: availableTools,
            generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini help request failed:', response.status, errorText);
        return { success: false as const, error: 'The help service is temporarily unavailable.' };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name: string; args: Record<string, unknown> };
            }>;
          };
        }>;
      };

      const candidate = payload.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);

      if (functionCallPart && functionCallPart.functionCall) {
        const { name, args } = functionCallPart.functionCall;
        const toolExecutionResult = await executeMcpTool(access, name, args || {});

        // Append model's full response (preserving thought_signature) and user's functionResponse
        contents = [
          ...contents,
          (candidate?.content as { role: string; parts: Array<Record<string, unknown>> }) || {
            role: 'model',
            parts: parts as Array<Record<string, unknown>>,
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name,
                  response: {
                    name,
                    content: toolExecutionResult,
                  },
                },
              },
            ],
          },
        ];
        continue;
      }

      const reply = parts.map((part) => part.text || '').join('').trim();
      if (reply) {
        return { success: true as const, reply };
      }
    }

    return { success: true as const, reply: 'I processed your request, but could not format a final response.' };
  } catch (error) {
    console.error('Gemini help request failed:', error);
    return { success: false as const, error: 'The help service is temporarily unavailable.' };
  }
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
  action: 'created' | 'updated' | 'deleted' | 'archived' | 'restored' | 'status_changed' | 'stopped' | 'resumed';
  entityType: 'capdev' | 'request' | 'status_update' | 'user' | 'capdev_field' | 'request_field' | 'status_update_field' | 'system_setting';
  entityId?: string | number | null;
  entityLabel: string;
  details?: Record<string, unknown>;
}) {
  const actor = await getActorSnapshot(access);
  const details = { ...(entry.details || {}) };
  const requestId = entry.entityType === 'request' ? Number(entry.entityId) : details.requestId;
  if ((entry.entityType === 'request' || entry.entityType === 'status_update') && typeof requestId === 'number' && Number.isFinite(requestId)) {
    const [request] = await db.select({ requestorName: requests.requestorName, capdevId: requests.capdevId, description: requests.description }).from(requests).where(eq(requests.id, requestId)).limit(1);
    if (request) { details.requestorName ??= request.requestorName; details.capdevId ??= request.capdevId; details.requestDescription ??= request.description; }
  }
  if (typeof details.capdevId === 'number' && typeof details.capdevAipCode !== 'string') {
    const [capdev] = await db.select({ aipCode: capdevs.aipCode }).from(capdevs).where(eq(capdevs.id, details.capdevId)).limit(1);
    if (capdev) details.capdevAipCode = capdev.aipCode;
  }
  await db.insert(auditLogs).values({
    ...actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    entityLabel: entry.entityType === 'request' || entry.entityType === 'status_update' ? requestLabel(details.requestorName) : entry.entityLabel,
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
        sql`${auditLogs.details}->>'requestorName' ILIKE ${pattern}`,
        sql`EXISTS (SELECT 1 FROM ${requests} WHERE ${requests.requestorName} ILIKE ${pattern} AND ${requests.id}::text = CASE WHEN ${auditLogs.entityType} = 'request' THEN ${auditLogs.entityId} WHEN ${auditLogs.entityType} = 'status_update' THEN ${auditLogs.details}->>'requestId' END)`,
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
    const requestIds = Array.from(new Set(logs.flatMap((log) => {
      const details = log.details && typeof log.details === 'object' ? log.details as Record<string, unknown> : {};
      const id = log.entityType === 'request' ? Number(log.entityId) : details.requestId;
      return (log.entityType === 'request' || log.entityType === 'status_update') && typeof id === 'number' && Number.isFinite(id) ? [id] : [];
    })));
    const requestRows = requestIds.length ? await db.select({ id: requests.id, requestorName: requests.requestorName }).from(requests).where(inArray(requests.id, requestIds)) : [];
    const names = new Map(requestRows.map((request) => [request.id, request.requestorName]));
    const enrichedLogs = logs.map((log) => {
      const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details as Record<string, unknown> : {};
      const capdevAipCode = typeof details.capdevId === 'number' ? aipCodesByCapdevId.get(details.capdevId) : undefined;
      const requestId = log.entityType === 'request' ? Number(log.entityId) : details.requestId;
      const requestorName = typeof requestId === 'number' ? names.get(requestId) : undefined;
      return { ...log, details: { ...details, ...(capdevAipCode ? { capdevAipCode } : {}), ...(requestorName && !details.requestorName ? { requestorName } : {}) } };
    });
    return { success: true as const, logs: enrichedLogs, total: totals[0]?.value || 0 };
  } catch (error) {
    console.error('Failed to get audit logs:', error);
    return { success: false as const, logs: [] as AuditLogItem[], total: 0, error: 'Unable to load audit logs.' };
  }
}

function canAccessCapdev(access: UserAccess, capdev: { department: string }) {
  return access.role === 'admin' || access.role === 'viewer-full' || access.role === 'employee' || access.role === 'employee-department' || capdev.department === access.department;
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
  const [record] = await db.select({ request: getTableColumns(requests), capdevDepartment: capdevs.department, parentArchivedAt: capdevs.archivedAt }).from(requests).innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(and(eq(requests.id, requestId), requestAccessScope(access))).limit(1);
  if (!record) return null;
  const request = { ...record.request, parentArchivedAt: record.parentArchivedAt };
  if (access.role === 'employee') return request.userId === access.userId ? request : null;
  if (access.role === 'viewer') return record.capdevDepartment === access.department ? request : null;
  return request;
}

async function getWritableRequest(access: UserAccess, requestId: number) {
  const record = await getAccessibleRequest(access, requestId);
  if (record && isArchiveReadOnly(record, { archivedAt: record.parentArchivedAt })) throw new Error(ARCHIVED_READ_ONLY);
  return record;
}

export async function getCurrentUserAccess() {
  const access = await getCurrentAccess();
  return access ? { success: true as const, ...access } : { success: false as const, error: 'You must be signed in.' };
}

export async function getMaintenanceMode() {
  try {
    return { success: true as const, enabled: await readMaintenanceMode() };
  } catch (error) {
    console.error('Failed to read maintenance mode:', error);
    return { success: false as const, enabled: false, error: 'Unable to read maintenance mode.' };
  }
}

export async function setMaintenanceMode(enabled: boolean) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || typeof enabled !== 'boolean') return unauthorized;
  try {
    await db.insert(systemSettings).values({
      key: MAINTENANCE_MODE_KEY,
      enabled,
      updatedById: access.userId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { enabled, updatedById: access.userId, updatedAt: new Date() },
    });
    await writeAuditLog(access, {
      action: 'status_changed',
      entityType: 'system_setting',
      entityId: MAINTENANCE_MODE_KEY,
      entityLabel: 'Maintenance Mode',
      details: { enabled },
    });
    return { success: true as const, enabled };
  } catch (error) {
    console.error('Failed to update maintenance mode:', error);
    return { success: false as const, error: 'Unable to update maintenance mode.' };
  }
}

export async function checkDrizzleConnection(): Promise<DbStatus> {
  const testedAt = new Date().toISOString();
  const start = Date.now();

  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return { success: false, testedAt, errorMessage: 'Administrator access is required.' };
  if (!await consumeRateLimit(`db-check:${access.userId}`, 5, 60000)) return { success: false, testedAt, errorMessage: 'Please wait before checking again.' };

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
    } catch (e) {
      console.error('Database write error:', e);
    }

    // 3. Count Checks (Test aggregation/read query)
    let totalChecks = 0;
    try {
      const countRes = await db.select({ value: count() }).from(connections);
      totalChecks = countRes[0].value || 0;
    } catch (e) {
      console.error('Database aggregation error:', e);
    }

    return {
      success: true,
      latencyMs,
      testedAt,
      writeSuccess,
      totalChecks,
    };
  } catch (error) {
    console.error('Database connection check failed:', error);
    return {
      success: false,
      testedAt,
      errorMessage: 'Unable to connect to the database.',
    };
  }
}

export async function getOrCreateUserRole(userId: string): Promise<AppRole | 'pending-approval' | 'rejected'> {
  try {
    const { data: session } = await auth.getSession();
    if (!session?.user || session.user.id !== userId) return 'pending-approval';
    const existing = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing.length > 0) {
      return VALID_ROLES.includes(existing[0].role as AppRole) ? existing[0].role as AppRole : 'employee';
    }

    const [approval] = await db
      .select({ status: roleApprovalRequests.status })
      .from(roleApprovalRequests)
      .where(eq(roleApprovalRequests.userId, userId))
      .limit(1);
    if (approval?.status === 'pending') return 'pending-approval';
    if (approval?.status === 'rejected') return 'rejected';
    if (approval?.status === 'accepted') return 'employee-department';
    if (!isAllowedSignupEmail(session.user.email)) return 'rejected';

    const role = 'employee';

    await db.insert(users).values({
      id: userId,
      role: role,
    });

    return role;
  } catch (error) {
    console.error('Error fetching or creating user role:', error);
    return 'pending-approval';
  }
}

type DepartmentOptionsConfig = {
  included: string[];
  excluded: string[];
};

function parseDepartmentOptionsConfig(value: unknown): DepartmentOptionsConfig {
  if (Array.isArray(value)) {
    return {
      included: value.filter((option): option is string => typeof option === 'string'),
      excluded: [],
    };
  }
  if (!value || typeof value !== 'object') return { included: [], excluded: [] };
  const config = value as Record<string, unknown>;
  return {
    included: Array.isArray(config.included)
      ? config.included.filter((option): option is string => typeof option === 'string')
      : [],
    excluded: Array.isArray(config.excluded)
      ? config.excluded.filter((option): option is string => typeof option === 'string')
      : [],
  };
}

function cleanDepartmentOptions(options: string[]) {
  const byNormalizedName = new Map<string, string>();
  options.forEach((option) => {
    const cleaned = option.trim();
    const normalized = cleaned.toLocaleLowerCase();
    if (cleaned && cleaned !== 'Unassigned' && cleaned !== 'None' && !byNormalizedName.has(normalized)) {
      byNormalizedName.set(normalized, cleaned);
    }
  });
  return Array.from(byNormalizedName.values()).slice(0, 100);
}

const DEFAULT_DEPARTMENT_OPTIONS = [
  'College of Arts and Sciences',
  'College of Business and Accountancy',
  'College of Computer Studies',
  'College of Education',
  'College of Engineering',
  'College of Nursing',
  'General Administration',
  'Human Resources Department',
  'Finance and Accounting Office',
  'Information Technology Office',
  'Student Affairs Office',
];

export async function getDepartmentOptions() {
  try {
    const configuredOptions = await db
      .select({ options: capdevFieldDefinitions.options })
      .from(capdevFieldDefinitions)
      .where(and(eq(capdevFieldDefinitions.name, '__department_options__'), eq(capdevFieldDefinitions.isActive, false)));

    if (configuredOptions.length === 0) {
      return cleanDepartmentOptions(DEFAULT_DEPARTMENT_OPTIONS).sort((a, b) => a.localeCompare(b));
    }

    const configs = configuredOptions.map((record) => parseDepartmentOptionsConfig(record.options));
    const included = configs.flatMap((config) => config.included);
    const excluded = new Set(configs.flatMap((config) => config.excluded).map((option) => option.trim().toLocaleLowerCase()));

    const baseList = included.length > 0 ? included : DEFAULT_DEPARTMENT_OPTIONS;

    return cleanDepartmentOptions(baseList)
      .filter((department) => !excluded.has(department.toLocaleLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Failed to load department options:', error);
    return cleanDepartmentOptions(DEFAULT_DEPARTMENT_OPTIONS).sort((a, b) => a.localeCompare(b));
  }
}

export async function saveDepartmentOptions(options: string[], updatedById: string) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return unauthorized;
  const cleaned = cleanDepartmentOptions(options);
  const [existing] = await db
    .select({ id: capdevFieldDefinitions.id, options: capdevFieldDefinitions.options })
    .from(capdevFieldDefinitions)
    .where(eq(capdevFieldDefinitions.name, '__department_options__'))
    .limit(1);

  const config: DepartmentOptionsConfig = { included: cleaned, excluded: [] };
  if (existing) {
    await db
      .update(capdevFieldDefinitions)
      .set({ options: config, isActive: false, updatedById, updatedAt: new Date() })
      .where(eq(capdevFieldDefinitions.id, existing.id));
  } else {
    await db.insert(capdevFieldDefinitions).values({
      name: '__department_options__',
      type: 'text',
      options: config,
      isRequired: false,
      isActive: false,
      section: 'optional',
      width: 'full',
      sortOrder: 0,
      updatedById,
    });
  }
  await writeAuditLog(access, { action: 'updated', entityType: 'capdev_field', entityLabel: 'Department options', details: { ...config, changes: auditChanges(parseDepartmentOptionsConfig(existing?.options), config, { included: 'Available departments', excluded: 'Hidden departments' }) } });
  return { success: true };
}

export async function completeSelfRegistration(input: { role: string; department?: string }) {
  const { data: session } = await auth.getSession();
  const role = input.role as (typeof SELF_REGISTRATION_ROLES)[number];
  const department = (input.department || '').trim() || 'Unassigned';
  if (!session?.user) return unauthorized;
  if (!isAllowedSignupEmail(session.user.email)) return { success: false, error: SIGNUP_EMAIL_ERROR };
  if (!SELF_REGISTRATION_ROLES.includes(role) || department.length > 255) {
    return { success: false, error: 'Provide a valid role.' };
  }
  if (role === 'viewer' && department === 'Unassigned') {
    return { success: false, error: 'Department is required for the Department Viewer role.' };
  }

  try {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, session.user.id)).limit(1);
    if (existing) return { success: false, error: 'This account has already been registered.' };
    const [existingApproval] = await db.select({ id: roleApprovalRequests.id }).from(roleApprovalRequests).where(eq(roleApprovalRequests.userId, session.user.id)).limit(1);
    if (existingApproval) return { success: false, error: 'A role request already exists for this account.' };

    if (role === 'employee-department') {
      await withTransaction(async tx => {
        const [approval] = await tx.insert(roleApprovalRequests).values({
          userId: session.user.id,
          name: session.user.name || session.user.email || 'Unnamed user',
          email: session.user.email || '',
          department,
          requestedRole: role,
        }).returning({ id: roleApprovalRequests.id });
        await insertNotificationEvent(tx, {
          title: 'Role approval requested',
          message: `${session.user.name || session.user.email || 'A user'} requested Employee (All Department Requests) access.`,
          link: `/portal/users?approval=${approval.id}#role-approval-${approval.id}`,
          type: 'role_approval',
        });
      });
      scheduleNotificationEmails();
      return { success: true, pendingApproval: true as const };
    }

    const access: UserAccess = { userId: session.user.id, role, department };
    await db.insert(users).values({ id: access.userId, role, department });
    await writeAuditLog(access, { action: 'created', entityType: 'user', entityId: access.userId, entityLabel: access.userId, details: { role, department, source: 'self_registration' } });
    
    // Clean up signup verification record for this user's email if present
    if (session.user.email) {
      await db.delete(signupVerifications).where(eq(signupVerifications.email, session.user.email.toLowerCase().trim()));
    }

    return { success: true, pendingApproval: false as const };
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

export type DirectoryUser = { id: string; name: string | null; email: string; createdAt: Date; role: string; department: string; isArchived: boolean; archivedAt: Date | null };

export type PendingRoleApproval = typeof roleApprovalRequests.$inferSelect;

export async function getPendingRoleApprovals() {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return { success: false as const, approvals: [] as PendingRoleApproval[], error: unauthorized.error };
  try {
    const approvals = await db.select().from(roleApprovalRequests).where(eq(roleApprovalRequests.status, 'pending')).orderBy(desc(roleApprovalRequests.createdAt));
    return { success: true as const, approvals };
  } catch (error) {
    console.error('Failed to get pending role approvals:', error);
    return { success: false as const, approvals: [] as PendingRoleApproval[], error: 'Unable to load role approval requests.' };
  }
}

async function fetchAuthUsersList(): Promise<{ id: string; name: string | null; email: string; createdAt: Date }[]> {
  try {
    const { data: authUsers, error: authError } = await auth.admin.listUsers({ query: { limit: 100 } });
    if (!authError && authUsers?.users) {
      return authUsers.users.map((u) => ({
        id: u.id,
        name: u.name || null,
        email: u.email,
        createdAt: new Date(u.createdAt),
      }));
    }
  } catch {
    // Fall back to direct database query
  }

  const result = await db.execute(sql`
    SELECT id, name, email, "createdAt" FROM neon_auth.user ORDER BY "createdAt" DESC
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name ? String(row.name) : null,
    email: String(row.email),
    createdAt: new Date(String(row.createdAt)),
  }));
}

export async function getUserManagementCounts() {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') {
    return { success: false as const, activeUsers: 0, pendingApprovals: 0, error: unauthorized.error };
  }

  try {
    const [authUsersList, appUsers, pendingApprovals] = await Promise.all([
      fetchAuthUsersList(),
      db.select({ id: users.id, archivedAt: users.archivedAt }).from(users),
      db.select({ userId: roleApprovalRequests.userId }).from(roleApprovalRequests).where(eq(roleApprovalRequests.status, 'pending')),
    ]);

    const appUsersById = new Map(appUsers.map((user) => [user.id, user]));
    const pendingUserIds = new Set(pendingApprovals.map((approval) => approval.userId));

    return {
      success: true as const,
      activeUsers: authUsersList.filter((user) => !pendingUserIds.has(user.id) && !appUsersById.get(user.id)?.archivedAt).length,
      pendingApprovals: pendingApprovals.length,
    };
  } catch (error) {
    console.error('Failed to get user management counts:', error);
    return { success: false as const, activeUsers: 0, pendingApprovals: 0, error: 'Unable to load user counts.' };
  }
}

export async function decideRoleApproval(approvalId: number, decision: 'accepted' | 'rejected') {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return unauthorized;
  try {
    const [approval] = await db.select().from(roleApprovalRequests).where(and(eq(roleApprovalRequests.id, approvalId), eq(roleApprovalRequests.status, 'pending'))).limit(1);
    if (!approval) return { success: false, error: 'This approval request is no longer pending.' };

    if (decision === 'accepted') {
      await db.insert(users).values({ id: approval.userId, role: 'employee-department', department: approval.department });
    } else {
      try {
        const { error } = await auth.admin.removeUser({ userId: approval.userId });
        if (error) throw new Error(error.message);
      } catch {
        await db.execute(sql`DELETE FROM neon_auth.session WHERE "userId" = ${approval.userId}`);
        await db.execute(sql`DELETE FROM neon_auth.account WHERE "userId" = ${approval.userId}`);
        await db.execute(sql`DELETE FROM neon_auth.user WHERE id = ${approval.userId}`);
      }
    }

    await db.update(roleApprovalRequests).set({ status: decision, decidedById: access.userId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(roleApprovalRequests.id, approvalId));
    await db.delete(notifications).where(inArray(notifications.link, [
      `/portal/users?approval=${approvalId}`,
      `/portal/users?approval=${approvalId}#role-approval-${approvalId}`,
      `/admin/users?approval=${approvalId}`,
    ]));
    await writeAuditLog(access, {
      action: decision === 'accepted' ? 'created' : 'deleted',
      entityType: 'user',
      entityId: approval.userId,
      entityLabel: approval.name || approval.email,
      details: { email: approval.email, role: approval.requestedRole, department: approval.department, source: 'role_approval', decision },
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to decide role approval:', error);
    return { success: false, error: 'Unable to save the approval decision.' };
  }
}

export async function getUsersDirectory(): Promise<DirectoryUser[]> {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return [];

  try {
    const [authUsersList, appUsers, pendingApprovals] = await Promise.all([
      fetchAuthUsersList(),
      db.select().from(users),
      db.select({ userId: roleApprovalRequests.userId }).from(roleApprovalRequests).where(eq(roleApprovalRequests.status, 'pending')),
    ]);
    const appUsersById = new Map(appUsers.map((user) => [user.id, user]));
    const pendingUserIds = new Set(pendingApprovals.map((approval) => approval.userId));
    return authUsersList.filter((user) => !pendingUserIds.has(user.id)).map((user) => ({
      id: user.id,
      name: user.name || null,
      email: user.email,
      createdAt: user.createdAt,
      role: appUsersById.get(user.id)?.role || 'employee',
      department: appUsersById.get(user.id)?.department || 'Unassigned',
      isArchived: Boolean(appUsersById.get(user.id)?.archivedAt),
      archivedAt: appUsersById.get(user.id)?.archivedAt || null,
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
    const [[previous], authUsersList] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      fetchAuthUsersList(),
    ]);
    const target = authUsersList.find((user) => user.id === userId);
    if (previous?.archivedAt) return { success: false, error: ARCHIVED_READ_ONLY };
    await db.update(users).set({ role: newRole, ...(department ? { department } : {}) }).where(eq(users.id, userId));
    await writeAuditLog(access, { action: 'updated', entityType: 'user', entityId: userId, entityLabel: target?.name || target?.email || userId, details: { role: newRole, ...(department ? { department } : {}), changes: auditChanges(previous || {}, { ...previous, role: newRole, ...(department ? { department } : {}) }, { role: 'Role', department: 'Department' }) } });
    return { success: true };
  } catch (error) {
    console.error('Failed to update user role:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function updateDirectoryUser(userId: string, input: { name: string; email: string; role: string; department?: string; password?: string }) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || !VALID_ROLES.includes(input.role as AppRole)) return unauthorized;
  if (input.password !== undefined && typeof input.password !== 'string') {
    return { success: false, error: 'Please enter a valid password.' };
  }
  if (input.password) {
    const passwordError = getPasswordValidationError(input.password);
    if (passwordError) return { success: false, error: passwordError };
  }
  const department = (input.department || '').trim() || 'Unassigned';
  if (input.role === 'viewer' && department === 'Unassigned') {
    return { success: false, error: 'Department is required for the Department Viewer role.' };
  }
  try {
    const [[previous], authUsersList] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      fetchAuthUsersList(),
    ]);
    const target = authUsersList.find((user) => user.id === userId);
    if (previous?.archivedAt) return { success: false, error: ARCHIVED_READ_ONLY };
    const { error } = await auth.admin.updateUser({ userId, data: { name: input.name, email: input.email } });
    if (error) return { success: false, error: error.message || 'Unable to update the Neon Auth user.' };
    if (input.password) {
      const { data, error: passwordError } = await auth.admin.setUserPassword({ userId, newPassword: input.password });
      if (passwordError || !data) {
        return { success: false, error: 'Unable to update the password: ' + (passwordError?.message || 'Authentication did not confirm the change.') };
      }
    }
    await db.update(users).set({ role: input.role, department }).where(eq(users.id, userId));
    await writeAuditLog(access, { action: 'updated', entityType: 'user', entityId: userId, entityLabel: input.name || input.email, details: { email: input.email, role: input.role, department, passwordChanged: Boolean(input.password), changes: auditChanges({ ...previous, name: target?.name, email: target?.email }, { ...input, department }, { name: 'Name', email: 'Email', role: 'Role', department: 'Department' }) } });
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

export async function createDirectoryUser(input: { name: string; email: string; password: string; role: string; department?: string }) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || !VALID_ROLES.includes(input.role as AppRole)) return unauthorized;
  const department = (input.department || '').trim() || 'Unassigned';
  if (input.role === 'viewer' && department === 'Unassigned') {
    return { success: false, error: 'Department is required for the Department Viewer role.' };
  }
  const passwordError = getPasswordValidationError(input.password);
  if (passwordError) return { success: false, error: passwordError };
  try {
    const { data, error } = await auth.admin.createUser({ email: input.email, password: input.password, name: input.name });
    if (error || !data?.user) return { success: false, error: error?.message || 'Unable to create the Neon Auth user.' };
    await db.insert(users).values({ id: data.user.id, role: input.role, department });
    await writeAuditLog(access, { action: 'created', entityType: 'user', entityId: data.user.id, entityLabel: input.name || input.email, details: { email: input.email, role: input.role, department } });
    return { success: true, user: data.user };
  } catch (error) {
    console.error('Failed to create user directory record:', error);
    return { success: false, error: 'Unable to create the user.' };
  }
}

export async function archiveDirectoryUser(userId: string) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || access.userId === userId) return unauthorized;
  try {
    const [authUsersList, targetRows] = await Promise.all([
      fetchAuthUsersList(),
      db.select().from(users).where(eq(users.id, userId)).limit(1),
    ]);
    const target = targetRows[0];
    if (!target) return { success: false as const, error: 'User not found.' };
    if (target.archivedAt) return { success: true as const };
    const targetAuthUser = authUsersList.find((user) => user.id === userId);
    const archivedAt = new Date();
    await db.update(users).set({ archivedAt }).where(eq(users.id, userId));
    await writeAuditLog(access, {
      action: 'archived', entityType: 'user', entityId: userId,
      entityLabel: targetAuthUser?.name || targetAuthUser?.email || userId,
      details: { email: targetAuthUser?.email || null, role: target.role, department: target.department },
    });
    return { success: true as const, archivedAt };
  } catch (error) {
    console.error('Failed to archive user:', error);
    return { success: false as const, error: 'Unable to archive the user.' };
  }
}

export async function restoreDirectoryUser(userId: string) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return unauthorized;
  try {
    const actor = await getActorSnapshot(access);
    return await withTransaction(async (tx) => {
      const [target] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      const identity = await tx.execute(sql`SELECT name, email FROM neon_auth.user WHERE id = ${userId}`);
      const targetAuthUser = identity.rows[0] as { name: string | null; email: string } | undefined;
      if (!target || !targetAuthUser) return { success: false as const, error: 'User not found.' };
      if (!target.archivedAt) return { success: true as const };
      await tx.update(users).set({ archivedAt: null }).where(eq(users.id, userId));
      await tx.insert(auditLogs).values({
        ...actor,
        action: 'restored', entityType: 'user', entityId: userId,
        entityLabel: targetAuthUser.name || targetAuthUser.email,
        details: { email: targetAuthUser.email, role: target.role, department: target.department },
      });
      return { success: true as const };
    });
  } catch (error) {
    console.error('Failed to restore user:', error);
    return { success: false as const, error: 'Unable to restore the user.' };
  }
}

export async function deleteArchivedDirectoryUser(userId: string) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin' || access.userId === userId) return unauthorized;
  try {
    const actor = await getActorSnapshot(access);
    return await withTransaction(async (tx) => {
      // Share the row lock with restoration so only archived accounts can be deleted.
      const [target] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!target) return { success: false as const, error: 'User not found.' };
      if (!target.archivedAt) return { success: false as const, error: 'Archive this user before deleting permanently.' };
      const identity = await tx.execute(sql`SELECT name, email FROM neon_auth.user WHERE id = ${userId}`);
      const targetAuthUser = identity.rows[0] as { name: string | null; email: string } | undefined;
      if (!targetAuthUser) return { success: false as const, error: 'User not found.' };
      await tx.execute(sql`DELETE FROM neon_auth.session WHERE "userId" = ${userId}`);
      await tx.execute(sql`DELETE FROM neon_auth.account WHERE "userId" = ${userId}`);
      await tx.execute(sql`DELETE FROM neon_auth.user WHERE id = ${userId}`);
      await tx.delete(mcpOAuthGrants).where(eq(mcpOAuthGrants.userId, userId));
      // Retain the archived application row for existing request and history references.
      await tx.insert(auditLogs).values({
        ...actor,
        action: 'deleted', entityType: 'user', entityId: userId,
        entityLabel: targetAuthUser.name || targetAuthUser.email,
        details: { permanentlyDeleted: true, email: targetAuthUser.email, role: target.role, department: target.department },
      });
      return { success: true as const };
    });
  } catch (error) {
    console.error('Failed to permanently delete archived user:', error);
    return { success: false as const, error: 'Unable to permanently delete the user.' };
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

async function validateComboboxValues(
  kind: 'capdev' | 'request' | 'status',
  additionalInfo: Record<string, unknown>,
  setting?: string,
) {
  const table = kind === 'capdev' ? capdevFieldDefinitions : kind === 'request' ? requestFieldDefinitions : statusUpdateFieldDefinitions;
  const fields = await db.select().from(table).where(eq(table.isActive, true));
  const applicable = kind === 'request' ? fields.filter((field) => 'setting' in field && field.setting === setting) : fields;
  const invalid = getInvalidComboboxFields(applicable, additionalInfo);
  return invalid.length ? 'Select a configured option for: ' + invalid.join(', ') + '.' : null;
}

async function getMissingRequiredCapdevFields(additionalInfo: Record<string, unknown>) {
  const fields = await db
    .select({ id: capdevFieldDefinitions.id, name: capdevFieldDefinitions.name, type: capdevFieldDefinitions.type, isRequired: capdevFieldDefinitions.isRequired, section: capdevFieldDefinitions.section })
    .from(capdevFieldDefinitions)
    .where(eq(capdevFieldDefinitions.isActive, true));

  return fields
    .filter((field) => field.isRequired || field.section === 'required')
    .filter((field) => {
      const value = getDynamicFieldValue(additionalInfo, field);
      if (field.type === 'file') return !Array.isArray(value) || value.length === 0;
      if (field.type === 'table') {
        if (!Array.isArray(value) || value.length === 0) return true;
        return !value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      }
      return value === undefined || value === null || String(value).trim().length === 0;
    })
    .map((field) => field.name);
}

async function changeResourceArchive(kind: 'capdev' | 'request' | 'status_update', id: number, archived: boolean) {
  const access = await getCurrentAccess();
  if (!access || !Number.isSafeInteger(id)) return unauthorized;
  try {
    const actor = await getActorSnapshot(access);
    let requestId: number | undefined;
    if (kind === 'capdev') {
      if (access.role !== 'admin' || !await getAccessibleCapdev(access, id)) return unauthorized;
    } else {
      if (!canManageRequests(access)) return unauthorized;
      if (kind === 'status_update') {
        const [update] = await db.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, id));
        if (!update) return { success: false as const, error: 'Progress update not found.' };
        requestId = update.requestId;
      } else requestId = id;
      if (!await getAccessibleRequest(access, requestId)) return unauthorized;
    }
    const table = sql.identifier(kind === 'capdev' ? 'capdevs' : kind === 'request' ? 'requests' : 'request_status_updates');
    return await withTransaction(async (tx) => {
      let parentRequest: typeof requests.$inferSelect | undefined;
      if (requestId) {
        [parentRequest] = await tx.select().from(requests).where(eq(requests.id, requestId)).for('update');
        if (!parentRequest || (access.role === 'employee' && parentRequest.userId !== access.userId)) return unauthorized;
        const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, parentRequest.capdevId)).for('update');
        if (parent?.archivedAt || (kind === 'status_update' && parentRequest.archivedAt)) return { success: false as const, error: 'Restore the parent record first.' };
      }
      const result = await tx.execute(sql`SELECT * FROM ${table} WHERE id = ${id} FOR UPDATE`);
      const target = result.rows[0];
      if (!target) return { success: false as const, error: 'Record not found.' };
      if (Boolean(target.archived_at) === archived) return { success: true as const };
      const archivedAt = archived ? new Date() : null;
      await tx.execute(sql`UPDATE ${table} SET archived_at = ${archivedAt} WHERE id = ${id}`);
      const entityLabel = kind === 'capdev' ? String(target.aip_code) : requestLabel(parentRequest?.requestorName);
      await tx.insert(auditLogs).values({ ...actor, action: archived ? 'archived' : 'restored', entityType: kind, entityId: String(id), entityLabel,
        details: { ...(parentRequest ? { requestId: parentRequest.id, capdevId: parentRequest.capdevId, requestorName: parentRequest.requestorName } : {}), ...(kind === 'status_update' ? { statusUpdate: target.status_update } : {}) } });
      return { success: true as const, archivedAt };
    });
  } catch (error) {
    console.error('Failed to change resource archive:', error);
    return { success: false as const, error: 'Unable to change the archive status.' };
  }
}

export async function archiveCapdev(id: number) { return changeResourceArchive('capdev', id, true); }
export async function restoreCapdev(id: number) { return changeResourceArchive('capdev', id, false); }
export async function archiveRequest(id: number) { return changeResourceArchive('request', id, true); }
export async function restoreRequest(id: number) { return changeResourceArchive('request', id, false); }
export async function archiveRequestStatusUpdate(id: number) { return changeResourceArchive('status_update', id, true); }
export async function restoreRequestStatusUpdate(id: number) { return changeResourceArchive('status_update', id, false); }

export async function deleteRequestStatusUpdate(id: number) {
  const access = await getCurrentAccess();
  if (!access || !canManageRequests(access)) return unauthorized;
  try {
    const [update] = await db.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, id));
    const request = update ? await getAccessibleRequest(access, update.requestId) : null;
    if (!update || !request) return unauthorized;
    const actor = await getActorSnapshot(access);
    return await withTransaction(async (tx) => {
      const [current] = await tx.select().from(requests).where(eq(requests.id, request.id)).for('update');
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, request.capdevId)).for('update');
      const [target] = await tx.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, id)).for('update');
      if (!current || !target || (access.role === 'employee' && current.userId !== access.userId)) return unauthorized;
      if (!target.archivedAt && !isArchiveReadOnly(current, parent)) return { success: false as const, error: 'Archive this progress update before deleting permanently.' };
      if (current.activeStopperId === id) await tx.update(requests).set({ isStopped: false, activeStopperId: null, updatedAt: new Date(), updatedById: access.userId }).where(eq(requests.id, current.id));
      await tx.delete(requestStatusUpdates).where(or(eq(requestStatusUpdates.id, id), eq(requestStatusUpdates.stopperId, id)));
      await tx.insert(auditLogs).values({ ...actor, action: 'deleted', entityType: 'status_update', entityId: String(id), entityLabel: requestLabel(current.requestorName),
        details: { requestId: current.id, capdevId: current.capdevId, requestorName: current.requestorName, statusUpdate: target.statusUpdate } });
      return { success: true as const };
    });
  } catch (error) {
    console.error('Failed to permanently delete progress update:', error);
    return { success: false as const, error: 'Unable to permanently delete the progress update.' };
  }
}

export async function getAllCapdevs() {
  try {
    const access = await getCurrentAccess();
    if (!access) return [];
    return await db.select().from(capdevs).where(access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined).orderBy(capdevs.aipCode);
  } catch (error) {
    console.error('Failed to fetch CapDev projects:', error);
    return [];
  }
}

export type CapdevPageFilters = { departments: string[]; initialMin: string; initialMax: string; remainingMin: string; remainingMax: string; dateFrom: string; dateTo: string; sort: string };

export async function getCapdevPage(input: { page: number; search: string; filters: CapdevPageFilters; focusId?: number; archived?: boolean }) {
  const access = await getCurrentAccess();
  if (!access) return { success: false as const, records: [], departments: [], total: 0, page: 1, error: 'You must be signed in.' };
  try {
    const scope = access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined;
    const conditions: SQL[] = scope ? [scope] : [];
    const departmentRows = await db.selectDistinct({ department: capdevs.department }).from(capdevs).where(scope).orderBy(capdevs.department);
    const departments = Array.from(new Set(departmentRows.map((row) => row.department.trim() || 'None')));
    if (!departments.includes('None')) departments.unshift('None');
    const focus = input.focusId ? await getAccessibleCapdev(access, input.focusId) : null;
    const archiveScope = focus?.archivedAt || (!focus && input.archived) ? isNotNull(capdevs.archivedAt) : isNull(capdevs.archivedAt);
    conditions.push(archiveScope);
    const ascending = !focus && input.filters.sort === 'oldest';
    if (!focus) {
      if (typeof input.search !== 'string' || input.search.length > 300) throw new Error('Invalid search.');
      if (input.search) {
        const search = '%' + input.search.replace(/[\\%_]/g, '\\$&') + '%';
        conditions.push(or(ilike(capdevs.aipCode, search), ilike(capdevs.department, search), ilike(capdevs.updatedById, search))!);
      }
      if (!Array.isArray(input.filters.departments) || !input.filters.departments.every((value) => typeof value === 'string')) throw new Error('Invalid department filter.');
      conditions.push(input.filters.departments.length ? inArray(sql`COALESCE(NULLIF(TRIM(${capdevs.department}), ''), 'None')`, input.filters.departments) : sql`false`);
      for (const [value, column, minimum] of [
        [input.filters.initialMin, capdevs.initialBudget, true], [input.filters.initialMax, capdevs.initialBudget, false],
        [input.filters.remainingMin, capdevs.budget, true], [input.filters.remainingMax, capdevs.budget, false],
      ] as const) {
        if (value !== '') {
          if (!Number.isFinite(Number(value))) throw new Error('Invalid balance filter.');
          conditions.push(minimum ? gte(column, value) : lte(column, value));
        }
      }
      if (input.filters.dateFrom) conditions.push(gte(capdevs.createdAt, manilaDateBoundary(input.filters.dateFrom)));
      if (input.filters.dateTo) conditions.push(lte(capdevs.createdAt, manilaDateBoundary(input.filters.dateTo, true)));
    }
    const where = and(...conditions);
    const [totalRow] = await db.select({ total: count() }).from(capdevs).where(where);
    const total = Number(totalRow.total);
    let page = Math.max(1, Math.min(Number.isSafeInteger(input.page) ? input.page : 1, Math.max(1, Math.ceil(total / 6))));
    if (focus) {
      const [before] = await db.select({ total: count() }).from(capdevs).where(and(scope, archiveScope,
        sql`(${capdevs.createdAt}, ${capdevs.id}) > (SELECT created_at, id FROM capdevs WHERE id = ${focus.id})`));
      page = Math.floor(Number(before.total) / 6) + 1;
    }
    const records = await db.select().from(capdevs).where(where)
      .orderBy(ascending ? asc(capdevs.createdAt) : desc(capdevs.createdAt), ascending ? asc(capdevs.id) : desc(capdevs.id)).limit(6).offset((page - 1) * 6);
    return { success: true as const, records, departments, total, page, archived: Boolean(focus ? focus.archivedAt : input.archived) };
  } catch (error) {
    console.error('Failed to fetch project page:', error);
    return { success: false as const, records: [], departments: [], total: 0, page: 1, error: 'Unable to load projects. Check your filters and try again.' };
  }
}

export async function getAnalyticsData() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevs: [], requests: [], requestEvents: [], auditActivity: [], auditItems: [] };
    const scope = access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined;
    const auditDay = sql<string>`to_char(${auditLogs.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`;
    const auditCapdevId = sql<number>`COALESCE(
      CASE WHEN jsonb_typeof(${auditLogs.details}->'capdevId') = 'number' THEN (${auditLogs.details}->>'capdevId')::integer END,
      CASE WHEN ${auditLogs.entityType} = 'capdev' AND ${auditLogs.entityId} ~ '^[0-9]+$' THEN ${auditLogs.entityId}::integer END,
      CASE WHEN ${auditLogs.entityType} = 'request' THEN ${requests.capdevId} END
    )`;
    const [projects, requestRows, timelineEvents, resolutionEvents, auditRows] = await Promise.all([
      db.select({ id: capdevs.id, aipCode: capdevs.aipCode, description: capdevs.description, department: capdevs.department,
        initialBudget: capdevs.initialBudget, budget: capdevs.budget, createdAt: capdevs.createdAt }).from(capdevs).where(scope),
      db.select({ id: requests.id, capdevId: requests.capdevId, requestorName: requests.requestorName,
        description: requests.description, setting: requests.setting, status: requests.status,
        isStopped: requests.isStopped, activeStopperId: requests.activeStopperId, createdAt: requests.createdAt })
        .from(requests).innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(scope),
      db.select({ id: requestStatusUpdates.id, requestId: requestStatusUpdates.requestId,
        createdAt: requestStatusUpdates.createdAt, complete: requestStatusUpdates.markAsComplete,
        stopped: requestStatusUpdates.isStopper, resumed: requestStatusUpdates.isResume,
        subtracts: requestStatusUpdates.subtractsRequestedAmount, amount: requests.requestedBudget })
        .from(requestStatusUpdates)
        .innerJoin(requests, eq(requestStatusUpdates.requestId, requests.id))
        .innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(scope),
      db.select({ id: auditLogs.id, requestId: requests.id, createdAt: auditLogs.createdAt, details: auditLogs.details })
        .from(auditLogs)
        .innerJoin(requests, and(eq(auditLogs.entityType, 'request'), sql`${auditLogs.entityId} = ${requests.id}::text`))
        .innerJoin(capdevs, eq(requests.capdevId, capdevs.id))
        .where(and(scope, eq(auditLogs.action, 'status_changed'))),
      db.select({ id: auditLogs.id, capdevId: auditCapdevId, day: auditDay, createdAt: auditLogs.createdAt,
        action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
        entityLabel: auditLogs.entityLabel, details: auditLogs.details })
        .from(auditLogs)
        .leftJoin(requests, and(eq(auditLogs.entityType, 'request'), sql`${auditLogs.entityId} = ${requests.id}::text`))
        .innerJoin(capdevs, eq(capdevs.id, auditCapdevId))
        .where(scope),
    ]);
    const auditActivity = Array.from(auditRows.reduce((totals, row) => {
      const key = `${row.capdevId}:${row.day}`;
      const current = totals.get(key) || { capdevId: row.capdevId, day: row.day, total: 0 };
      current.total++;
      totals.set(key, current);
      return totals;
    }, new Map<string, { capdevId: number; day: string; total: number }>()).values());
    return {
      capdevs: projects.map((project) => ({ ...project, createdAt: project.createdAt.toISOString() })),
      requests: requestRows.map((request) => ({ ...request, createdAt: request.createdAt.toISOString() })),
      requestEvents: [
        ...timelineEvents.map((event) => ({
          id: `timeline-${event.id}`,
          requestId: event.requestId,
          createdAt: event.createdAt.toISOString(),
          complete: event.complete,
          denied: false,
          stopped: event.stopped,
          resumed: event.resumed,
          deductedAmount: event.subtracts ? event.amount : null,
        })),
        ...resolutionEvents.map((event) => {
          const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
            ? event.details as Record<string, unknown>
            : {};
          return {
            id: `audit-${event.id}`,
            requestId: event.requestId,
            createdAt: event.createdAt.toISOString(),
            complete: details.status === 'completed',
            denied: details.status === 'denied',
            stopped: false,
            resumed: false,
            deductedAmount: null,
          };
        }),
      ],
      auditActivity,
      auditItems: auditRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return { capdevs: [], requests: [], requestEvents: [], auditActivity: [], auditItems: [] };
  }
}

export async function getMonitoringReportData() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevs: [], requests: [], capdevFields: [], requestFields: [] };
    const scope = access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined;
    const [capdevData, requestData, capdevFields, requestFields] = await Promise.all([
      db.select().from(capdevs).where(scope).orderBy(capdevs.aipCode),
      db.select(getTableColumns(requests)).from(requests).innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(scope).orderBy(requests.createdAt),
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

type MonitoringField = { id?: number; name: string; source: 'capdev' | 'request'; key?: string };

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
      ...capdevFields.filter((field) => input.capdevFieldIds.includes(field.id)).map((field) => ({ id: field.id, name: field.name, source: 'capdev' as const })),
      ...input.requestFixedFields.map((key) => ({ name: key, source: 'request' as const, key })),
      ...requestFields.filter((field) => input.requestFieldIds.includes(field.id)).map((field) => ({ id: field.id, name: field.name, source: 'request' as const })),
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
        const additionalInfo = field?.source === 'capdev' ? capdevInfo : requestInfo;
        const rawValue = field?.key
          ? record?.[field.key as keyof typeof record]
          : field
            ? getDynamicFieldValue(additionalInfo, { id: field.id!, name: field.name })
            : '';
        cell.value = field?.key === 'setting' && rawValue === 'internal'
          ? 'In-House'
          : monitoringCellValue(rawValue);
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
    data = { ...data, additionalInfo: validatePendingAttachments(data.additionalInfo, access.userId) };
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(data.aipCode?.trim() || '')) {
      return { success: false, error: 'AIP Code must follow the format: 0000-000-0-0-00-000-000' };
    }
    const selectionError = await validateComboboxValues('capdev', data.additionalInfo);
    if (selectionError) return { success: false, error: selectionError };
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const aipCode = data.aipCode.trim();
    const [existing] = await db.select({ id: capdevs.id }).from(capdevs).where(eq(capdevs.aipCode, aipCode)).limit(1);
    if (existing) return { success: false, error: `A CapDev project with AIP Code ${aipCode} already exists.` };
    const created = await withTransaction(async tx => {
      const [created] = await tx.insert(capdevs).values({ ...data, aipCode, department: (data.department && data.department.trim() !== 'None') ? data.department.trim() : '', updatedById: access.userId, initialBudget: data.budget }).returning();
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        capdevId: created.id,
        title: `New CapDev Project: ${created.aipCode}`,
        message: `Created for ${created.department} with balance ₱${Number(created.initialBudget).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        link: `/portal#capdev-record-${created.id}`,
        type: 'capdev_created',
      });
      return created;
    });
    await writeAuditLog(access, { action: 'created', entityType: 'capdev', entityId: created.id, entityLabel: created.aipCode, details: { department: created.department, initialBudget: created.initialBudget } });
    scheduleNotificationEmails();
    return { success: true, capdev: created };
  } catch (error) {
    console.error('Failed to create CapDev project:', error);
    if (error instanceof Error && error.message.includes('capdevs_aip_code_unique')) {
      return { success: false, error: `A CapDev project with AIP Code ${data.aipCode.trim()} already exists.` };
    }
    return { success: false, error: 'Database insert failed' };
  }
}

export async function updateCapdev(id: number, data: CapdevInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    data = { ...data, additionalInfo: validatePendingAttachments(data.additionalInfo, access.userId) };
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(data.aipCode?.trim() || '')) {
      return { success: false, error: 'AIP Code must follow the format: 0000-000-0-0-00-000-000' };
    }
    const selectionError = await validateComboboxValues('capdev', data.additionalInfo);
    if (selectionError) return { success: false, error: selectionError };
    const missingFields = await getMissingRequiredCapdevFields(data.additionalInfo);
    if (missingFields.length > 0) return { success: false, error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.` };
    const [previous] = await db.select().from(capdevs).where(eq(capdevs.id, id)).limit(1);
    if (!previous) return { success: false, error: 'CapDev project not found.' };
    if (previous.archivedAt) return { success: false, error: ARCHIVED_READ_ONLY };
    const updated = await withTransaction(async tx => {
      const [current] = await tx.select().from(capdevs).where(eq(capdevs.id, id)).for('update');
      if (!current || current.archivedAt) throw new Error(ARCHIVED_READ_ONLY);
      const [saved] = await tx.update(capdevs)
        .set({ aipCode: data.aipCode, description: data.description, department: (data.department && data.department.trim() !== 'None') ? data.department.trim() : '', additionalInfo: reconcilePendingAttachments(data.additionalInfo, (current.additionalInfo || {}) as Record<string, unknown>), updatedById: access.userId, updatedAt: new Date() })
        .where(eq(capdevs.id, id)).returning();
      return saved;
    });
    if (!updated) return { success: false, error: 'CapDev project not found.' };
    const changes = auditChanges(previous, updated, { aipCode: 'AIP code', description: 'Description', department: 'Department' });
    const fields = await getCapdevFieldDefinitions();
    for (const field of fields) changes.push(...auditChanges({ value: getDynamicFieldValue((previous.additionalInfo || {}) as Record<string, unknown>, field) }, { value: getDynamicFieldValue((updated.additionalInfo || {}) as Record<string, unknown>, field) }, { value: field.name }));
    await writeAuditLog(access, { action: 'updated', entityType: 'capdev', entityId: updated.id, entityLabel: updated.aipCode, details: { department: updated.department, changes } });
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
    const target = await getAccessibleCapdev(access, id);
    if (!target?.archivedAt) return { success: false, error: 'Archive this CapDev project before deleting permanently.' };
    const actor = await getActorSnapshot(access);
    return await withTransaction(async (tx) => {
      const [current] = await tx.select().from(capdevs).where(eq(capdevs.id, id)).for('update');
      if (!current?.archivedAt) return { success: false, error: 'Archive this CapDev project before deleting permanently.' };
      // Delete child records first, then the project, in one database statement.
      // The dependencies between the CTEs ensure PostgreSQL respects the foreign keys.
      const result = await tx.execute(sql`
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
    });
  } catch (error) {
    console.error('Failed to delete CapDev project:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function getDynamicFieldCounts() {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role === 'employee' || access.role === 'employee-department') return { capdevFieldsCount: 0, internalRequestFieldsCount: 0, externalRequestFieldsCount: 0, statusUpdateFieldsCount: 0 };
    const capdevCount = await db
      .select({ value: count() })
      .from(capdevFieldDefinitions)
      .where(eq(capdevFieldDefinitions.isActive, true));

    const requestCounts = await db
      .select({ setting: requestFieldDefinitions.setting, value: count() })
      .from(requestFieldDefinitions)
      .where(eq(requestFieldDefinitions.isActive, true))
      .groupBy(requestFieldDefinitions.setting);

    const statusUpdateCount = await db
      .select({ value: count() })
      .from(statusUpdateFieldDefinitions)
      .where(eq(statusUpdateFieldDefinitions.isActive, true));

    return {
      capdevFieldsCount: capdevCount[0]?.value || 0,
      internalRequestFieldsCount: requestCounts.find((item) => item.setting === 'internal')?.value || 0,
      externalRequestFieldsCount: requestCounts.find((item) => item.setting === 'external')?.value || 0,
      statusUpdateFieldsCount: statusUpdateCount[0]?.value || 0,
    };
  } catch (error) {
    console.error('Failed to get dynamic field counts:', error);
    return { capdevFieldsCount: 0, internalRequestFieldsCount: 0, externalRequestFieldsCount: 0, statusUpdateFieldsCount: 0 };
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
  options?: unknown[] | null; // Dropdown options array
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition?: 'left' | 'right';
  placeholder?: string | null;
  sortOrder?: number;
  updatedById: string;
}) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (!hasComboboxOptions(data.type, data.options)) return { success: false, error: 'Suggestions-only comboboxes require at least one non-empty option.' };
    if (data.id) {
      const [previous] = await db.select().from(capdevFieldDefinitions).where(eq(capdevFieldDefinitions.id, data.id)).limit(1);
      if (!previous) return { success: false, error: 'Form field not found.' };
      await db
        .update(capdevFieldDefinitions)
        .set({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
        section: data.isRequired ? 'required' : 'optional',
          width: data.width,
          columnPosition: data.columnPosition || 'left',
          placeholder: data.placeholder || null,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        })
        .where(eq(capdevFieldDefinitions.id, data.id));
      await writeAuditLog(access, { action: 'updated', entityType: 'capdev_field', entityId: data.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired, changes: auditChanges(previous, { ...data, options: data.options || null, placeholder: data.placeholder || null, columnPosition: data.columnPosition || 'left' }, { name: 'Field name', type: 'Field type', options: 'Choices', isRequired: 'Required', width: 'Field width', columnPosition: 'Column', placeholder: 'Placeholder' }) } });
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
          section: data.isRequired ? 'required' : 'optional',
          width: data.width,
          columnPosition: data.columnPosition || 'left',
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

export async function updateCapdevFieldsOrder(
  fieldLayout: Array<{ id: number; columnPosition: 'left' | 'right' }>,
  updatedById: string,
) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (fieldLayout.length === 0) return { success: true };
    const orderRows = fieldLayout.map((field, index) => sql`(${field.id}::integer, ${index + 1}::integer, ${field.columnPosition}::varchar)`);
    // The Neon HTTP driver cannot use Drizzle callback transactions. This is one
    // PostgreSQL statement, so every field order is updated atomically instead.
    await db.execute(sql`
      UPDATE capdev_field_definitions AS field
      SET sort_order = ordered.sort_order,
          column_position = ordered.column_position,
          updated_by_id = ${updatedById},
          updated_at = NOW()
      FROM (VALUES ${sql.join(orderRows, sql`, `)}) AS ordered(id, sort_order, column_position)
      WHERE field.id = ordered.id
    `);
    await writeAuditLog(access, { action: 'updated', entityType: 'capdev_field', entityLabel: 'CapDev field layout', details: { fieldLayout } });
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder CapDev fields:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export type RequestSetting = 'internal' | 'external';

function isRequestSetting(value: string): value is RequestSetting {
  return value === 'internal' || value === 'external';
}

export async function getRequestFieldDefinitions(setting: RequestSetting) {
  try {
    if (!await getCurrentAccess()) return [];
    if (!isRequestSetting(setting)) return [];
    return await db
      .select()
      .from(requestFieldDefinitions)
      .where(and(eq(requestFieldDefinitions.isActive, true), eq(requestFieldDefinitions.setting, setting)))
      .orderBy(requestFieldDefinitions.sortOrder);
  } catch (error) {
    console.error('Failed to get Request fields:', error);
    return [];
  }
}

export async function saveRequestFieldDefinition(data: {
  id?: number;
  setting: RequestSetting;
  name: string;
  type: string;
  options?: unknown[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition?: 'left' | 'right';
  placeholder?: string | null;
  sortOrder?: number;
  updatedById: string;
}) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (!hasComboboxOptions(data.type, data.options)) return { success: false, error: 'Suggestions-only comboboxes require at least one non-empty option.' };
    if (!isRequestSetting(data.setting)) return { success: false, error: 'Invalid request setting.' };
    if (data.id) {
      const [previous] = await db.select().from(requestFieldDefinitions).where(eq(requestFieldDefinitions.id, data.id)).limit(1);
      if (!previous) return { success: false, error: 'Form field not found.' };
      await db
        .update(requestFieldDefinitions)
        .set({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.isRequired ? 'required' : 'optional',
          width: data.width,
          columnPosition: data.columnPosition || 'left',
          placeholder: data.placeholder || null,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        })
        .where(and(eq(requestFieldDefinitions.id, data.id), eq(requestFieldDefinitions.setting, data.setting)));
      await writeAuditLog(access, { action: 'updated', entityType: 'request_field', entityId: data.id, entityLabel: data.name, details: { setting: data.setting, type: data.type, section: data.section, isRequired: data.isRequired, changes: auditChanges(previous, { ...data, options: data.options || null, placeholder: data.placeholder || null, columnPosition: data.columnPosition || 'left' }, { name: 'Field name', type: 'Field type', options: 'Choices', isRequired: 'Required', width: 'Field width', columnPosition: 'Column', placeholder: 'Placeholder' }) } });
      return { success: true, id: data.id };
    }

    const existing = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${requestFieldDefinitions.sortOrder}), 0)` })
      .from(requestFieldDefinitions)
      .where(eq(requestFieldDefinitions.setting, data.setting));
    const nextOrder = (existing[0]?.maxOrder || 0) + 1;

    const [inserted] = await db
      .insert(requestFieldDefinitions)
      .values({
        setting: data.setting,
        name: data.name,
        type: data.type,
        options: data.options || null,
        isRequired: data.isRequired,
          section: data.isRequired ? 'required' : 'optional',
        width: data.width,
        columnPosition: data.columnPosition || 'left',
        placeholder: data.placeholder || null,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : nextOrder,
        updatedById: data.updatedById,
      })
      .returning({ id: requestFieldDefinitions.id });
    await writeAuditLog(access, { action: 'created', entityType: 'request_field', entityId: inserted.id, entityLabel: data.name, details: { setting: data.setting, type: data.type, section: data.section, isRequired: data.isRequired } });
    return { success: true, id: inserted.id };
  } catch (error) {
    console.error('Failed to save Request field:', error);
    return { success: false, error: 'Database save failed' };
  }
}

export async function deleteRequestFieldDefinition(id: number, setting: RequestSetting, updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (!isRequestSetting(setting)) return { success: false, error: 'Invalid request setting.' };
    const [field] = await db.select({ name: requestFieldDefinitions.name }).from(requestFieldDefinitions).where(and(eq(requestFieldDefinitions.id, id), eq(requestFieldDefinitions.setting, setting))).limit(1);
    await db
      .update(requestFieldDefinitions)
      .set({ isActive: false, updatedById, updatedAt: new Date() })
      .where(and(eq(requestFieldDefinitions.id, id), eq(requestFieldDefinitions.setting, setting)));
    await writeAuditLog(access, { action: 'deleted', entityType: 'request_field', entityId: id, entityLabel: field?.name || `Request field #${id}`, details: { setting } });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete Request field:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function updateRequestFieldsOrder(
  fieldLayout: Array<{ id: number; columnPosition: 'left' | 'right' }>,
  setting: RequestSetting,
  updatedById: string,
) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (!isRequestSetting(setting)) return { success: false, error: 'Invalid request setting.' };
    if (fieldLayout.length === 0) return { success: true };
    const orderRows = fieldLayout.map((field, index) => sql`(${field.id}::integer, ${index + 1}::integer, ${field.columnPosition}::varchar)`);
    // See updateCapdevFieldsOrder: a single statement is compatible with Neon HTTP
    // and preserves all-or-nothing ordering updates.
    await db.execute(sql`
      UPDATE request_field_definitions AS field
      SET sort_order = ordered.sort_order,
          column_position = ordered.column_position,
          updated_by_id = ${updatedById},
          updated_at = NOW()
      FROM (VALUES ${sql.join(orderRows, sql`, `)}) AS ordered(id, sort_order, column_position)
      WHERE field.id = ordered.id
        AND field.setting = ${setting}
    `);
    await writeAuditLog(access, { action: 'updated', entityType: 'request_field', entityLabel: `${setting === 'internal' ? 'In-House' : 'External'} request field layout`, details: { setting, fieldLayout } });
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder Request fields:', error);
    return { success: false, error: 'Database update failed' };
  }
}

export async function getStatusUpdateFieldDefinitions() {
  try {
    const access = await getCurrentAccess();
    if (!access) return [];
    const fields = await db
      .select()
      .from(statusUpdateFieldDefinitions)
      .where(eq(statusUpdateFieldDefinitions.isActive, true))
      .orderBy(statusUpdateFieldDefinitions.sortOrder);

    // Seed defaults only for a genuinely new configuration. If definitions
    // exist but are inactive, the admin intentionally deleted every field and
    // an empty configuration must remain empty.
    if (fields.length === 0) {
      const [existingDefinition] = await db
        .select({ id: statusUpdateFieldDefinitions.id })
        .from(statusUpdateFieldDefinitions)
        .limit(1);

      if (existingDefinition) return [];

      const seeded = await db.insert(statusUpdateFieldDefinitions).values([
        {
          name: 'Status Update',
          type: 'text',
          isRequired: true,
          section: 'required',
          width: 'full',
          columnPosition: 'left',
          sortOrder: 1,
          placeholder: 'Enter status update details',
          updatedById: access.userId,
        },
        {
          name: 'Remarks',
          type: 'text',
          isRequired: false,
          section: 'optional',
          width: 'full',
          columnPosition: 'left',
          sortOrder: 2,
          placeholder: 'Enter remarks or additional context',
          updatedById: access.userId,
        },
        {
          name: 'Attachments',
          type: 'file',
          isRequired: false,
          section: 'optional',
          width: 'full',
          columnPosition: 'left',
          sortOrder: 3,
          placeholder: null,
          updatedById: access.userId,
        },
      ]).returning();
      return seeded;
    }

    return fields;
  } catch (error) {
    console.error('Failed to get Status Update fields:', error);
    return [];
  }
}

export async function saveStatusUpdateFieldDefinition(data: {
  id?: number;
  name: string;
  type: string;
  options?: unknown[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition?: 'left' | 'right';
  placeholder?: string | null;
  sortOrder?: number;
  updatedById: string;
}) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (!hasComboboxOptions(data.type, data.options)) return { success: false, error: 'Suggestions-only comboboxes require at least one non-empty option.' };
    if (data.id) {
      const [previous] = await db.select().from(statusUpdateFieldDefinitions).where(eq(statusUpdateFieldDefinitions.id, data.id)).limit(1);
      if (!previous) return { success: false, error: 'Form field not found.' };
      await db
        .update(statusUpdateFieldDefinitions)
        .set({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.isRequired ? 'required' : 'optional',
          width: data.width,
          columnPosition: data.columnPosition || 'left',
          placeholder: data.placeholder || null,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        })
        .where(eq(statusUpdateFieldDefinitions.id, data.id));
      await writeAuditLog(access, { action: 'updated', entityType: 'status_update_field', entityId: data.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired, changes: auditChanges(previous, { ...data, options: data.options || null, placeholder: data.placeholder || null, columnPosition: data.columnPosition || 'left' }, { name: 'Field name', type: 'Field type', options: 'Choices', isRequired: 'Required', width: 'Field width', columnPosition: 'Column', placeholder: 'Placeholder' }) } });
      return { success: true, id: data.id };
    } else {
      const existing = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${statusUpdateFieldDefinitions.sortOrder}), 0)` })
        .from(statusUpdateFieldDefinitions);
      const nextOrder = (existing[0]?.maxOrder || 0) + 1;

      const [inserted] = await db
        .insert(statusUpdateFieldDefinitions)
        .values({
          name: data.name,
          type: data.type,
          options: data.options || null,
          isRequired: data.isRequired,
          section: data.isRequired ? 'required' : 'optional',
          width: data.width,
          columnPosition: data.columnPosition || 'left',
          placeholder: data.placeholder || null,
          sortOrder: data.sortOrder !== undefined ? data.sortOrder : nextOrder,
          updatedById: data.updatedById,
        })
        .returning({ id: statusUpdateFieldDefinitions.id });
      await writeAuditLog(access, { action: 'created', entityType: 'status_update_field', entityId: inserted.id, entityLabel: data.name, details: { type: data.type, section: data.section, isRequired: data.isRequired } });
      return { success: true, id: inserted.id };
    }
  } catch (error) {
    console.error('Failed to save Status Update field:', error);
    return { success: false, error: 'Database save failed' };
  }
}

export async function deleteStatusUpdateFieldDefinition(id: number, updatedById: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    const [field] = await db.select({ name: statusUpdateFieldDefinitions.name }).from(statusUpdateFieldDefinitions).where(eq(statusUpdateFieldDefinitions.id, id)).limit(1);
    await db
      .update(statusUpdateFieldDefinitions)
      .set({
        isActive: false,
        updatedById: updatedById,
        updatedAt: new Date(),
      })
      .where(eq(statusUpdateFieldDefinitions.id, id));
    await writeAuditLog(access, { action: 'deleted', entityType: 'status_update_field', entityId: id, entityLabel: field?.name || `Status Update field #${id}` });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete Status Update field:', error);
    return { success: false, error: 'Database delete failed' };
  }
}

export async function updateStatusUpdateFieldsOrder(
  fieldLayout: Array<{ id: number; columnPosition: 'left' | 'right' }>,
  updatedById: string,
) {
  try {
    const access = await getCurrentAccess();
    if (!access || access.role !== 'admin') return unauthorized;
    if (fieldLayout.length === 0) return { success: true };
    const orderRows = fieldLayout.map((field, index) => sql`(${field.id}::integer, ${index + 1}::integer, ${field.columnPosition}::varchar)`);
    await db.execute(sql`
      UPDATE status_update_field_definitions AS field
      SET sort_order = ordered.sort_order,
          column_position = ordered.column_position,
          updated_by_id = ${updatedById},
          updated_at = NOW()
      FROM (VALUES ${sql.join(orderRows, sql`, `)}) AS ordered(id, sort_order, column_position)
      WHERE field.id = ordered.id
    `);
    await writeAuditLog(access, { action: 'updated', entityType: 'status_update_field', entityLabel: 'Status Update field layout', details: { fieldLayout } });
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder Status Update fields:', error);
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

function hasRequiredValue(value: unknown, type: string) {
  if (type === 'file') return Array.isArray(value) && value.length > 0;
  if (type === 'table') return Array.isArray(value) && value.some((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

export async function getRequestInactivitySettings() {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return { ...unauthorized, days: DEFAULT_INACTIVITY_DAYS };
  try { return { success: true, days: await readInactivityDays() }; }
  catch { return { success: false, days: DEFAULT_INACTIVITY_DAYS, error: 'Unable to load notification settings.' }; }
}

export async function saveRequestInactivitySettings(days: number) {
  const access = await getCurrentAccess();
  if (!access || access.role !== 'admin') return unauthorized;
  if (!validInactivityDays(days)) return { success: false, error: 'Enter a whole number from 1 to 365.' };
  try {
    const previous = await readInactivityDays();
    await db.insert(systemSettings).values({ key: INACTIVITY_SETTING_KEY, numberValue: days, updatedById: access.userId })
      .onConflictDoUpdate({ target: systemSettings.key, set: { numberValue: days, updatedById: access.userId, updatedAt: new Date() } });
    await writeAuditLog(access, { action: 'updated', entityType: 'system_setting', entityId: INACTIVITY_SETTING_KEY,
      entityLabel: 'Status Update Notifications', details: { days, previousDays: previous } });
    return { success: true };
  } catch { return { success: false, error: 'Unable to save notification settings.' }; }
}

export async function getRequestsByCapdev(capdevId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !await getAccessibleCapdev(access, capdevId)) return [];
    const records = await db
      .select(getTableColumns(requests))
      .from(requests)
      .where(eq(requests.capdevId, capdevId))
      .orderBy(requests.createdAt);
    const filtered = access.role === 'employee' ? records.filter((request) => request.userId === access.userId) : records;
    if (filtered.length === 0) return [];
    const inactivity = await getRequestInactivitySummaries(filtered.map((request) => request.id));

    const allUpdates = await db
      .select({
        requestId: requestStatusUpdates.requestId,
        markAsComplete: requestStatusUpdates.markAsComplete,
        subtractsRequestedAmount: requestStatusUpdates.subtractsRequestedAmount,
      })
      .from(requestStatusUpdates)
      .where(inArray(requestStatusUpdates.requestId, filtered.map((r) => r.id)));

    const deductedIds = new Set(allUpdates.filter((u) => u.subtractsRequestedAmount).map((u) => u.requestId));
    const completedIds = new Set(allUpdates.filter((u) => u.markAsComplete).map((u) => u.requestId));

    return filtered.map((req) => ({
      ...req,
      inactivity: inactivity.get(req.id) ?? null,
      hasDeductedBudget: Boolean(req.budgetDeductedAt) || deductedIds.has(req.id),
      isComplete: req.status === 'completed' || completedIds.has(req.id),
    }));
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    return [];
  }
}

export async function getRequestById(id: number) {
  try {
    const access = await getCurrentAccess();
    if (!access) return null;
    const request = await getAccessibleRequest(access, id);
    if (!request) return null;
    const inactivity = await getRequestInactivitySummaries([id]);
    return { ...request, inactivity: inactivity.get(id) ?? null };
  } catch (error) {
    console.error('Failed to fetch request:', error);
    return null;
  }
}

export async function createRequest(data: RequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return unauthorized;
    data = { ...data, additionalInfo: validatePendingAttachments(data.additionalInfo, access.userId) };
    const validated = validateRequestInput(data);
    data = { ...data, ...validated };
    const parent = await getAccessibleCapdev(access, data.capdevId);
    if (!parent) return unauthorized;
    if (parent.archivedAt) return { success: false, error: ARCHIVED_READ_ONLY };
    const selectionError = await validateComboboxValues('request', data.additionalInfo, data.setting);
    if (selectionError) return { success: false, error: selectionError };
    const { data: session } = await auth.getSession();

    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, data.capdevId)).limit(1);
    if (!capdev || Number(data.requestedBudget) > Number(capdev.budget)) return { success: false, error: 'Requested amount exceeds the remaining CapDev balance.' };
    const schema = await getRequestFormSchemaService(access, validated.setting);
    const missing = schema.dynamicFields.filter((field) => field.isRequired && !hasRequiredValue(getDynamicFieldValue(validated.additionalInfo, field), field.type));
    if (missing.length) return { success: false, error: 'Complete the required fields: ' + missing.map((field) => field.name).join(', ') };
    const created = await withTransaction(async (tx) => {
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, validated.capdevId)).for('update');
      if (!parent || parent.archivedAt) throw new Error(ARCHIVED_READ_ONLY);
      const [record] = await tx.insert(requests).values({
      capdevId: validated.capdevId, setting: validated.setting, description: validated.description,
      requestedBudget: validated.requestedBudget, additionalInfo: {}, status: 'in_progress',
      userId: access.userId,
      updatedById: access.userId,
      requestorName: session?.user?.name || session?.user?.email || 'Requestor',
    }).returning();
      await claimRequestFolder(tx, access.userId, record.id, validated.additionalInfo);
      const [saved] = await tx.update(requests).set({ additionalInfo: validated.additionalInfo }).where(eq(requests.id, record.id)).returning();
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        capdevId: saved.capdevId,
        requestId: saved.id,
        title: `New Requisition: ${saved.setting === 'internal' ? 'In-House' : saved.setting === 'external' ? 'External' : 'CapDev Request'}`,
        message: `${saved.requestorName || 'Requestor'} submitted a request for ₱${Number(saved.requestedBudget).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        link: `/portal/capdev/${saved.capdevId}/requests#request-record-${saved.id}`,
        type: 'new_request',
      });
      return saved;
    });
    await writeAuditLog(access, { action: 'created', entityType: 'request', entityId: created.id, entityLabel: `Request #${created.id}`, details: { capdevId: created.capdevId, setting: created.setting, requestedBudget: created.requestedBudget, requestorName: created.requestorName } });
    scheduleNotificationEmails();
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
    data = { ...data, additionalInfo: validatePendingAttachments(data.additionalInfo, access.userId) };
    const validated = validateRequestInput(data);
    data = { ...data, ...validated };
    const existing = await getWritableRequest(access, id);
    if (!existing) return { success: false, error: 'Request not found.' };
    const selectionError = await validateComboboxValues('request', data.additionalInfo, data.setting);
    if (selectionError) return { success: false, error: selectionError };
    const [capdev] = await db.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, existing.capdevId)).limit(1);
    const [deduction] = await db.select({ id: requestStatusUpdates.id }).from(requestStatusUpdates).where(and(eq(requestStatusUpdates.requestId, id), eq(requestStatusUpdates.subtractsRequestedAmount, true))).limit(1);
    if ((existing.budgetDeductedAt || deduction) && Number(data.requestedBudget) !== Number(existing.requestedBudget)) return { success: false, error: 'Requested budget cannot be changed after it has been deducted.' };
    if (!existing.budgetDeductedAt && !deduction && (!capdev || Number(data.requestedBudget) > Number(capdev.budget))) return { success: false, error: 'Requested budget exceeds the remaining CapDev budget.' };
    const schema = await getRequestFormSchemaService(access, validated.setting);
    const missing = schema.dynamicFields.filter((field) => field.isRequired && !hasRequiredValue(getDynamicFieldValue(validated.additionalInfo, field), field.type));
    if (missing.length) return { success: false, error: 'Complete the required fields: ' + missing.map((field) => field.name).join(', ') };
    let changes: ReturnType<typeof auditChanges> = [];
    const updated = await withTransaction(async (tx) => {
      const [current] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
      if (!current || (access.role === 'employee' && current.userId !== access.userId)) throw new Error('Request not found.');
      validated.additionalInfo = reconcilePendingAttachments(validated.additionalInfo, (current.additionalInfo || {}) as Record<string, unknown>);
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, current.capdevId)).for('update');
      if (isArchiveReadOnly(current, parent)) throw new Error(ARCHIVED_READ_ONLY);
      const [deducted] = await tx.select().from(requestStatusUpdates).where(and(eq(requestStatusUpdates.requestId, id), eq(requestStatusUpdates.subtractsRequestedAmount, true))).limit(1);
      if ((current.budgetDeductedAt || deducted) && validated.requestedBudget !== String(current.requestedBudget) && Number(validated.requestedBudget) !== Number(current.requestedBudget)) throw new Error('Requested budget cannot be changed after deduction.');
      if (!current.budgetDeductedAt && !deducted) {
        const [balance] = await tx.select({ budget: capdevs.budget }).from(capdevs).where(eq(capdevs.id, current.capdevId));
        if (!balance || Number(validated.requestedBudget) > Number(balance.budget)) throw new Error('Requested budget exceeds the remaining CapDev budget.');
      }
      changes = auditChanges(current, validated, { setting: 'Request type', description: 'Description', requestedBudget: 'Requested budget' });
      for (const field of schema.dynamicFields) {
        changes.push(...auditChanges({ value: getDynamicFieldValue((current.additionalInfo || {}) as Record<string, unknown>, field) }, { value: getDynamicFieldValue(validated.additionalInfo, field) }, { value: field.name }));
      }
      await claimRequestFolder(tx, access.userId, id, validated.additionalInfo);
      const [saved] = await tx.update(requests).set({ setting: validated.setting, description: validated.description,
        requestedBudget: validated.requestedBudget, additionalInfo: validated.additionalInfo,
        updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, id)).returning();
      return saved;
    });
    if (!updated) return { success: false, error: 'Request not found.' };
    await writeAuditLog(access, { action: 'updated', entityType: 'request', entityId: updated.id, entityLabel: `Request #${updated.id}`, details: { capdevId: updated.capdevId, requestorName: updated.requestorName, setting: updated.setting, requestedBudget: updated.requestedBudget, changes } });
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
    if (!existing.archivedAt && !existing.parentArchivedAt) return { success: false, error: 'Archive this request before deleting permanently.' };
    const actor = await getActorSnapshot(access);
    return await withTransaction(async (tx) => {
      const [current] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
      if (!current || (access.role === 'employee' && current.userId !== access.userId)) return unauthorized;
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, current.capdevId)).for('update');
      if (!isArchiveReadOnly(current, parent)) return { success: false, error: 'Archive this request before deleting permanently.' };

      const [storageFolder] = await tx.select().from(requestStorageFolders).where(eq(requestStorageFolders.requestId, id)).limit(1);
      const driveFolderId = storageFolder?.folderId;

      if (typeof driveFolderId === 'string' && driveFolderId.trim()) {
      try {
        const accessToken = await getGoogleDriveAccessToken();
        if (storageFolder.rootFolderId !== process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID) throw new Error('Untrusted storage root.');
        await verifyManagedDriveFolder(accessToken, storageFolder.folderId, storageFolder.rootFolderId);
        const deletion = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFolderId.trim())}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!deletion.ok && deletion.status !== 404) throw new Error('Unable to delete request attachment folder.');
      } catch (err) {
        console.warn('Could not delete Google Drive folder for request:', err);
      }
      }

      // Delete records atomically; committed budget deductions remain permanent.
      const result = await deleteRequestRecords(tx, id, actor);
      if (result.rows.length === 0) return { success: false, error: 'Request not found.' };
      return { success: true };
    });
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
  additionalInfo?: Record<string, unknown>;
};

export type StopRequestInput = { requestId: number; reason: string; files: StatusAttachment[]; additionalInfo?: Record<string, unknown> };

export type StatusAttachment = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
};

const MAX_STATUS_ATTACHMENTS = 10;
const MAX_STATUS_ATTACHMENT_BYTES = 100 * 1024 * 1024;

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

export type RequestUploadContext = {
  requestId?: number;
  requestorName?: string;
  dateRequested?: string;
  folderId?: string;
};

function formatFolderDate(dateValue?: string | Date | null): string {
  if (!dateValue) return manilaDate();
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return manilaDate();
  return manilaDate(date);
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

async function verifyManagedDriveFolder(accessToken: string, folderId: string, rootFolderId: string) {
  const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId) + '?fields=id,mimeType,parents,appProperties,trashed', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) throw new Error('Attachment folder is unavailable.');
  const folder = await response.json() as { mimeType?: string; parents?: string[]; appProperties?: Record<string, string>; trashed?: boolean };
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.parents?.includes(rootFolderId) || folder.appProperties?.leaprsManaged !== 'true') {
    throw new Error('Attachment folder ownership could not be verified.');
  }
}

async function ensureRequestGoogleDriveFolder(accessToken: string, access: UserAccess, context?: RequestUploadContext): Promise<string> {
  const rootParentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!rootParentFolderId) throw new Error('Google Drive storage is not configured.');
  if (context?.requestId !== undefined && (!Number.isSafeInteger(context.requestId) || !await getWritableRequest(access, context.requestId))) throw new Error(unauthorized.error);
  return withTransaction(async (tx) => {
    let req: typeof requests.$inferSelect | undefined;
    if (context?.requestId) {
      [req] = await tx.select().from(requests).where(eq(requests.id, context.requestId)).for('update');
      if (!req || (access.role === 'employee' && req.userId !== access.userId)) throw new Error(unauthorized.error);
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, req.capdevId)).for('update');
      if (isArchiveReadOnly(req, parent)) throw new Error(ARCHIVED_READ_ONLY);
      const [folder] = await tx.select().from(requestStorageFolders).where(eq(requestStorageFolders.requestId, req.id));
      if (folder) {
        if (folder.rootFolderId !== rootParentFolderId) throw new Error('Invalid attachment folder.');
        await verifyManagedDriveFolder(accessToken, folder.folderId, rootParentFolderId);
        return folder.folderId;
      }
    }
    if (context?.folderId && !req) {
      const [folder] = await tx.select().from(requestStorageFolders).where(eq(requestStorageFolders.folderId, context.folderId)).for('update');
      if (!folder || folder.userId !== access.userId || folder.rootFolderId !== rootParentFolderId || folder.requestId !== null) throw new Error(unauthorized.error);
      await verifyManagedDriveFolder(accessToken, folder.folderId, rootParentFolderId);
      return folder.folderId;
    }
    if (!context) return rootParentFolderId;
    const name = sanitizeFolderName((req?.requestorName || access.name || 'Requestor') + '_' + formatFolderDate(req?.createdAt));
    const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [rootParentFolderId], appProperties: { leaprsManaged: 'true' } }),
    });
    if (!response.ok) throw new Error('Unable to create attachment folder.');
    const folder = await response.json() as { id?: string };
    if (!folder.id) throw new Error('Drive did not return an attachment folder.');
    await tx.insert(requestStorageFolders).values({ folderId: folder.id, requestId: req?.id, userId: access.userId, rootFolderId: rootParentFolderId });
    return folder.id;
  });
}

async function uploadFileToGoogleDrive(file: File, accessToken: string, parentFolderId: string): Promise<StatusAttachment> {
  const boundary = `leaprs-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [parentFolderId] });
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

type GoogleDriveUploadFile = { name: string; mimeType: string; size: number };

async function getUploadRecord(access: UserAccess, target: UploadTarget, tx?: Transaction) {
  if (!Number.isSafeInteger(target.id) || target.id <= 0 || !['capdev', 'request', 'status'].includes(target.kind)) throw new Error('Invalid upload record.');
  const database = tx || db;
  if (target.kind === 'capdev') {
    if (access.role !== 'admin') throw new Error(unauthorized.error);
    const query = database.select().from(capdevs).where(eq(capdevs.id, target.id));
    const [record] = tx ? await query.for('update') : await query;
    if (!record || record.archivedAt) throw new Error(ARCHIVED_READ_ONLY);
    return { info: (record.additionalInfo || {}) as Record<string, unknown>, requestId: undefined, files: [] as StatusAttachment[], label: record.aipCode };
  }
  let requestId = target.id;
  let update: typeof requestStatusUpdates.$inferSelect | undefined;
  if (target.kind === 'status') {
    // Lock order matches request deletion: request, parent, then timeline entry.
    const [found] = await database.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, target.id));
    if (!found) throw new Error('Status update not found.');
    requestId = found.requestId;
    update = found;
  }
  if (!canManageRequests(access) || !await getWritableRequest(access, requestId)) throw new Error(unauthorized.error);
  const query = database.select().from(requests).where(eq(requests.id, requestId));
  const [request] = tx ? await query.for('update') : await query;
  const parentQuery = database.select().from(capdevs).where(eq(capdevs.id, request?.capdevId || 0));
  const [parent] = tx ? await parentQuery.for('update') : await parentQuery;
  if (!request || isArchiveReadOnly(request, parent) || (access.role === 'employee' && request.userId !== access.userId)) throw new Error(ARCHIVED_READ_ONLY);
  if (update && tx) [update] = await tx.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, target.id)).for('update');
  if (target.kind === 'status' && (!update || update.archivedAt)) throw new Error(ARCHIVED_READ_ONLY);
  return { info: ((update ? update.additionalInfo : request.additionalInfo) || {}) as Record<string, unknown>, requestId, files: (update?.files || []) as StatusAttachment[], label: request.requestorName || 'Request' };
}

function findPendingUpload(info: Record<string, unknown>, uploadId: string, userId: string) {
  for (const value of Object.values(info)) {
    if (!Array.isArray(value)) continue;
    const item = value.find(item => isPendingAttachment(item) && item.pendingUploadId === uploadId && item.uploadedById === userId);
    if (item && isPendingAttachment(item)) return item;
  }
  throw new Error('This attachment is no longer pending.');
}

// Reconcile a device's saved job before transferring bytes. Only files tagged by
// LEAPRS for this account and this exact job may be recovered or removed.
export async function reconcileBackgroundAttachment(target: UploadTarget, uploadId: string, recoverFile = false) {
  try {
    const access = await getCurrentAccess();
    if (!access) return unauthorized;
    if (!Number.isSafeInteger(target.id) || target.id <= 0 || !['capdev', 'request', 'status'].includes(target.kind) || !/^[\w-]{1,100}$/.test(uploadId)) throw new Error('Invalid upload record.');
    const table = target.kind === 'capdev' ? capdevs : target.kind === 'request' ? requests : requestStatusUpdates;
    const [exists] = await db.select({ id: table.id }).from(table).where(eq(table.id, target.id));
    let pending = false;
    if (exists) {
      const record = await getUploadRecord(access, target);
      if (Object.values(record.info).some(value => Array.isArray(value) && value.some(item => item && typeof item === 'object' && item.backgroundUploadId === uploadId))) {
        return { success: true as const, state: 'completed' as const };
      }
      pending = Object.values(record.info).some(value => Array.isArray(value) && value.some(item => isPendingAttachment(item) && item.pendingUploadId === uploadId && item.uploadedById === access.userId));
    }
    if (pending && !recoverFile) return { success: true as const, state: 'pending' as const };
    const token = await getGoogleDriveAccessToken();
    // Values are constrained IDs, not arbitrary Drive query fragments.
    const query = `trashed = false and appProperties has { key='leaprsUploadId' and value='${uploadId}' } and appProperties has { key='leaprsRecord' and value='${target.kind}:${target.id}' } and appProperties has { key='leaprsUserId' and value='${access.userId.replaceAll("'", "\\'")}' }`;
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '100' }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Unable to recover attachment.');
    const { files } = await response.json() as { files: { id: string }[] };
    if (pending) return { success: true as const, state: 'pending' as const, fileId: files[0]?.id };
    // The saved record or pending attachment was removed. Clean up the orphan;
    // valid pending attachments and completed record references are preserved.
    for (const file of files) {
      const removed = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!removed.ok && removed.status !== 404) throw new Error('Unable to remove an unused attachment.');
    }
    return { success: true as const, state: 'cancelled' as const };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Unable to recover attachment.' }; }
}

export async function prepareBackgroundAttachment(target: UploadTarget, uploadId: string) {
  try {
    const access = await getCurrentAccess();
    if (!access) return unauthorized;
    const record = await getUploadRecord(access, target);
    const pending = findPendingUpload(record.info, uploadId, access.userId);
    const requestHeaders = await headers();
    const origin = requestHeaders.get('origin');
    const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');
    if (!origin || new URL(origin).host !== host) throw new Error('The upload origin could not be verified.');
    const token = await getGoogleDriveAccessToken();
    const folder = await ensureRequestGoogleDriveFolder(token, access, record.requestId ? { requestId: record.requestId } : undefined);
    const session = await createGoogleDriveUploadSession(pending, token, origin, folder, {
      leaprsUploadId: uploadId, leaprsRecord: `${target.kind}:${target.id}`, leaprsUserId: access.userId,
    });
    return { success: true as const, session };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Unable to prepare attachment.' }; }
}

export async function finishBackgroundAttachment(target: UploadTarget, uploadId: string, fileId: string) {
  try {
    const access = await getCurrentAccess();
    if (!access || !/^[\w-]+$/.test(fileId)) return unauthorized;
    await getUploadRecord(access, target);
    const token = await getGoogleDriveAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,parents,appProperties,trashed`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Unable to verify uploaded attachment.');
    const file = await response.json() as { id: string; name: string; mimeType: string; size: string; webViewLink?: string; appProperties?: Record<string, string>; parents?: string[]; trashed?: boolean };
    if (file.trashed || file.appProperties?.leaprsUploadId !== uploadId || file.appProperties?.leaprsRecord !== `${target.kind}:${target.id}` || file.appProperties?.leaprsUserId !== access.userId) throw new Error('Attachment ownership could not be verified.');
    const attachment: StatusAttachment & { backgroundUploadId: string } = { id: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink || `https://drive.google.com/open?id=${file.id}`, backgroundUploadId: uploadId };
    await withTransaction(async tx => {
      const record = await getUploadRecord(access, target, tx);
      // A repeated completion call after a lost response must be harmless.
      if (Object.values(record.info).some(value => Array.isArray(value) && value.some(item => item && typeof item === 'object' && 'id' in item && item.id === file.id))) return;
      const pending = findPendingUpload(record.info, uploadId, access.userId);
      if (Number(file.size) !== pending.size || file.name !== pending.name) throw new Error('Uploaded file does not match the selected attachment.');
      let folder = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
      if (record.requestId) {
        const [stored] = await tx.select().from(requestStorageFolders).where(eq(requestStorageFolders.requestId, record.requestId));
        folder = stored?.folderId;
      }
      if (!folder || !file.parents?.includes(folder)) throw new Error('Invalid attachment folder.');
      const additionalInfo = replacePendingAttachment(record.info, uploadId, attachment);
      if (target.kind === 'request') additionalInfo.googleDriveFolderId = folder;
      if (target.kind === 'status' && record.requestId) await tx.update(requests).set({ additionalInfo: sql`coalesce(${requests.additionalInfo}, '{}'::jsonb) || ${JSON.stringify({ googleDriveFolderId: folder })}::jsonb` }).where(eq(requests.id, record.requestId));
      if (target.kind === 'capdev') await tx.update(capdevs).set({ additionalInfo, updatedAt: new Date() }).where(eq(capdevs.id, target.id));
      else if (target.kind === 'request') await tx.update(requests).set({ additionalInfo, updatedAt: new Date() }).where(eq(requests.id, target.id));
      else await tx.update(requestStatusUpdates).set({ additionalInfo, files: [...record.files.filter(item => item.id !== attachment.id), attachment] }).where(eq(requestStatusUpdates.id, target.id));
    });
    return { success: true as const };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Unable to attach uploaded file.' }; }
}

async function createGoogleDriveUploadSession(file: GoogleDriveUploadFile, accessToken: string, origin: string, parentFolderId: string, appProperties?: Record<string, string>) {
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
      Origin: origin,
    },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.mimeType || 'application/octet-stream',
      parents: [parentFolderId],
      appProperties,
    }),
  });
  const uploadUrl = response.headers.get('location');
  if (!response.ok || !uploadUrl) {
    console.error('Google Drive upload session failed:', response.status, await response.text());
    throw new Error(`Google Drive could not prepare an upload for “${file.name}”.`);
  }
  return { uploadUrl, name: file.name, mimeType: file.mimeType || 'application/octet-stream' };
}

export async function createGoogleDriveUploadSessions(files: GoogleDriveUploadFile[], context?: RequestUploadContext) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return { ...unauthorized, sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };
    if (files.length === 0) return { success: true, sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };
    if (files.length > MAX_STATUS_ATTACHMENTS) return { success: false, error: `You can attach up to ${MAX_STATUS_ATTACHMENTS} files at once.`, sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };
    if (files.some((file) => !file.name.trim() || !Number.isFinite(file.size) || file.size <= 0)) return { success: false, error: 'One or more selected files are invalid.', sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };
    if (files.reduce((total, file) => total + file.size, 0) > MAX_STATUS_ATTACHMENT_BYTES) return { success: false, error: 'Attachments must total 100 MB or less.', sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };

    const requestHeaders = await headers();
    const origin = requestHeaders.get('origin');
    const requestHost = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');
    if (!origin || !requestHost || new URL(origin).host !== requestHost) {
      return { success: false, error: 'The upload origin could not be verified.', sessions: [] as { uploadUrl: string; name: string; mimeType: string }[] };
    }
    const accessToken = await getGoogleDriveAccessToken();
    const parentFolderId = await ensureRequestGoogleDriveFolder(accessToken, access, context);
    const sessions = await Promise.all(files.map((file) => createGoogleDriveUploadSession(file, accessToken, origin, parentFolderId)));
    return { success: true, sessions, folderId: parentFolderId };
  } catch (error) {
    console.error('Failed to create Google Drive upload sessions:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unable to prepare file uploads.', sessions: [] as { uploadUrl: string; name: string; mimeType: string }[], folderId: undefined };
  }
}

export async function uploadFilesToGoogleDrive(formData: FormData, context?: RequestUploadContext) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access)) return { ...unauthorized, files: [] as StatusAttachment[] };

    const files = formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > MAX_STATUS_ATTACHMENTS) return { success: false, error: `You can attach up to ${MAX_STATUS_ATTACHMENTS} files at once.`, files: [] as StatusAttachment[] };
    if (files.reduce((total, file) => total + file.size, 0) > MAX_STATUS_ATTACHMENT_BYTES) return { success: false, error: 'Attachments must total 100 MB or less.', files: [] as StatusAttachment[] };
    if (files.length === 0) return { success: true, files: [] as StatusAttachment[] };

    const accessToken = await getGoogleDriveAccessToken();
    const parentFolderId = await ensureRequestGoogleDriveFolder(accessToken, access, context);
    const uploadedFiles = await Promise.all(files.map((file) => uploadFileToGoogleDrive(file, accessToken, parentFolderId)));
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

async function ensureRequestEvaluationForms(request: typeof requests.$inferSelect, tx?: Transaction): Promise<{ participantFeedbackFormId: string | null; participantFeedbackFormUrl: string | null }> {
  if (!tx) return withTransaction(async (transaction) => {
    const [current] = await transaction.select().from(requests).where(eq(requests.id, request.id)).for('update');
    if (!current) throw new Error('Request not found.');
    const [parent] = await transaction.select().from(capdevs).where(eq(capdevs.id, current.capdevId)).for('update');
    if (isArchiveReadOnly(current, parent)) return { participantFeedbackFormId: current.participantFeedbackFormId, participantFeedbackFormUrl: current.participantFeedbackFormUrl };
    return ensureRequestEvaluationForms(current, transaction);
  });
  const [capdev] = await db.select({ aipCode: capdevs.aipCode }).from(capdevs).where(eq(capdevs.id, request.capdevId)).limit(1);
  if (!capdev) throw new Error('The request CapDev project was not found.');

  let participantFeedbackFormId = request.participantFeedbackFormId;
  let participantFeedbackFormUrl = request.participantFeedbackFormUrl;
  // The former two-form workflow always stored a supervisor form. Treat that
  // as a legacy test pair and replace the visible participant form once.
  const hasLegacyTestForms = Boolean(request.supervisorEvaluationFormId || request.supervisorEvaluationFormUrl)
    || (participantFeedbackFormId ? await isLegacyRequestEvaluationForm(participantFeedbackFormId) : false);

  if (!participantFeedbackFormId || !participantFeedbackFormUrl || hasLegacyTestForms) {
    const form = await createRequestEvaluationForm({ requestId: request.id, aipCode: capdev.aipCode });
    participantFeedbackFormId = form.formId;
    participantFeedbackFormUrl = form.responderUrl;
    await tx.update(requests).set({
      participantFeedbackFormId,
      participantFeedbackFormUrl,
      supervisorEvaluationFormId: null,
      supervisorEvaluationFormUrl: null,
    }).where(eq(requests.id, request.id));
  }

  return {
    participantFeedbackFormId,
    participantFeedbackFormUrl,
  };
}

export async function getOrCreateRequestEvaluationForms(requestId: number) {
  try {
    const access = await getCurrentAccess();
    const request = access ? await getAccessibleRequest(access, requestId) : null;
    if (!request) return { success: false as const, error: unauthorized.error };
    if (request.status !== 'completed') return { success: false as const, error: 'Evaluation forms are available after completion.' };
    if (request.setting !== 'internal') return { success: false as const, error: 'Evaluation forms are available for In-House requests only.' };
    const forms = isArchiveReadOnly(request, { archivedAt: request.parentArchivedAt })
      ? { participantFeedbackFormId: request.participantFeedbackFormId, participantFeedbackFormUrl: request.participantFeedbackFormUrl }
      : await ensureRequestEvaluationForms(request);
    return { success: true as const, forms };
  } catch (error) {
    console.error('Failed to prepare request evaluation forms:', error);
    return { success: false as const, error: error instanceof Error ? error.message : 'Unable to generate evaluation forms.' };
  }
}

export async function getRequestEvaluationSummary(
  requestId: number,
): Promise<{ success: true; summary: EvaluationSummary } | { success: false; error: string }> {
  try {
    const access = await getCurrentAccess();
    const request = access ? await getAccessibleRequest(access, requestId) : null;
    if (!request) return { success: false, error: unauthorized.error };
    if (request.status !== 'completed') return { success: false, error: 'Evaluation summaries are available after completion.' };
    if (request.setting !== 'internal') return { success: false, error: 'Evaluation summaries are available for In-House requests only.' };
    const forms = isArchiveReadOnly(request, { archivedAt: request.parentArchivedAt })
      ? { participantFeedbackFormId: request.participantFeedbackFormId, participantFeedbackFormUrl: request.participantFeedbackFormUrl }
      : await ensureRequestEvaluationForms(request);
    const formId = forms.participantFeedbackFormId;
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
    if (status !== 'completed' && status !== 'denied') return { success: false, error: 'Invalid request status.' };
    const req = await getWritableRequest(access, requestId);
    if (!req) return unauthorized;
    if (req.isStopped && access.role === 'employee') {
      return { success: false, error: 'This request is stopped. Progress must be resumed before you can complete or deny it.' };
    }

    const forms = await withTransaction(async (tx) => {
      const [current] = await tx.select().from(requests).where(eq(requests.id, requestId)).for('update');
      if (!current || (access.role === 'employee' && current.userId !== access.userId)) throw new Error(unauthorized.error);
      const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, current.capdevId)).for('update');
      if (isArchiveReadOnly(current, parent)) throw new Error(ARCHIVED_READ_ONLY);
      if (current.isStopped && access.role === 'employee') throw new Error('This request is stopped.');
      const forms = status === 'completed' && current.setting === 'internal' ? await ensureRequestEvaluationForms(current, tx) : null;
      await tx.update(requests).set({ status, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, requestId));
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        userId: current.userId || null,
        capdevId: current.capdevId,
        requestId,
        title: `${current.requestorName || 'Requestor'} · Request ${status === 'completed' ? 'Completed' : 'Denied'}`,
        message: `The request for ${current.requestorName || 'Requestor'} was resolved as ${status}.`,
        link: `/portal/capdev/${current.capdevId}/requests/${requestId}/status#request-status-resolution`,
        type: status,
      });
      return forms;
    });

    await writeAuditLog(access, { action: 'status_changed', entityType: 'request', entityId: requestId, entityLabel: `Request #${requestId}`, details: { capdevId: req.capdevId, requestorName: req.requestorName, previousStatus: req.status, status } });

    scheduleNotificationEmails();

    return { success: true, forms };
  } catch (error) {
    console.error('Failed to update request status:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database update failed' };
  }
}

export async function stopRequestProgress(data: StopRequestInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canControlRequestStop(access) || !await getWritableRequest(access, data.requestId)) return unauthorized;
    const additionalInfo = validatePendingAttachments(data.additionalInfo || {}, access.userId);
    if (!data.reason.trim()) return { success: false, error: 'A stopper reason is required.' };
    const { data: session } = await auth.getSession();
    const { stopper } = await withTransaction(async (tx) => {
      const [request] = await tx.select().from(requests).where(eq(requests.id, data.requestId)).for('update');
      const [parent] = request ? await tx.select().from(capdevs).where(eq(capdevs.id, request.capdevId)).for('update') : [];
      if (isArchiveReadOnly(request, parent)) throw new Error(ARCHIVED_READ_ONLY);
      if (!request || request.status === 'completed' || request.status === 'denied') throw new Error('This request is already concluded.');
      if (request.isStopped) throw new Error('This request is already stopped.');

      const [stopper] = await tx.insert(requestStatusUpdates).values({
      requestId: data.requestId,
      userId: access.userId,
      authorName: session?.user?.name || session?.user?.email || 'Staff member',
      statusUpdate: data.reason.trim(),
      files: data.files || [],
      additionalInfo,
      isStopper: true,
      }).returning();
      await tx.update(requests).set({ isStopped: true, activeStopperId: stopper.id, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, data.requestId));
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        userId: request.userId,
        capdevId: request.capdevId,
        requestId: data.requestId,
        title: `${request.requestorName || 'Requestor'} · Request Stopped`,
        message: `${session?.user?.name || session?.user?.email || 'Staff'} stopped progress: ${data.reason.trim().slice(0, 90)}`,
        link: `/portal/capdev/${request.capdevId}/requests/${data.requestId}/status#request-status-update-${stopper.id}`,
        type: 'status_update',
      });
      return { request, stopper };
    });
    await writeAuditLog(access, { action: 'stopped', entityType: 'request', entityId: data.requestId, entityLabel: `Request #${data.requestId}`, details: { reason: data.reason.trim(), statusUpdateId: stopper.id } });
    scheduleNotificationEmails();
    return { success: true, statusUpdateId: stopper.id };
  } catch (error) {
    console.error('Failed to stop request progress:', error);
    return { success: false, error: 'Unable to stop request progress.' };
  }
}

export async function resumeRequestProgress(requestId: number) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canControlRequestStop(access) || !await getWritableRequest(access, requestId)) return unauthorized;
    const { data: session } = await auth.getSession();
    const request = await withTransaction(async (tx) => {
      const [request] = await tx.select().from(requests).where(eq(requests.id, requestId)).for('update');
      const [parent] = request ? await tx.select().from(capdevs).where(eq(capdevs.id, request.capdevId)).for('update') : [];
      if (isArchiveReadOnly(request, parent)) throw new Error(ARCHIVED_READ_ONLY);
      if (!request?.isStopped || !request.activeStopperId) throw new Error('This request is not stopped.');
      const [activeStopper] = await tx.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, request.activeStopperId));
      if (activeStopper?.archivedAt) throw new Error(ARCHIVED_READ_ONLY);
      const [resumed] = await tx.insert(requestStatusUpdates).values({ requestId, userId: access.userId, authorName: session?.user?.name || session?.user?.email || 'Staff member', statusUpdate: 'Progress resumed.', isResume: true, stopperId: request.activeStopperId }).returning({ id: requestStatusUpdates.id });
      await tx.update(requests).set({ isStopped: false, activeStopperId: null, updatedById: access.userId, updatedAt: new Date() }).where(eq(requests.id, requestId));
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        userId: request.userId,
        capdevId: request.capdevId,
        requestId,
        title: `${request.requestorName || 'Requestor'} · Request Resumed`,
        message: `${session?.user?.name || session?.user?.email || 'Staff'} resumed progress.`,
        link: `/portal/capdev/${request.capdevId}/requests/${requestId}/status#request-status-update-${resumed.id}`,
        type: 'status_update',
      });
      return request;
    });
    await writeAuditLog(access, { action: 'resumed', entityType: 'request', entityId: requestId, entityLabel: `Request #${requestId}`, details: { stopperId: request.activeStopperId } });
    scheduleNotificationEmails();
    return { success: true };
  } catch (error) {
    console.error('Failed to resume request progress:', error);
    return { success: false, error: 'Unable to resume request progress.' };
  }
}

export async function createRequestStatusUpdate(data: StatusUpdateInput) {
  try {
    const access = await getCurrentAccess();
    if (!access || !canManageRequests(access) || !await getWritableRequest(access, data.requestId)) return unauthorized;
    data = { ...data, additionalInfo: validatePendingAttachments(data.additionalInfo || {}, access.userId) };
    for (const flag of [data.markAsComplete, data.subtractsRequestedAmount, data.isStopperResponse]) {
      if (flag !== undefined && typeof flag !== 'boolean') return { success: false, error: 'Invalid status update options.' };
    }
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

    if (!isStopperResponse) {
      const selectionError = await validateComboboxValues('status', data.additionalInfo || {});
      if (selectionError) return { success: false, error: selectionError };
    }

    if (!data.statusUpdate?.trim() || data.statusUpdate.length > 20000) return { success: false, error: 'Enter a status update of up to 20,000 characters.' };
    if (isStopperResponse && (data.subtractsRequestedAmount || data.markAsComplete)) return { success: false, error: 'A stopper response cannot deduct budget or complete a request.' };
    const deductedAmount = data.deductedAmount === undefined || data.deductedAmount === '' ? undefined : validateMoney(data.deductedAmount);
    const createdUpdate = await withTransaction(async (tx) => {
      const createdUpdate = await writeRequestStatusUpdate(tx, access.role, {
      requestId: data.requestId, userId: access.userId,
      authorName: session?.user?.name || session?.user?.email || 'Staff member',
      statusUpdate: data.statusUpdate, remarks: data.remarks || null, files: data.files || [],
      statusMark: data.statusMark || null, markAsComplete: Boolean(data.markAsComplete),
      subtractsRequestedAmount: Boolean(data.subtractsRequestedAmount), isStopperResponse,
      stopperId: isStopperResponse ? data.stopperId : null, additionalInfo: data.additionalInfo || {},
      deductedAmount,
      });
      await insertNotificationEvent(tx, {
        actorId: access.userId,
        userId: existingReq[0].userId !== access.userId ? existingReq[0].userId : null,
        capdevId: existingReq[0].capdevId,
        requestId: data.requestId,
        title: data.statusMark
          ? `${existingReq[0].requestorName || 'Requestor'} · Update: [${data.statusMark.toUpperCase()}]`
          : `${existingReq[0].requestorName || 'Requestor'} · Status Update`,
        message: `${session?.user?.name || session?.user?.email || 'Staff'}: ${data.statusUpdate.slice(0, 90)}`,
        link: `/portal/capdev/${existingReq[0].capdevId}/requests/${data.requestId}/status#request-status-update-${isStopperResponse ? data.stopperId : createdUpdate.id}`,
        type: 'status_update',
      });
      return createdUpdate;
    });

    await writeAuditLog(access, {
      action: 'created',
      entityType: 'status_update',
      entityId: createdUpdate.id,
      entityLabel: `Status update for Request #${data.requestId}`,
      details: {
        requestId: data.requestId,
        requestorName: existingReq[0].requestorName,
        statusUpdate: data.statusUpdate,
        remarks: data.remarks || null,
        capdevId: existingReq[0].capdevId,
        statusMark: data.statusMark || null,
        isStopperResponse,
        subtractsRequestedAmount: Boolean(data.subtractsRequestedAmount),
        deductedAmount: data.subtractsRequestedAmount ? (data.deductedAmount || existingReq[0].requestedBudget) : null,
      },
    });

    // 3. Send notification (notifies request owner or other staff, never the actor who posted the status update)
    scheduleNotificationEmails();

    return { success: true, statusUpdateId: createdUpdate.id };
  } catch (error) {
    console.error('Failed to create request status update:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Database insert failed' };
  }
}

export type NotificationItem = {
  id: number;
  userId: string | null;
  actorId?: string | null;
  capdevId: number | null;
  requestId: number | null;
  title: string;
  message: string;
  link: string;
  type: string;
  isRead: boolean;
  createdAt: Date | string;
};

export async function getEmailNotificationPreferences() {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false as const, error: unauthorized.error };
    const [preference] = await db.select().from(emailNotificationPreferences)
      .where(eq(emailNotificationPreferences.userId, access.userId)).limit(1);
    return { success: true as const, enabledTypes: validateEmailTypes(preference?.enabledTypes ?? DEFAULT_EMAIL_TYPES) };
  } catch {
    return { success: false as const, error: 'Unable to load email preferences.' };
  }
}

export async function saveEmailNotificationPreferences(types: unknown) {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false as const, error: unauthorized.error };
    const enabledTypes = validateEmailTypes(types);
    await db.insert(emailNotificationPreferences).values({ userId: access.userId, enabledTypes })
      .onConflictDoUpdate({ target: emailNotificationPreferences.userId, set: { enabledTypes, updatedAt: new Date() } });
    return { success: true as const };
  } catch {
    return { success: false as const, error: 'Unable to save email preferences.' };
  }
}

export async function getNotifications(): Promise<{ success: boolean; notifications: NotificationItem[]; unreadCount: number }> {
  try {
    const access = await getCurrentAccess();
    if (!access) return { success: false, notifications: [], unreadCount: 0 };

    await syncRequestReminders(access);
    scheduleNotificationEmails();

    const userReads = await db.select({ notificationId: notificationReads.notificationId })
      .from(notificationReads)
      .where(eq(notificationReads.userId, access.userId));
    const readIds = new Set(userReads.map(r => r.notificationId));

    const rows = await db.select({ notification: getTableColumns(notifications), requestorName: requests.requestorName })
      .from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .where(notificationAudienceCondition(access))
      .orderBy(desc(sql`CASE WHEN ${notifications.type} = 'inactivity_reminder' THEN 1 ELSE 0 END`), desc(notifications.createdAt))
      .limit(30);

    const reminderRequestIds = rows.filter(({ notification }) => notification.type === 'inactivity_reminder')
      .map(({ notification }) => notification.requestId).filter((id): id is number => id !== null);
    const inactivity = await getRequestInactivitySummaries(reminderRequestIds);
    const formatted: NotificationItem[] = rows.map(({ notification: n, requestorName }) => ({
      id: n.id,
      userId: n.userId,
      actorId: n.actorId,
      capdevId: n.capdevId,
      requestId: n.requestId,
      title: requestNotificationWording(n.title, requestorName),
      message: n.type === 'inactivity_reminder' && n.requestId && inactivity.has(n.requestId)
        ? inactivityMessage(inactivity.get(n.requestId)!.days) : requestNotificationWording(n.message, requestorName),
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


export async function requestPasswordReset(rawEmail: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const generic = { success: true, message: 'If an account exists, a verification code has been sent. Please wait before requesting another.' };
  try {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return generic;
    if (!await limitVerification('reset-send', email, true)) return generic;
    const result = await db.execute(sql`SELECT email FROM neon_auth.user WHERE LOWER(email) = ${email} LIMIT 1`);
    if (!result.rows.length) return generic;
    const code = verificationCode();
    await withTransaction(async (tx) => {
      await tx.delete(passwordResets).where(eq(passwordResets.email, email));
      await tx.insert(passwordResets).values({ email, code: verificationHash('reset', email, code), expiresAt: new Date(Date.now() + 900000) });
    });
    await sendPasswordResetEmail(String(result.rows[0].email), code);
    return generic;
  } catch (error) {
    console.error('Password reset request failed:', error);
    return generic;
  }
}

export async function requestSignupVerificationCode(rawEmail: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const generic = { success: true, message: 'If this email can be registered, a verification code has been sent. Please wait before requesting another.' };
  try {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!isAllowedSignupEmail(email)) return { success: false, error: SIGNUP_EMAIL_ERROR };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return { success: false, error: 'Please enter a valid email address.' };
    if (!await limitVerification('signup-send', email, true)) return generic;
    const existing = await db.execute(sql`SELECT id FROM neon_auth.user WHERE LOWER(email) = ${email} LIMIT 1`);
    if (existing.rows.length) return generic;
    const code = verificationCode();
    await withTransaction(async (tx) => {
      await tx.delete(signupVerifications).where(eq(signupVerifications.email, email));
      await tx.insert(signupVerifications).values({ email, code: verificationHash('signup', email, code), expiresAt: new Date(Date.now() + 900000), isVerified: false });
    });
    await sendSignupVerificationEmail(email, code);
    return generic;
  } catch (error) {
    console.error('Signup verification request failed:', error);
    return { success: false, error: 'Unable to send a verification code. Please try again later.' };
  }
}

export async function verifySignupCode(rawEmail: string, rawCode: string) {
  try {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!isAllowedSignupEmail(email)) return { success: false, error: SIGNUP_EMAIL_ERROR };
    if (!email || email.length > 255) return { success: false, error: 'Invalid or expired verification code.' };
    if (!await limitVerification('signup-verify', email)) return { success: false, error: 'Too many attempts. Please try again later.' };
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!/^\d{6}$/.test(code)) return { success: false, error: 'Invalid or expired verification code.' };
    const verified = await db.update(signupVerifications).set({ isVerified: true }).where(and(
      eq(signupVerifications.email, email), eq(signupVerifications.code, verificationHash('signup', email, code)),
      sql`${signupVerifications.expiresAt} > NOW()`, eq(signupVerifications.isVerified, false),
    )).returning({ id: signupVerifications.id });
    return verified.length ? { success: true, message: 'Email verified successfully.' } : { success: false, error: 'Invalid or expired verification code.' };
  } catch (error) {
    console.error('Signup verification failed:', error);
    return { success: false, error: 'Unable to verify the code.' };
  }
}

export async function verifyAndResetPassword(rawEmail: string, rawCode: string, newPassword: string) {
  try {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email || email.length > 255) return { success: false, error: 'Invalid or expired verification code.' };
    if (!await limitVerification('reset-verify', email)) return { success: false, error: 'Too many attempts. Please try again later.' };
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!/^\d{6}$/.test(code) || typeof newPassword !== 'string') return { success: false, error: 'Invalid or expired verification code.' };
    const passwordError = getPasswordValidationError(newPassword);
    if (passwordError) return { success: false, error: passwordError };
    const codeHash = verificationHash('reset', email, code);
    const [candidate] = await db.select({ id: passwordResets.id }).from(passwordResets).where(and(eq(passwordResets.email, email), eq(passwordResets.code, codeHash), sql`${passwordResets.expiresAt} > NOW()`)).limit(1);
    if (!candidate) return { success: false, error: 'Invalid or expired verification code.' };
    const hashedPassword = await hashPassword(newPassword);
    const changed = await withTransaction(async (tx) => {
      // Deleting the matching code here makes concurrent reuse impossible.
      const consumed = await tx.delete(passwordResets).where(and(eq(passwordResets.id, candidate.id), eq(passwordResets.code, codeHash), sql`${passwordResets.expiresAt} > NOW()`)).returning();
      if (!consumed.length) return false;
      const userResult = await tx.execute(sql`SELECT id FROM neon_auth.user WHERE LOWER(email) = ${email} LIMIT 1`);
      if (!userResult.rows.length) throw new Error('Account unavailable.');
      const userId = String(userResult.rows[0].id);
      const updated = await tx.execute(sql`UPDATE neon_auth.account SET password = ${hashedPassword}, "updatedAt" = NOW() WHERE "userId" = ${userId} AND "providerId" = 'credential' RETURNING id`);
      if (!updated.rows.length) throw new Error('Password login is unavailable for this account.');
      await tx.execute(sql`DELETE FROM neon_auth.session WHERE "userId" = ${userId}`);
      await tx.delete(mcpOAuthGrants).where(eq(mcpOAuthGrants.userId, userId));
      await tx.delete(passwordResets).where(eq(passwordResets.email, email));
      return true;
    });
    return changed ? { success: true, message: 'Password has been successfully updated.' } : { success: false, error: 'Invalid or expired verification code.' };
  } catch (error) {
    console.error('Password reset failed:', error);
    return { success: false, error: 'Unable to reset the password. Please request a new code.' };
  }
}

export async function handleChatbotActivityDesignUpload(
  fileData: ActivityDesignFileInput,
  attachment?: StatusAttachment
) {
  const access = await getCurrentAccess();
  if (!access) return { success: false as const, error: unauthorized.error };
  if (!canManageRequests(access)) {
    return { success: false as const, error: 'You do not have permission to create requests.' };
  }

  const schemaResult = await getRequestFormSchemaService(access);
  if (!schemaResult.success) {
    return { success: false as const, error: 'Unable to load request schema.' };
  }

  const extractResult = await extractActivityDesignWithGemini(fileData, schemaResult);
  if (!extractResult.success || !extractResult.data) {
    return { success: false as const, error: extractResult.error || 'Failed to extract activity design.' };
  }

  const extracted = extractResult.data;
  if (!extracted.isActivityDesign) {
    return {
      success: true as const,
      isActivityDesign: false,
      reply: extracted.explanation || 'I reviewed the provided image.',
      draft: null,
      extracted,
    };
  }

  const draftResult = await createRequestDraftService(access, {
    aipCode: extracted.aipCode || undefined,
    setting: extracted.setting || 'internal',
    requestedBudget: extracted.requestedBudget || undefined,
    description: extracted.description || undefined,
    dynamicFields: extracted.dynamicFields,
    sourceFile: attachment,
  });

  const reply = extracted.description
    ? `I found an activity design for **${extracted.description}**.`
    : 'I found an activity design.';

  return {
    success: true as const,
    isActivityDesign: true,
    reply,
    draft: draftResult.draft,
    extracted,
  };
}

export async function handleChatbotAipCodeInput(
  aipCode: string,
  currentDraft: RequestDraftInput
) {
  const access = await getCurrentAccess();
  if (!access) return { success: false as const, error: unauthorized.error };
  if (!canManageRequests(access)) {
    return { success: false as const, error: 'You do not have permission to create requests.' };
  }

  const capdevResult = await findCapdevByAipCodeService(access, aipCode);
  if (!capdevResult.success) {
    return {
      success: false as const,
      error: capdevResult.error || `CapDev project with AIP Code “${aipCode}” was not found.`,
    };
  }

  const updatedDraftInput: RequestDraftInput = {
    ...currentDraft,
    aipCode: capdevResult.capdev.aipCode,
  };

  const draftResult = await createRequestDraftService(access, updatedDraftInput);

  let reply = '';
  if (draftResult.draft.missingRequiredFields.length > 0) {
    reply = `Connected to CapDev **${capdevResult.capdev.aipCode}** (${capdevResult.capdev.department || 'All Departments'}). Please provide the missing required information: ${draftResult.draft.missingRequiredFields.join(', ')}.`;
  } else if (!draftResult.draft.budgetValidation.isValid) {
    reply = `Connected to CapDev **${capdevResult.capdev.aipCode}**. ${draftResult.draft.budgetValidation.error || 'Requested budget exceeds remaining CapDev balance.'}`;
  } else {
    reply = `Connected to CapDev **${capdevResult.capdev.aipCode}**. Review the request draft below and confirm when ready.`;
  }

  return {
    success: true as const,
    reply,
    draft: draftResult.draft,
    capdev: capdevResult.capdev,
  };
}

export async function handleChatbotSubmitRequest(submission: RequestSubmissionInput) {
  const access = await getCurrentAccess();
  if (!access) return { success: false as const, error: unauthorized.error };
  return await submitRequestService(access, submission);
}

export async function callMcpToolAction(toolName: string, args: Record<string, unknown>) {
  const access = await getCurrentAccess();
  if (!access) return { success: false as const, error: unauthorized.error };
  return await executeMcpTool(access, toolName, args);
}
