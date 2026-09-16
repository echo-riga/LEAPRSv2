import {
  findCapdevByAipCodeService,
  getRequestFormSchemaService,
  createRequestDraftService,
  submitRequestService,
  getRequestStatusService,
  getMyRequestsSummaryService,
  getDepartmentBudgetBalanceService,
  listAvailableCapdevProjectsService,
  type UserAccess,
  type RequestDraftInput,
  type RequestSubmissionInput,
  type StatusAttachment,
} from '@/lib/services/leaprs-service';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const LEAPRS_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'find_capdev_by_aip_code',
    description: 'Finds and validates an active CapDev project by its exact AIP Code, enforcing user department access and returning remaining budget.',
    inputSchema: {
      type: 'object',
      properties: {
        aip_code: {
          type: 'string',
          description: 'The AIP Code of the CapDev project (e.g. 2026-001-1-1-01-001-001).',
        },
      },
      required: ['aip_code'],
    },
  },
  {
    name: 'get_request_form_schema',
    description: 'Retrieves the current fixed and dynamic form fields schema for LEAPRS requests.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_request_status',
    description: 'Retrieves the current status, details, and timeline logs for a specific request ID.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: ['number', 'string'],
          description: 'The numeric database ID of the request (e.g. 30).',
        },
      },
      required: ['request_id'],
    },
  },
  {
    name: 'get_my_requests_summary',
    description: 'Gets the current user or department summary metrics (counts by status) and a list of recent request IDs with titles and statuses.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of requests to list (default 10).',
        },
        status: {
          type: 'string',
          enum: ['in_progress', 'complete', 'stopped'],
          description: 'Optional status filter.',
        },
      },
    },
  },
  {
    name: 'get_department_budget_balance',
    description: 'Summarizes the CapDev budget allocation, current remaining balance, committed amount, and utilization rate for the user’s department.',
    inputSchema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Department name (optional, only admins can query other departments).',
        },
      },
    },
  },
  {
    name: 'list_available_capdev_projects',
    description: 'Lists active CapDev projects available for the user’s department with their AIP Codes and remaining budgets.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of projects to list (default 15).',
        },
        department: {
          type: 'string',
          description: 'Optional department filter for admins.',
        },
      },
    },
  },
  {
    name: 'create_request_draft',
    description: 'Validates and prepares a structured request draft from extracted activity design information without saving to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        aip_code: {
          type: 'string',
          description: 'The CapDev AIP Code to associate this request with.',
        },
        setting: {
          type: 'string',
          enum: ['internal', 'external'],
          description: 'Whether the training/activity is internal or external.',
        },
        requested_budget: {
          type: ['number', 'string'],
          description: 'The requested budget amount in PHP.',
        },
        description: {
          type: 'string',
          description: 'Brief description or activity title.',
        },
        dynamic_fields: {
          type: 'object',
          description: 'Key-value map of dynamic form fields.',
        },
        source_file: {
          type: 'object',
          description: 'The uploaded activity design file metadata.',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            mimeType: { type: 'string' },
            url: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'upload_request_attachment',
    description: 'Validates attachment metadata references for Google Drive storage.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              mimeType: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['id', 'name', 'url'],
          },
          description: 'Array of uploaded file metadata from Google Drive.',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'submit_request',
    description: 'Submits and persists a confirmed request to the database after explicit user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        aip_code: {
          type: 'string',
          description: 'The exact AIP Code of the target CapDev project.',
        },
        setting: {
          type: 'string',
          enum: ['internal', 'external'],
        },
        requested_budget: {
          type: ['number', 'string'],
        },
        description: {
          type: 'string',
        },
        dynamic_fields: {
          type: 'object',
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              mimeType: { type: 'string' },
              url: { type: 'string' },
            },
          },
        },
        source_file: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            mimeType: { type: 'string' },
            url: { type: 'string' },
          },
        },
        user_confirmed: {
          type: 'boolean',
          description: 'Must be true to indicate explicit user confirmation.',
        },
      },
      required: ['aip_code', 'setting', 'requested_budget', 'user_confirmed'],
    },
  },
];

