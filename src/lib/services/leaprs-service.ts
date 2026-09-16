import { db } from '@/db';
import {
  capdevs,
  requests,
  requestFieldDefinitions,
  requestStatusUpdates,
  auditLogs,
  notifications,
} from '@/db/schema';
import { and, desc, eq, getTableColumns } from 'drizzle-orm';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';

export type AppRole = 'admin' | 'employee' | 'employee-department' | 'viewer' | 'viewer-full';
export type UserAccess = { userId: string; role: AppRole; department: string; name?: string; email?: string };

export type StatusAttachment = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
};

export type DynamicFieldSchema = {
  id: number;
  name: string;
  type: string;
  options: unknown[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition: string;
  sortOrder: number;
  placeholder: string | null;
};

export type RequestDraftInput = {
  aipCode?: string;
  setting?: 'internal' | 'external';
  requestedBudget?: number | string;
  description?: string;
  dynamicFields?: Record<string, unknown>;
  attachments?: StatusAttachment[];
  sourceFile?: StatusAttachment;
};

export type RequestSubmissionInput = {
  aipCode: string;
  setting: 'internal' | 'external';
  requestedBudget: string | number;
  description?: string;
  dynamicFields?: Record<string, unknown>;
  attachments?: StatusAttachment[];
  sourceFile?: StatusAttachment;
  userConfirmed: boolean;
};

export function canAccessCapdev(access: UserAccess, capdev: { department: string }) {
  return (
    access.role === 'admin' ||
    access.role === 'viewer-full' ||
    access.role === 'employee' ||
    access.role === 'employee-department' ||
    capdev.department === access.department
  );
}

export function canManageRequests(access: UserAccess) {
  return access.role === 'admin' || access.role === 'employee' || access.role === 'employee-department';
}

export async function writeAuditLogEntry(
  access: UserAccess,
  entry: {
    action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'stopped' | 'resumed';
    entityType: 'capdev' | 'request' | 'status_update' | 'user' | 'capdev_field' | 'request_field' | 'system_setting';
    entityId?: string | number | null;
    entityLabel: string;
    details?: Record<string, unknown>;
  }
) {
  const details = { ...(entry.details || {}) };
  if (typeof details.capdevId === 'number' && typeof details.capdevAipCode !== 'string') {
    const [capdev] = await db
      .select({ aipCode: capdevs.aipCode })
      .from(capdevs)
      .where(eq(capdevs.id, details.capdevId))
      .limit(1);
    if (capdev) details.capdevAipCode = capdev.aipCode;
  }
  await db.insert(auditLogs).values({
    actorId: access.userId,
    actorName: access.name || access.email || 'LEAPRS User',
    actorEmail: access.email || null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    entityLabel: entry.entityLabel,
    details,
  });
}

export async function emitNotification(input: {
  actorId?: string;
  userId?: string;
  capdevId?: number;
  requestId?: number;
  title: string;
  message: string;
  link: string;
  type: string;
}) {
  await db.insert(notifications).values({
    actorId: input.actorId || null,
    userId: input.userId || null,
    capdevId: input.capdevId || null,
    requestId: input.requestId || null,
    title: input.title,
    message: input.message,
    link: input.link,
    type: input.type,
  });
}

/**
 * 1. find_capdev_by_aip_code:
 * Validates AIP code format, verifies existence, checks access control.
 */
export async function findCapdevByAipCodeService(access: UserAccess, aipCode: string) {
  const cleanedCode = aipCode.trim();
  if (!cleanedCode) {
    return { success: false as const, error: 'AIP Code is required.' };
  }

  const [capdev] = await db
    .select()
    .from(capdevs)
    .where(eq(capdevs.aipCode, cleanedCode))
    .limit(1);

  if (!capdev) {
    return { success: false as const, error: `CapDev project with AIP Code “${cleanedCode}” was not found.` };
  }

  if (!canAccessCapdev(access, capdev)) {
    return { success: false as const, error: 'You do not have permission to access this CapDev project.' };
  }

  return {
    success: true as const,
    capdev: {
      id: capdev.id,
      aipCode: capdev.aipCode,
      department: capdev.department,
      description: capdev.description,
      initialBudget: String(capdev.initialBudget),
      remainingBudget: String(capdev.budget),
      additionalInfo: capdev.additionalInfo,
    },
  };
}

/**
 * 2. get_request_form_schema:
 * Returns fixed fields and active dynamic request form fields.
 */
export async function getRequestFormSchemaService(_access?: UserAccess) {
  const dynamicFields = await db
    .select()
    .from(requestFieldDefinitions)
    .where(eq(requestFieldDefinitions.isActive, true))
    .orderBy(requestFieldDefinitions.sortOrder);

  const fixedFields = [
    {
      name: 'setting',
      label: 'Setting',
      type: 'select',
      options: ['internal', 'external'],
      isRequired: true,
      description: 'Internal or External training/activity setting.',
    },
    {
      name: 'requestedBudget',
      label: 'Amount',
      type: 'number',
      isRequired: true,
      description: 'Total requested budget amount in PHP.',
    },
    {
      name: 'description',
      label: 'Activity Description',
      type: 'text',
      isRequired: false,
      description: 'Brief overview or title of the activity requisition.',
    },
  ];

  return {
    success: true as const,
    fixedFields,
    dynamicFields: dynamicFields.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      options: Array.isArray(field.options) ? field.options : null,
      isRequired: field.isRequired,
      section: field.isRequired ? 'required' : 'optional',
      width: field.width,
      columnPosition: field.columnPosition,
      sortOrder: field.sortOrder,
      placeholder: field.placeholder,
    })),
  };
}

