import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';

process.loadEnvFile('.env.local');
const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getManageUserOptions');
const code = ts.transpileModule(action.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-0000-0000-00000000000${index + 1}`);

test('user management joins UUID authentication IDs to text application IDs and preserves eligibility filters', { timeout: 25000 }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, max: 1 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE manage_auth_fixture (id uuid PRIMARY KEY, name text, email text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE manage_user_fixture (id text PRIMARY KEY, role text, department text, archived_at timestamp) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE manage_approval_fixture (user_id text, status text) ON COMMIT DROP');
    for (let index = 0; index < ids.length; index++) {
      await client.query('INSERT INTO manage_user_fixture VALUES ($1, $2, $3, $4)', [ids[index], 'employee', 'Test', index === 2 ? new Date() : null]);
      if (index < 4) await client.query('INSERT INTO manage_auth_fixture VALUES ($1, $2, $3)', [ids[index], `Person ${index}`, `fixture${index}@example.test`]);
    }
    await client.query("INSERT INTO manage_user_fixture VALUES ('legacy-non-uuid', 'employee', 'Test', NULL)");
    await client.query("INSERT INTO manage_approval_fixture VALUES ($1, 'pending')", [ids[3]]);
    const dialect = new PgDialect();
    const dependencies = {
      getCurrentAccess: async () => ({ role: 'admin', userId: ids[0] }),
      unauthorized: { success: false, error: 'Forbidden' }, sql,
      users: pgTable('manage_user_fixture', { id: text('id') }),
      roleApprovalRequests: pgTable('manage_approval_fixture', { userId: text('user_id') }),
      db: { execute: async query => {
        const compiled = dialect.sqlToQuery(query);
        return client.query(compiled.sql.replaceAll('neon_auth.user', 'pg_temp.manage_auth_fixture'), compiled.params);
      } },
      console: { error() {} },
    };
    const getOptions = new Function(...Object.keys(dependencies), code + '; return getManageUserOptions;')(...Object.values(dependencies));
    const active = await getOptions(false);
    assert.equal(active.success, true, active.error);
    assert.deepEqual(active.records.map(user => user.id), [ids[1]]);
    const archived = await getOptions(true);
    assert.equal(archived.success, true, archived.error);
    assert.deepEqual(archived.records.map(user => user.id), [ids[2]]);
  } finally {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  }
});