export async function executeMcpTool(
  access: UserAccess,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'find_capdev_by_aip_code': {
        const aipCode = String(args.aip_code || args.aipCode || '').trim();
        const result = await findCapdevByAipCodeService(access, aipCode);
        return result.success ? { success: true, data: result.capdev } : { success: false, error: result.error };
      }

      case 'get_request_form_schema': {
        const result = await getRequestFormSchemaService(access);
        return { success: true, data: result };
      }

      case 'get_request_status': {
        const rawId = args.request_id ?? args.requestId;
        const requestId = typeof rawId === 'number' ? rawId : parseInt(String(rawId || '').replace(/[^0-9]/g, ''), 10);
        if (!requestId || isNaN(requestId)) {
          return { success: false, error: 'A valid numeric request ID is required (e.g. 30).' };
        }
        const result = await getRequestStatusService(access, requestId);
        return result.success ? { success: true, data: result } : { success: false, error: result.error };
      }

      case 'get_my_requests_summary': {
        const limit = args.limit ? Number(args.limit) : undefined;
        const status = typeof args.status === 'string' ? args.status : undefined;
        const result = await getMyRequestsSummaryService(access, { limit, status });
        return result.success ? { success: true, data: result } : { success: false, error: 'Failed to retrieve requests.' };
      }

      case 'get_department_budget_balance': {
        const dept = typeof args.department === 'string' ? args.department : undefined;
        const result = await getDepartmentBudgetBalanceService(access, dept);
        return result.success ? { success: true, data: result } : { success: false, error: 'Failed to retrieve department budget.' };
      }

      case 'list_available_capdev_projects': {
        const limit = args.limit ? Number(args.limit) : undefined;
        const dept = typeof args.department === 'string' ? args.department : undefined;
        const result = await listAvailableCapdevProjectsService(access, { limit, department: dept });
        return result.success ? { success: true, data: result } : { success: false, error: 'Failed to list CapDev projects.' };
      }

      case 'create_request_draft': {
        const draftInput: RequestDraftInput = {
          aipCode: args.aip_code ? String(args.aip_code).trim() : (args.aipCode ? String(args.aipCode).trim() : undefined),
          setting: args.setting === 'external' ? 'external' : 'internal',
          requestedBudget: args.requested_budget !== undefined ? String(args.requested_budget) : (args.requestedBudget !== undefined ? String(args.requestedBudget) : undefined),
          description: args.description ? String(args.description) : undefined,
          dynamicFields: (args.dynamic_fields || args.dynamicFields || {}) as Record<string, unknown>,
          attachments: (args.attachments as StatusAttachment[]) || [],
          sourceFile: (args.source_file || args.sourceFile) as StatusAttachment | undefined,
        };
        const result = await createRequestDraftService(access, draftInput);
        return { success: true, data: result.draft };
      }

      case 'upload_request_attachment': {
        const files = (args.files as StatusAttachment[]) || [];
        if (files.length === 0) {
          return { success: false, error: 'No files provided.' };
        }
        return { success: true, data: { files } };
      }

      case 'submit_request': {
        const submissionInput: RequestSubmissionInput = {
          aipCode: String(args.aip_code || args.aipCode || '').trim(),
          setting: args.setting === 'external' ? 'external' : 'internal',
          requestedBudget: String(args.requested_budget ?? args.requestedBudget ?? '0'),
          description: args.description ? String(args.description) : '',
          dynamicFields: (args.dynamic_fields || args.dynamicFields || {}) as Record<string, unknown>,
          attachments: (args.attachments as StatusAttachment[]) || [],
          sourceFile: (args.source_file || args.sourceFile) as StatusAttachment | undefined,
          userConfirmed: Boolean(args.user_confirmed ?? args.userConfirmed),
        };
        const result = await submitRequestService(access, submissionInput);
        return result.success ? { success: true, data: result } : { success: false, error: result.error };
      }

      default:
        return { success: false, error: `Unknown MCP tool: “${toolName}”.` };
    }
  } catch (error) {
    console.error(`MCP tool execution failed (${toolName}):`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Internal MCP tool execution error.' };
  }
}