/**
 * 3. create_request_draft:
 * Formulates and validates a structured draft without persisting to database.
 */
export async function createRequestDraftService(access: UserAccess, draft: RequestDraftInput) {
  const schema = await getRequestFormSchemaService(access);
  const missingRequiredFields: string[] = [];

  let capdevInfo: { id: number; aipCode: string; department: string; remainingBudget: number } | null = null;
  const budgetValidation = {
    isValid: true,
    requestedBudget: Number(draft.requestedBudget || 0),
    remainingBudget: 0,
    error: undefined as string | undefined,
  };

  if (draft.aipCode) {
    const capdevResult = await findCapdevByAipCodeService(access, draft.aipCode);
    if (capdevResult.success) {
      const remaining = Number(capdevResult.capdev.remainingBudget || 0);
      capdevInfo = {
        id: capdevResult.capdev.id,
        aipCode: capdevResult.capdev.aipCode,
        department: capdevResult.capdev.department,
        remainingBudget: remaining,
      };
      budgetValidation.remainingBudget = remaining;
      if (budgetValidation.requestedBudget > remaining) {
        budgetValidation.isValid = false;
        budgetValidation.error = `Requested amount ₱${budgetValidation.requestedBudget.toLocaleString('en-PH', { minimumFractionDigits: 2 })} exceeds remaining CapDev balance ₱${remaining.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`;
      }
    } else {
      missingRequiredFields.push('AIP Code');
    }
  } else {
    missingRequiredFields.push('AIP Code');
  }

  if (!draft.setting || !['internal', 'external'].includes(draft.setting)) {
    missingRequiredFields.push('Setting');
  }

  if (!draft.requestedBudget || Number(draft.requestedBudget) <= 0) {
    missingRequiredFields.push('Amount');
  }

  // Check required dynamic fields
  const dynamicValues = draft.dynamicFields || {};
  for (const field of schema.dynamicFields) {
    if (field.isRequired) {
      const value = getDynamicFieldValue(dynamicValues, field);
      let hasValue = false;
      if (field.type === 'file') {
        hasValue = Array.isArray(value) && value.length > 0;
      } else if (field.type === 'table') {
        hasValue = Array.isArray(value) && value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      } else {
        hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
      }
      if (!hasValue) {
        missingRequiredFields.push(field.name);
      }
    }
  }

  const allAttachments: StatusAttachment[] = [
    ...(draft.attachments || []),
    ...(draft.sourceFile ? [draft.sourceFile] : []),
  ];

  const isReadyForSubmission = missingRequiredFields.length === 0 && budgetValidation.isValid && capdevInfo !== null;

  return {
    success: true as const,
    draft: {
      aipCode: draft.aipCode || null,
      capdev: capdevInfo,
      setting: draft.setting || 'internal',
      requestedBudget: draft.requestedBudget ? String(draft.requestedBudget) : '',
      description: draft.description || '',
      dynamicFields: dynamicValues,
      attachments: allAttachments,
      sourceFile: draft.sourceFile || null,
      missingRequiredFields,
      budgetValidation,
      isReadyForSubmission,
    },
  };
}

