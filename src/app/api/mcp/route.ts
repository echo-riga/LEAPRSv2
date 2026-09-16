import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server';
import { db } from '@/db';
import { users, systemSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { LEAPRS_MCP_TOOLS, executeMcpTool } from '@/lib/mcp/server';
import type { AppRole, UserAccess } from '@/lib/services/leaprs-service';

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'];
const MAINTENANCE_MODE_KEY = 'maintenance_mode';

async function getRequestAccess(): Promise<UserAccess | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;

  const [storedUser] = await db
    .select({ role: users.role, department: users.department })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!storedUser) return null;
  const role = VALID_ROLES.includes(storedUser.role as AppRole) ? (storedUser.role as AppRole) : 'employee';

  if (role !== 'admin') {
    const [maintenance] = await db
      .select({ enabled: systemSettings.enabled })
      .from(systemSettings)
      .where(eq(systemSettings.key, MAINTENANCE_MODE_KEY))
      .limit(1);
    if (maintenance?.enabled) return null;
  }

  return {
    userId: session.user.id,
    role,
    department: storedUser.department,
    name: session.user.name || session.user.email || 'LEAPRS User',
    email: session.user.email || undefined,
  };
}

export async function GET() {
  const access = await getRequestAccess();
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    name: 'LEAPRS MCP Server',
    version: '1.0.0',
    tools: LEAPRS_MCP_TOOLS,
  });
}

export async function POST(req: NextRequest) {
  const access = await getRequestAccess();
  if (!access) {
    return NextResponse.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' } }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Check for JSON-RPC 2.0 format
    if (body.jsonrpc === '2.0') {
      const { id, method, params } = body;

      if (method === 'tools/list') {
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: { tools: LEAPRS_MCP_TOOLS },
        });
      }

      if (method === 'tools/call') {
        const { name, arguments: toolArgs } = params || {};
        if (!name) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name in params' },
          });
        }

        const result = await executeMcpTool(access, name, toolArgs || {});
        if (!result.success) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: result.error || 'Tool execution failed' },
          });
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result.data) }] },
        });
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }

    // Direct REST tool invocation fallback: { tool: 'find_capdev_by_aip_code', args: { ... } }
    if (body.tool) {
      const result = await executeMcpTool(access, body.tool, body.args || {});
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid MCP payload' }, { status: 400 });
  } catch (error) {
    console.error('MCP route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
