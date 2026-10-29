/**
 * Client Operations ToDo — one-time / external client (migration 188).
 *
 * A ToDo references EITHER a canonical Core client (`client_id`) OR a one-time client that lives on the
 * ToDo itself (`external_client_name` + optional `external_client_tax_id`, `client_id = null`).
 * A one-time client is never a Core client: no clients row, no client_operational_profile, no ACL grant,
 * no fake id. Workspace ownership (cc15179e) is the authorization boundary for one-time ToDos.
 *
 * Runs the real service against an in-memory Supabase fake (no network, migration NOT executed).
 * The SQL constraints themselves are covered by static checks here; the migration was additionally
 * verified once on a throw-away in-memory Postgres (constraints, FK, cascade, idempotence).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowMatchesPostgrestOr } from './fake-postgrest-or.pure.js';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const repo = (rel: string): string => readFileSync(join(root, rel), 'utf8');

// ── in-memory Supabase fake (records every write per table) ─────────────────────────────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;
let writes: Array<{ table: string; kind: 'insert' | 'update'; row: Row }> = [];

class FakeQuery implements PromiseLike<{ data: unknown; error: null | { message: string }; count?: number }> {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private embedUsers = false;
  private wantCount = false;
  private max: number | null = null;
  private single_ = false;
  constructor(private readonly table: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (cols && cols.includes('users!')) this.embedUsers = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(row: Row) {
    this.mode = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.mode = 'update';
    this.payload = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  not(col: string, op: string, val: unknown) {
    assert.equal(op, 'is');
    this.filters.push((r) => (val === null ? r[col] != null : r[col] !== val));
    return this;
  }
  or(expr: string) {
    this.filters.push((r) => rowMatchesPostgrestOr(r, expr));
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.max = to - from + 1;
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single_ = true;
    return this;
  }
  single() {
    this.single_ = true;
    return this;
  }
  private run(): { data: unknown; error: null | { message: string }; count?: number } {
    const rows = (tables[this.table] ??= []);
    if (this.mode === 'insert') {
      const row: Row = { id: `gen-${++idSeq}`, ...this.payload };
      rows.push(row);
      writes.push({ table: this.table, kind: 'insert', row });
      return { data: this.single_ ? row : [row], error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of matched) {
        Object.assign(r, this.payload);
        writes.push({ table: this.table, kind: 'update', row: { ...this.payload } });
      }
      return { data: matched, error: null };
    }
    let out = matched.map((r) => ({ ...r }));
    if (this.embedUsers) {
      out = out.map((r) => ({ ...r, users: (tables.users ?? []).find((u) => u.id === r.user_id) ?? null }));
    }
    if (this.max != null) out = out.slice(0, this.max);
    const count = this.wantCount ? matched.length : undefined;
    if (this.single_) return { data: out[0] ?? null, error: null, count };
    return { data: out, error: null, count };
  }
  then<T1, T2>(
    ok?: ((v: { data: unknown; error: null | { message: string }; count?: number }) => T1 | PromiseLike<T1>) | null,
    bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

// ── seed ─────────────────────────────────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const OWNER = 'u-owner';
const STAFF_A = 'u-staff-a';
const STAFF_B = 'u-staff-b';
const [C1, C2, C3, C4] = ['c-1', 'c-2', 'c-3', 'c-4'];
const ONE_TIME_NAME = 'יוסי כהן - חד פעמי';

function seed(): void {
  for (const k of Object.keys(tables)) delete tables[k];
  idSeq = 0;
  writes = [];
  tables.users = [
    { id: OWNER, email: 'owner@x.io', full_name: 'Olga Owner' },
    { id: STAFF_A, email: 'a@x.io', full_name: 'Anna A' },
    { id: STAFF_B, email: 'b@x.io', full_name: 'Boris B' },
  ];
  tables.organization_memberships = [
    { organization_id: ORG, user_id: OWNER, role_code: 'owner', status: 'active' },
    { organization_id: ORG, user_id: STAFF_A, role_code: 'staff', status: 'active' },
    { organization_id: ORG, user_id: STAFF_B, role_code: 'staff', status: 'active' },
  ];
  tables.rbac_role_permissions = [];
  tables.organization_member_client_access = [
    { organization_id: ORG, user_id: STAFF_A, access_mode: 'selected' },
    { organization_id: ORG, user_id: STAFF_B, access_mode: 'selected' },
  ];
  tables.organization_member_client_grants = [
    { organization_id: ORG, user_id: STAFF_A, client_id: C1 },
    { organization_id: ORG, user_id: STAFF_A, client_id: C2 },
    { organization_id: ORG, user_id: STAFF_B, client_id: C3 },
  ];
  tables.clients = [C1, C2, C3, C4].map((id) => ({
    id,
    organization_id: ORG,
    display_name: `Client ${id}`,
    tax_id: `tax-${id}`,
    is_archived: false,
  }));
  tables.client_operational_profiles = [];
  tables.audit_log = [];
  const todo = (id: string, owner: string, client: string, extra: Row = {}): Row => ({
    id,
    organization_id: ORG,
    client_id: client,
    // Legacy rows predate migration 188: the external columns are simply absent / null.
    assigned_to_user_id: owner,
    task_text: `task ${id}`,
    priority: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: owner,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by_user_id: owner,
    completed_at: null,
    completed_by_user_id: null,
    ...extra,
  });
  tables.client_operations_todos = [
    todo('t-owner-1', OWNER, C1),
    todo('t-a-1', STAFF_A, C1),
    todo('t-a-other', STAFF_A, C4), // canonical client outside A's ACL (e.g. grant removed later)
    todo('t-b-1', STAFF_B, C3),
  ];
}

const ctxFor = (userId: string, roleCode: string) => ({
  user: { id: userId, authUserId: `auth-${userId}`, email: '', fullName: null, status: 'active', uiLanguage: null },
  organizationId: ORG,
  membership: {
    organizationId: ORG,
    userId,
    roleId: `role-${roleCode}`,
    roleCode,
    permissions: ['client_operations.view', 'client_operations.edit'],
  },
});
const ownerCtx = () => ctxFor(OWNER, 'owner');
const staffACtx = () => ctxFor(STAFF_A, 'staff');
const staffBCtx = () => ctxFor(STAFF_B, 'staff');

const svc = await import('../../src/domains/client-operations/client-operations-todo.service.js');
const pure = await import('../../src/domains/client-operations/client-operations-todo.pure.js');
const { loadCloseAccessBlockers } = await import('../../src/domains/memberships/member-close-access-blockers.service.js');
const { supabaseAdmin } = await import('../../src/db/client.js');
const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
(supabaseAdmin as unknown as { from: (t: string) => FakeQuery }).from = (t: string) => new FakeQuery(t);
test.after(() => {
  (supabaseAdmin as unknown as { from: unknown }).from = realFrom;
});

const ids = (agg: { tasks: Array<{ id: string }> }): string[] => agg.tasks.map((t) => t.id).sort();
const todoRow = (id: string): Row => tables.client_operations_todos.find((r) => r.id === id)!;
const createdByText = (text: string): Row => tables.client_operations_todos.find((r) => r.task_text === text)!;
const cmd = (ctx: ReturnType<typeof ownerCtx>, body: Record<string, unknown>) =>
  svc.executeClientOperationsTodoCommand(ctx, body as never) as Promise<{ tasks: Array<Record<string, any>>; workspace: Record<string, any> }>;
const codeOf = (e: unknown) => (e as { code?: string }).code;

// ── migration (static) ───────────────────────────────────────────────────────────────────────────────

test('M1 migration 188: additive, nullable client_id, two nullable columns, exactly-one-mode check, FK kept', () => {
  const sql = repo('supabase/migrations/188_client_operations_todo_one_time_client.sql');
  assert.match(sql, /alter column client_id drop not null/i);
  assert.match(sql, /add column if not exists external_client_name text null/i);
  assert.match(sql, /add column if not exists external_client_tax_id text null/i);
  assert.match(sql, /char_length\(external_client_name\) <= 200/);
  assert.match(sql, /char_length\(external_client_tax_id\) <= 50/);
  assert.match(sql, /length\(btrim\(external_client_name\)\) > 0/);
  // Exactly one identity mode.
  assert.match(sql, /client_id is not null\s+and external_client_name is null\s+and external_client_tax_id is null/i);
  assert.match(sql, /client_id is null\s+and external_client_name is not null/i);
  // Existing composite FK untouched; no backfill / data rewrite / drops of tables or columns.
  assert.doesNotMatch(sql, /drop constraint[^;]*client_operations_todos_client_org_fk/i);
  assert.doesNotMatch(sql, /\b(update|delete|insert)\b\s+(into\s+)?public\./i);
  assert.doesNotMatch(sql, /drop (table|column)/i);
  assert.doesNotMatch(sql, /create table/i);
  // Only the ToDo table is altered (no clients / profiles / ACL tables).
  assert.deepEqual([...new Set([...sql.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1]))], ['client_operations_todos']);
});

test('M2 migration numbering: 188 is the next free number and unique', () => {
  const dir = join(root, 'supabase/migrations');
  const names = readdirSync(dir).filter((n) => n.startsWith('188_'));
  assert.deepEqual(names, ['188_client_operations_todo_one_time_client.sql']);
});

// ── pure identity rules ──────────────────────────────────────────────────────────────────────────────

test('I1 identity input: exactly one mode; tax id optional; no free text can reach client_id', () => {
  assert.deepEqual(pure.resolveTodoClientIdentityInput({ client_id: ` ${C1} ` }), { mode: 'canonical', client_id: C1 });
  assert.deepEqual(pure.resolveTodoClientIdentityInput({ external_client_name: `  ${ONE_TIME_NAME}  ` }), {
    mode: 'one_time',
    external_client_name: ONE_TIME_NAME,
    external_client_tax_id: null,
  });
  assert.deepEqual(
    pure.resolveTodoClientIdentityInput({ client_id: '', external_client_name: 'X', external_client_tax_id: ' 123 ' }),
    { mode: 'one_time', external_client_name: 'X', external_client_tax_id: '123' },
  );
  assert.throws(() => pure.resolveTodoClientIdentityInput({}), /TODO_CLIENT_REQUIRED/);
  assert.throws(() => pure.resolveTodoClientIdentityInput({ external_client_tax_id: '123' }), /TODO_CLIENT_REQUIRED/);
  assert.throws(() => pure.resolveTodoClientIdentityInput({ client_id: C1, external_client_name: 'X' }), /IDENTITY_CONFLICT/);
  assert.throws(() => pure.resolveTodoClientIdentityInput({ client_id: C1, external_client_tax_id: '1' }), /IDENTITY_CONFLICT/);
  assert.throws(() => pure.resolveTodoClientIdentityInput({ external_client_name: 'x'.repeat(201) }), /NAME_TOO_LONG/);
  assert.throws(() => pure.resolveTodoClientIdentityInput({ external_client_name: 'X', external_client_tax_id: '9'.repeat(51) }), /TAX_ID_TOO_LONG/);
});

test('I2 client presentation is backend-built for both kinds (and legacy rows)', () => {
  assert.deepEqual(
    pure.buildTodoClientPresentation({ client_id: C1 }, { display_name: 'Acme', tax_id: '5' }),
    { id: C1, display_name: 'Acme', tax_id: '5', is_one_time: false },
  );
  assert.deepEqual(
    pure.buildTodoClientPresentation({ client_id: null, external_client_name: 'Yossi', external_client_tax_id: null }, undefined),
    { id: null, display_name: 'Yossi', tax_id: null, is_one_time: true },
  );
});

// ── commands + read model ────────────────────────────────────────────────────────────────────────────

test('C1 canonical create still stores the canonical client_id (external fields null)', async () => {
  seed();
  const board = await cmd(ownerCtx(), {
    command: 'create_client_operations_todo',
    client_id: C1,
    task_text: 'canonical',
    workspace_scope: 'office',
  });
  const row = createdByText('canonical');
  assert.equal(row.client_id, C1);
  assert.equal(row.external_client_name, null);
  assert.equal(row.external_client_tax_id, null);
  const card = board.tasks.find((t) => t.id === row.id)!;
  assert.deepEqual(card.client, { id: C1, display_name: `Client ${C1}`, tax_id: `tax-${C1}`, is_one_time: false });
});

test('C2 unauthorized canonical client cannot be selected; identity modes cannot be mixed', async () => {
  seed();
  await assert.rejects(
    () => cmd(staffACtx(), { command: 'create_client_operations_todo', client_id: C3, task_text: 'x', workspace_scope: 'my' }),
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'create_client_operations_todo', client_id: C4, task_text: 'x', workspace_scope: 'staff', workspace_subject_user_id: STAFF_A }),
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'create_client_operations_todo', client_id: C1, external_client_name: 'Mixed', task_text: 'x' }),
    (e) => codeOf(e) === 'TODO_CLIENT_IDENTITY_CONFLICT',
  );
  assert.equal(tables.client_operations_todos.filter((r) => String(r.task_text) === 'x').length, 0);
});

test('C3 one-time create WITHOUT tax id: no client_id, no fake id, nothing created in Core', async () => {
  seed();
  const clientsBefore = JSON.stringify(tables.clients);
  const board = await cmd(ownerCtx(), {
    command: 'create_client_operations_todo',
    external_client_name: `  ${ONE_TIME_NAME}  `,
    task_text: 'one time task',
    workspace_scope: 'office',
  });
  const row = createdByText('one time task');
  assert.equal(row.client_id, null, 'client_id stays NULL — never text, never a generated id');
  assert.equal(row.external_client_name, ONE_TIME_NAME);
  assert.equal(row.external_client_tax_id, null);
  assert.equal(row.assigned_to_user_id, OWNER);
  // Nothing was written anywhere except the ToDo (+ audit).
  assert.deepEqual([...new Set(writes.map((w) => w.table))].sort(), ['audit_log', 'client_operations_todos']);
  assert.equal(JSON.stringify(tables.clients), clientsBefore, 'no Core client created');
  assert.equal(tables.client_operational_profiles.length, 0, 'no client_operational_profile created');
  assert.equal(tables.organization_member_client_grants.length, 3, 'no ACL grant created');
  // Full refreshed board of the SAME workspace with the backend-built one-time presentation.
  assert.equal(board.workspace.scope_kind, 'OFFICE');
  const card = board.tasks.find((t) => t.id === row.id)!;
  assert.deepEqual(card.client, { id: null, display_name: ONE_TIME_NAME, tax_id: null, is_one_time: true });
  assert.ok(card.allowed_actions.includes('complete_client_operations_todo'));
  assert.deepEqual(ids(board), ['t-owner-1', String(row.id)].sort());
});

test('C4 one-time create WITH tax id (optional, manual, never written to Core)', async () => {
  seed();
  const board = await cmd(ownerCtx(), {
    command: 'create_client_operations_todo',
    external_client_name: ONE_TIME_NAME,
    external_client_tax_id: ' 039-12345 ',
    task_text: 'with tax',
  });
  const row = createdByText('with tax');
  assert.equal(row.external_client_tax_id, '039-12345');
  assert.equal(row.client_id, null);
  assert.deepEqual(board.tasks.find((t) => t.id === row.id)!.client, {
    id: null,
    display_name: ONE_TIME_NAME,
    tax_id: '039-12345',
    is_one_time: true,
  });
  assert.equal(tables.clients.length, 4);
  // Audit keeps actor, subject and the kind of client; the tax id VALUE is not copied into the audit log.
  const audit = tables.audit_log.find((r) => (r.payload_json as Row)?.todo_id === row.id)!;
  const payload = audit.payload_json as Row;
  assert.equal(payload.is_one_time, true);
  assert.equal(payload.client_id, null);
  assert.equal(payload.external_client_name, ONE_TIME_NAME);
  assert.equal(payload.has_external_client_tax_id, true);
  assert.doesNotMatch(JSON.stringify(audit), /039-12345/);
});

test('C5 backend validates one-time input (frontend is not the source of truth)', async () => {
  seed();
  const base = { command: 'create_client_operations_todo', task_text: 'v' };
  await assert.rejects(() => cmd(ownerCtx(), { ...base }), (e) => codeOf(e) === 'TODO_CLIENT_REQUIRED');
  await assert.rejects(() => cmd(ownerCtx(), { ...base, external_client_name: '   ' }), (e) => codeOf(e) === 'TODO_CLIENT_REQUIRED');
  await assert.rejects(() => cmd(ownerCtx(), { ...base, external_client_tax_id: '123' }), (e) => codeOf(e) === 'TODO_CLIENT_REQUIRED');
  await assert.rejects(() => cmd(ownerCtx(), { ...base, external_client_name: 'x'.repeat(201) }), (e) => codeOf(e) === 'TODO_EXTERNAL_CLIENT_NAME_TOO_LONG');
  await assert.rejects(
    () => cmd(ownerCtx(), { ...base, external_client_name: 'X', external_client_tax_id: '9'.repeat(51) }),
    (e) => codeOf(e) === 'TODO_EXTERNAL_CLIENT_TAX_ID_TOO_LONG',
  );
  await assert.rejects(() => cmd(ownerCtx(), { command: 'create_client_operations_todo', external_client_name: 'X', task_text: '  ' }));
  assert.equal(tables.client_operations_todos.length, 4, 'nothing persisted by rejected commands');
  // View-only members cannot create.
  const viewer = { ...ownerCtx(), membership: { ...ownerCtx().membership, permissions: ['client_operations.view'] } };
  await assert.rejects(() => cmd(viewer, { ...base, external_client_name: 'X' }));
});

test('C6 one-time ToDo belongs to the workspace subject (Owner / MY / STAFF ownership unchanged)', async () => {
  seed();
  // Owner own workspace → Owner; forged assignee never read.
  await cmd(ownerCtx(), { command: 'create_client_operations_todo', external_client_name: 'own', task_text: 'ot-owner', assigned_to_user_id: STAFF_A });
  assert.equal(createdByText('ot-owner').assigned_to_user_id, OWNER);
  // Employee MY → employee.
  await cmd(staffACtx(), { command: 'create_client_operations_todo', external_client_name: 'mine', task_text: 'ot-a', workspace_scope: 'my' });
  assert.equal(createdByText('ot-a').assigned_to_user_id, STAFF_A);
  // Owner viewing employee A → employee A (actor stays the Owner).
  const board = await cmd(ownerCtx(), {
    command: 'create_client_operations_todo',
    external_client_name: 'for anna',
    task_text: 'ot-for-a',
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_A,
  });
  const forA = createdByText('ot-for-a');
  assert.equal(forA.assigned_to_user_id, STAFF_A);
  assert.equal(forA.created_by_user_id, OWNER);
  assert.ok(ids(board).includes(String(forA.id)));
  assert.ok(!ids(board).includes(String(createdByText('ot-owner').id)), 'Owner own one-time ToDo is not on the employee board');
  // Employee cannot create in another workspace.
  await assert.rejects(
    () => cmd(staffACtx(), { command: 'create_client_operations_todo', external_client_name: 'x', task_text: 'x', workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
    (e) => codeOf(e) === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
});

test('E1 one-time name and tax id are editable through the named edit command (never Core)', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'create_client_operations_todo', external_client_name: 'Old Name', task_text: 'edit me' });
  const id = String(createdByText('edit me').id);
  const clientsBefore = JSON.stringify(tables.clients);

  let board = await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_name: '  New Name ' });
  assert.equal(todoRow(id).external_client_name, 'New Name');
  assert.equal(todoRow(id).client_id, null);
  assert.deepEqual(board.tasks.find((t) => t.id === id)!.client, { id: null, display_name: 'New Name', tax_id: null, is_one_time: true });

  board = await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_tax_id: '555' });
  assert.equal(todoRow(id).external_client_tax_id, '555');
  assert.equal(todoRow(id).external_client_name, 'New Name');
  assert.equal(board.tasks.find((t) => t.id === id)!.client.tax_id, '555');

  // Both together + text/priority in ONE command; clearing the tax id (optional) works.
  board = await cmd(ownerCtx(), {
    command: 'update_client_operations_todo',
    todo_id: id,
    external_client_name: 'Third',
    external_client_tax_id: '',
    task_text: 'edited text',
    priority: 1,
  });
  assert.equal(todoRow(id).external_client_name, 'Third');
  assert.equal(todoRow(id).external_client_tax_id, null);
  assert.equal(todoRow(id).task_text, 'edited text');
  assert.equal(board.workspace.scope_kind, 'OFFICE');

  // Backend validation: the name can never be blanked; too long rejected; nothing changes.
  await assert.rejects(() => cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_name: '  ' }), (e) => codeOf(e) === 'TODO_EXTERNAL_CLIENT_NAME_REQUIRED');
  await assert.rejects(() => cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_name: 'x'.repeat(201) }), (e) => codeOf(e) === 'TODO_EXTERNAL_CLIENT_NAME_TOO_LONG');
  await assert.rejects(() => cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_tax_id: '9'.repeat(51) }), (e) => codeOf(e) === 'TODO_EXTERNAL_CLIENT_TAX_ID_TOO_LONG');
  assert.equal(todoRow(id).external_client_name, 'Third');

  // client_id supplied on edit is ignored: a one-time ToDo can never be turned into a canonical one here.
  await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, client_id: C1, task_text: 'still one-time' });
  assert.equal(todoRow(id).client_id, null);

  assert.equal(JSON.stringify(tables.clients), clientsBefore, 'editing never touches Core clients');
  assert.equal(tables.client_operational_profiles.length, 0);
  // Audit: name before/after recorded, tax id value never copied.
  const updates = tables.audit_log.filter((r) => (r.payload_json as Row)?.todo_id === id && (r.payload_json as Row).before);
  assert.ok(updates.length >= 3);
  assert.doesNotMatch(JSON.stringify(updates), /"555"/);
});

test('E2 canonical-client ToDos are never reassigned or given external fields', async () => {
  seed();
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: 't-owner-1', external_client_name: 'Hijack' }),
    (e) => codeOf(e) === 'TODO_CLIENT_NOT_ONE_TIME',
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: 't-owner-1', external_client_tax_id: '1' }),
    (e) => codeOf(e) === 'TODO_CLIENT_NOT_ONE_TIME',
  );
  await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: 't-owner-1', client_id: C2, task_text: 'renamed' });
  assert.equal(todoRow('t-owner-1').client_id, C1, 'no client reassignment');
  assert.equal(todoRow('t-owner-1').external_client_name ?? null, null);
});

test('R1 board shows one-time ToDos and searches them by external name and tax id', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'create_client_operations_todo', external_client_name: ONE_TIME_NAME, external_client_tax_id: '777-1', task_text: 'collect docs' });
  const idOneTime = String(createdByText('collect docs').id);
  const all = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(ids(all), ['t-owner-1', idOneTime].sort());
  assert.deepEqual(ids(await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office', q: 'כהן' })), [idOneTime]);
  assert.deepEqual(ids(await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office', q: '777-1' })), [idOneTime]);
  assert.deepEqual(ids(await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office', q: 'client c-1' })), ['t-owner-1']);
  assert.equal(all.summary.active_total, 2, 'counters include one-time ToDos');
  assert.equal(all.available_clients_hint.one_time_client.allowed, true);
  assert.equal(all.available_clients_hint.one_time_client.name_max_length, 200);
});

test('R2 complete → archive display → reopen for a one-time ToDo', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'create_client_operations_todo', external_client_name: ONE_TIME_NAME, external_client_tax_id: '1', task_text: 'finish me' });
  const id = String(createdByText('finish me').id);

  const afterComplete = await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: id });
  assert.ok(!ids(afterComplete as never).includes(id));
  const archive = await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(ids(archive), [id]);
  assert.deepEqual(archive.tasks[0].client, { id: null, display_name: ONE_TIME_NAME, tax_id: '1', is_one_time: true });
  assert.ok(archive.tasks[0].allowed_actions.includes('reopen_client_operations_todo'));
  assert.deepEqual(ids(await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'office', q: 'כהן' })), [id]);

  const reopened = (await cmd(ownerCtx(), { command: 'reopen_client_operations_todo', todo_id: id, return_archive: true })) as unknown as {
    board: { tasks: Array<{ id: string; client: Record<string, unknown> }> };
    archive: { tasks: unknown[] };
  };
  assert.ok(reopened.board.tasks.some((t) => t.id === id && t.client.is_one_time === true));
  assert.equal(reopened.archive.tasks.length, 0);
  assert.equal(todoRow(id).client_id, null);
  assert.equal(todoRow(id).external_client_name, ONE_TIME_NAME);
});

test('A1 one-time ToDos survive client-ACL filtering; canonical ACL is unchanged', async () => {
  seed();
  await cmd(staffACtx(), { command: 'create_client_operations_todo', external_client_name: 'Walk-in', task_text: 'ot-a', workspace_scope: 'my' });
  const idOt = String(createdByText('ot-a').id);

  // Employee A: ACL = {C1, C2}. Canonical t-a-1 (C1) visible; t-a-other (C4) hidden; one-time visible.
  const mine = await svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(ids(mine), ['t-a-1', idOt].sort());
  // Owner viewing employee A: same projection.
  const viaOwner = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  assert.deepEqual(ids(viaOwner), ['t-a-1', idOt].sort());
  // Employee with ZERO grants still sees their own one-time ToDos, and no canonical ones.
  tables.organization_member_client_grants = tables.organization_member_client_grants.filter((g) => g.user_id !== STAFF_A);
  const noGrants = await svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(ids(noGrants), [idOt]);
  // Owner own workspace never shows A's one-time ToDo; employee B never does either.
  assert.ok(!ids(await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' })).includes(idOt));
  assert.deepEqual(ids(await svc.getClientOperationsTodoBoard(staffBCtx(), { workspace_scope: 'my' })), ['t-b-1']);
});

test('A2 direct-ID commands on a one-time ToDo are bound to the workspace subject', async () => {
  seed();
  await cmd(staffACtx(), { command: 'create_client_operations_todo', external_client_name: 'Walk-in', task_text: 'ot-a', workspace_scope: 'my' });
  const id = String(createdByText('ot-a').id);
  const before = JSON.stringify(tables.client_operations_todos);
  const denied = (e: unknown) => (e as { statusCode?: number; status?: number }).statusCode === 403 || (e as { status?: number }).status === 403;
  for (const command of ['complete_client_operations_todo', 'update_client_operations_todo', 'reopen_client_operations_todo']) {
    // Owner in the office workspace
    await assert.rejects(() => cmd(ownerCtx(), { command, todo_id: id, task_text: 'x', workspace_scope: 'office' }), denied, `owner/office ${command}`);
    // Owner viewing employee B
    await assert.rejects(
      () => cmd(ownerCtx(), { command, todo_id: id, task_text: 'x', workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
      denied,
      `owner/B ${command}`,
    );
    // Employee B in their own workspace
    await assert.rejects(() => cmd(staffBCtx(), { command, todo_id: id, task_text: 'x', workspace_scope: 'my' }), denied, `B ${command}`);
  }
  assert.equal(JSON.stringify(tables.client_operations_todos), before, 'nothing changed');
  // The rightful workspaces can: A themselves, and the Owner viewing A.
  await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: id, external_client_name: 'Renamed by owner', workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  assert.equal(todoRow(id).external_client_name, 'Renamed by owner');
  await cmd(staffACtx(), { command: 'complete_client_operations_todo', todo_id: id, workspace_scope: 'my' });
  assert.ok(todoRow(id).completed_at);
});

test('L1 legacy ToDos (created before migration 188) stay compatible', async () => {
  seed();
  const board = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(board.tasks[0].client, { id: C1, display_name: `Client ${C1}`, tax_id: `tax-${C1}`, is_one_time: false });
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1' });
  await cmd(ownerCtx(), { command: 'reopen_client_operations_todo', todo_id: 't-owner-1' });
  assert.equal(todoRow('t-owner-1').client_id, C1);
});

test('L2 member Close Access blockers still count one-time ToDos; handler-change check ignores them', async () => {
  seed();
  await cmd(staffACtx(), { command: 'create_client_operations_todo', external_client_name: 'Walk-in', task_text: 'ot-a', workspace_scope: 'my' });
  const blockers = await loadCloseAccessBlockers(ORG, STAFF_A);
  // t-a-1, t-a-other (canonical, open) + the one-time ToDo: all are open ToDos of the member.
  assert.equal(blockers.open_todo_count, 3);
  // Handler reassignment compares canonical clients only (`client_id = X`); one-time ToDos never match.
  await svc.assertNoIncompatibleActiveTodosForHandlerChange({ organizationId: ORG, clientId: C2, afterHandlerUserId: null });
});

test('N1 null client_id audit: every ToDo path tolerates one-time rows (source guard)', () => {
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  // Reads: owner-scoped; one-time rows stay via `OR client_id IS NULL` (never dropped by canonical ACL).
  assert.match(src, /client_id\.is\.null,client_id\.in\./);
  assert.match(src, /\.eq\('assigned_to_user_id', params\.ownerUserId\)/);
  // Authorization: ACL applies to canonical clients only; archived-client filter keeps one-time rows.
  // (anchored at line start: a statement that is accidentally swallowed by a comment must NOT satisfy this guard)
  assert.match(src, /^\s*if \(task\.client_id != null && !clientIdIsAuthorized\(materializationAccess, task\.client_id\)\) return false;/m);
  assert.match(src, /^\s*if \(r\.client_id == null\) return true;/m);
  // Writes: client_id is never a string for a one-time row, never generated.
  assert.match(src, /const clientId = identity\.mode === 'canonical' \? identity\.client_id : null;/);
  assert.doesNotMatch(src, /randomUUID|uuid\(\)|crypto\./);
  // One-time create never touches Core tables.
  assert.doesNotMatch(src, /from\('clients'\)\s*\.(insert|update|upsert)/);
  assert.doesNotMatch(src, /from\('client_operational_profiles'\)/);
  assert.doesNotMatch(src, /from\('organization_member_client_grants'\)/);
  // מטפל / assignee stays removed.
  assert.doesNotMatch(src, /body\.assigned_to_user_id|filter_assignee|listClientOperationsTodoAssigneeOptions/);
});