/**
 * 4. submit_request:
 * Persists a validated request to the database, enforcing user confirmation and budget limits.
 */
export async function submitRequestService(access: UserAccess, input: RequestSubmissionInput) {
  if (!input.userConfirmed) {
    return { success: false as const, error: 'User confirmation is required before submitting a request.' };
  }

  if (!canManageRequests(access)) {
    return { success: false as const, error: 'You do not have permission to submit requests.' };
  }

  const aipCode = input.aipCode.trim();
  const capdevResult = await findCapdevByAipCodeService(access, aipCode);
  if (!capdevResult.success) {
    return { success: false as const, error: capdevResult.error };
  }

  const capdev = capdevResult.capdev;
  const requestedBudgetNum = Number(input.requestedBudget);
  const remainingBudgetNum = Number(capdev.remainingBudget);

  if (isNaN(requestedBudgetNum) || requestedBudgetNum <= 0) {
    return { success: false as const, error: 'Enter a valid requested budget amount.' };
  }

  if (requestedBudgetNum > remainingBudgetNum) {
    return {
      success: false as const,
      error: `Requested amount ₱${requestedBudgetNum.toLocaleString('en-PH', { minimumFractionDigits: 2 })} exceeds remaining CapDev balance ₱${remainingBudgetNum.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`,
    };
  }

  // Validate dynamic required fields
  const schema = await getRequestFormSchemaService(access);
  const additionalInfo: Record<string, unknown> = { ...(input.dynamicFields || {}) };
  const missingFields: string[] = [];

  for (const field of schema.dynamicFields) {
    const value = getDynamicFieldValue(additionalInfo, field);
    if (field.isRequired) {
      let hasValue = false;
      if (field.type === 'file') {
        hasValue = Array.isArray(value) && value.length > 0;
      } else if (field.type === 'table') {
        hasValue = Array.isArray(value) && value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      } else {
        hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
      }
      if (!hasValue) {
        missingFields.push(field.name);
      }
    }
  }

  // Attach sourceFile or attachments if provided
  if (input.sourceFile || (input.attachments && input.attachments.length > 0)) {
    const existingAttachments = Array.isArray(additionalInfo.attachments) ? (additionalInfo.attachments as StatusAttachment[]) : [];
    const newAttachments = [
      ...existingAttachments,
      ...(input.attachments || []),
      ...(input.sourceFile ? [input.sourceFile] : []),
    ];
    // Deduplicate attachments by id
    const uniqueAttachments = Array.from(new Map(newAttachments.map((file) => [file.id, file])).values());
    additionalInfo.attachments = uniqueAttachments;

    // Also place in the first active file field if one exists and is empty
    const firstFileField = schema.dynamicFields.find((f) => f.type === 'file');
    if (firstFileField) {
      const key = dynamicFieldStorageKey(firstFileField);
      if (!additionalInfo[key] || (Array.isArray(additionalInfo[key]) && (additionalInfo[key] as unknown[]).length === 0)) {
        additionalInfo[key] = uniqueAttachments;
      }
    }
  }

  if (missingFields.length > 0) {
    return {
      success: false as const,
      error: `Complete the required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.`,
    };
  }

  const [created] = await db
    .insert(requests)
    .values({
      capdevId: capdev.id,
      userId: access.userId,
      requestorName: access.name || access.email || 'Requestor',
      setting: input.setting,
      description: input.description || '',
      requestedBudget: String(requestedBudgetNum),
      additionalInfo,
      status: 'in_progress',
      updatedById: access.userId,
    })
    .returning();

  await writeAuditLogEntry(access, {
    action: 'created',
    entityType: 'request',
    entityId: created.id,
    entityLabel: `Request #${created.id}`,
    details: {
      capdevId: created.capdevId,
      capdevAipCode: capdev.aipCode,
      setting: created.setting,
      requestedBudget: created.requestedBudget,
      requestorName: created.requestorName,
      createdVia: 'chatbot_mcp',
    },
  });

  void emitNotification({
    actorId: access.userId,
    capdevId: created.capdevId,
    requestId: created.id,
    title: `New Requisition: ${created.setting || 'CapDev Request'}`,
    message: `${created.requestorName || 'Staff'} submitted request #${created.id} for ₱${requestedBudgetNum.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    link: `/portal/capdev/${created.capdevId}/requests#request-record-${created.id}`,
    type: 'new_request',
  });

  return {
    success: true as const,
    request: created,
    link: `/portal/capdev/${created.capdevId}/requests#request-record-${created.id}`,
  };
}

/**
 * 5. get_request_status:
 * Returns request record and latest timeline status updates.
 */
export async function getRequestStatusService(access: UserAccess, requestId: number) {
  const [record] = await db
    .select({ request: getTableColumns(requests), capdevDepartment: capdevs.department, aipCode: capdevs.aipCode })
    .from(requests)
    .innerJoin(capdevs, eq(requests.capdevId, capdevs.id))
    .where(eq(requests.id, requestId))
    .limit(1);

  if (!record) {
    return { success: false as const, error: `Request #${requestId} was not found.` };
  }

  if (access.role === 'employee' && record.request.userId !== access.userId) {
    return { success: false as const, error: 'You do not have permission to view this request.' };
  }

  if (access.role === 'viewer' && record.capdevDepartment !== access.department) {
    return { success: false as const, error: 'You do not have permission to view this request.' };
  }

  const updates = await db
    .select()
    .from(requestStatusUpdates)
    .where(eq(requestStatusUpdates.requestId, requestId))
    .orderBy(requestStatusUpdates.createdAt);

  return {
    success: true as const,
    request: {
      id: record.request.id,
      capdevId: record.request.capdevId,
      capdevAipCode: record.aipCode,
      department: record.capdevDepartment,
      requestorName: record.request.requestorName,
      setting: record.request.setting,
      description: record.request.description,
      requestedBudget: String(record.request.requestedBudget),
      status: record.request.status,
      isStopped: record.request.isStopped,
      createdAt: record.request.createdAt,
      updatedAt: record.request.updatedAt,
      feedbackUrl: record.request.participantFeedbackFormUrl,
      evaluationUrl: record.request.supervisorEvaluationFormUrl,
    },
    statusUpdates: updates.map((u) => ({
      id: u.id,
      authorName: u.authorName,
      statusUpdate: u.statusUpdate,
      remarks: u.remarks,
      statusMark: u.statusMark,
      markAsComplete: u.markAsComplete,
      isStopper: u.isStopper,
      isResume: u.isResume,
      createdAt: u.createdAt,
    })),
  };
}

/**
 * 6. get_my_requests_summary:
 * Returns summary metrics and recent request IDs for the current user/department.
 */
export async function getMyRequestsSummaryService(
  access: UserAccess,
  options?: { limit?: number; status?: string; date?: string }
) {
  const limit = Math.min(Math.max(options?.limit || 10, 1), 50);

  // Build filter based on role
  const conditions = [];
  if (access.role === 'employee') {
    conditions.push(eq(requests.userId, access.userId));
  } else if (access.role === 'viewer' || access.role === 'employee-department') {
    conditions.push(eq(capdevs.department, access.department));
  }

  if (options?.status) {
    conditions.push(eq(requests.status, options.status));
  }

  const rows = await db
    .select({
      request: getTableColumns(requests),
      capdevDepartment: capdevs.department,
      aipCode: capdevs.aipCode,
    })
    .from(requests)
    .innerJoin(capdevs, eq(requests.capdevId, capdevs.id))
    .where(conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined)
    .orderBy(desc(requests.createdAt))
    .limit(limit);

  const total = rows.length;
  const inProgress = rows.filter((r) => r.request.status === 'in_progress' && !r.request.isStopped).length;
  const stopped = rows.filter((r) => r.request.isStopped).length;
  const complete = rows.filter((r) => r.request.status === 'complete').length;

  return {
    success: true as const,
    summary: {
      totalFound: total,
      inProgressCount: inProgress,
      stoppedCount: stopped,
      completeCount: complete,
      userDepartment: access.department,
      userRole: access.role,
    },
    requests: rows.map((r) => ({
      id: r.request.id,
      capdevAipCode: r.aipCode,
      department: r.capdevDepartment,
      setting: r.request.setting,
      description: r.request.description || 'No description',
      requestedBudget: String(r.request.requestedBudget),
      status: r.request.isStopped ? 'stopped' : r.request.status,
      createdAt: r.request.createdAt.toISOString().split('T')[0],
    })),
  };
}

/**
 * 7. get_department_budget_balance:
 * Summarizes initial budget, current remaining budget, and committed spend for a department.
 */
export async function getDepartmentBudgetBalanceService(
  access: UserAccess,
  targetDepartment?: string
) {
  const dept = (access.role === 'admin' && targetDepartment) ? targetDepartment.trim() : access.department;

  const deptCapdevs = await db
    .select({
      id: capdevs.id,
      aipCode: capdevs.aipCode,
      initialBudget: capdevs.initialBudget,
      budget: capdevs.budget,
      description: capdevs.description,
    })
    .from(capdevs)
    .where(eq(capdevs.department, dept));

  let totalInitial = 0;
  let totalRemaining = 0;

  for (const c of deptCapdevs) {
    totalInitial += Number(c.initialBudget || 0);
    totalRemaining += Number(c.budget || 0);
  }

  const totalSpentOrCommitted = Math.max(0, totalInitial - totalRemaining);
  const utilizationRate = totalInitial > 0 ? ((totalSpentOrCommitted / totalInitial) * 100).toFixed(1) : '0.0';

  return {
    success: true as const,
    department: dept,
    totalInitialBudget: totalInitial.toFixed(2),
    totalRemainingBudget: totalRemaining.toFixed(2),
    totalSpentOrCommitted: totalSpentOrCommitted.toFixed(2),
    utilizationPercentage: `${utilizationRate}%`,
    activeProjectsCount: deptCapdevs.length,
    projects: deptCapdevs.slice(0, 10).map((c) => ({
      id: c.id,
      aipCode: c.aipCode,
      description: c.description,
      remainingBudget: String(c.budget),
      initialBudget: String(c.initialBudget),
    })),
  };
}

/**
 * 8. list_available_capdev_projects:
 * Returns available active CapDev projects accessible to the current user.
 */
export async function listAvailableCapdevProjectsService(
  access: UserAccess,
  options?: { limit?: number; department?: string }
) {
  const limit = Math.min(Math.max(options?.limit || 15, 1), 50);
  const dept = (access.role === 'admin' && options?.department) ? options.department.trim() : access.department;

  const conditions = [];
  if (access.role !== 'admin' && access.role !== 'viewer-full') {
    conditions.push(eq(capdevs.department, dept));
  } else if (options?.department) {
    conditions.push(eq(capdevs.department, options.department.trim()));
  }

  const rows = await db
    .select({
      id: capdevs.id,
      aipCode: capdevs.aipCode,
      department: capdevs.department,
      description: capdevs.description,
      initialBudget: capdevs.initialBudget,
      remainingBudget: capdevs.budget,
    })
    .from(capdevs)
    .where(conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined)
    .orderBy(desc(capdevs.createdAt))
    .limit(limit);

  return {
    success: true as const,
    total: rows.length,
    departmentFilter: access.role !== 'admin' && access.role !== 'viewer-full' ? dept : (options?.department || 'All'),
    projects: rows.map((p) => ({
      id: p.id,
      aipCode: p.aipCode,
      department: p.department,
      description: p.description,
      initialBudget: String(p.initialBudget),
      remainingBudget: String(p.remainingBudget),
    })),
  };
}
