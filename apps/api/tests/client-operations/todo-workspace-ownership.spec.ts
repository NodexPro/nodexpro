/**
 * ToDo workspace ownership regression (follow-up to Stage 5A/5B — not a new stage).
 *
 * A ToDo board is private to the selected workspace subject:
 *   OFFICE (Owner/Admin own workspace) → the viewer; MY → the viewer; STAFF → the selected employee.
 * The owner column is `client_operations_todos.assigned_to_user_id` (migration 182), derived on the backend
 * from the authorized workspace — never client-supplied, never a UI field.
 *
 * Runs the real service against an in-memory Supabase fake (no network, no migration).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const repo = (rel: string): string => readFileSync(join(root, rel), 'utf8');

// ── in-memory Supabase fake ──────────────────────────────────────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;

class FakeQuery implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private embedUsers = false;
  private max: number | null = null;
  private inserted: Row | null = null;
  constructor(private readonly table: string) {}

  select(cols?: string) {
    if (cols && cols.includes('users!')) this.embedUsers = true;
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
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  private run(): Row[] {
    const rows = (tables[this.table] ??= []);
    if (this.mode === 'insert') {
      const row: Row = { id: `gen-${++idSeq}`, ...this.payload };
      rows.push(row);
      this.inserted = row;
      return [row];
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      return matched;
    }
    let out = matched.map((r) => ({ ...r }));
    if (this.embedUsers) {
      out = out.map((r) => ({
        ...r,
        users: (tables.users ?? []).find((u) => u.id === r.user_id) ?? null,
      }));
    }
    return this.max == null ? out : out.slice(0, this.max);
  }
  maybeSingle() {
    return Promise.resolve({ data: this.run()[0] ?? null, error: null });
  }
  single() {
    const row = this.run()[0] ?? null;
    return Promise.resolve({ data: row, error: row ? null : { message: 'no rows' } });
  }
  then<T1, T2>(
    ok?: ((v: { data: unknown; error: null | { message: string } }) => T1 | PromiseLike<T1>) | null,
    bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return Promise.resolve({ data: this.run(), error: null }).then(ok, bad);
  }
}

// ── seed ─────────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const OWNER = 'u-owner';
const STAFF_A = 'u-staff-a';
const STAFF_B = 'u-staff-b';
const [C1, C2, C3, C4] = ['c-1', 'c-2', 'c-3', 'c-4'];

function seed(): void {
  for (const k of Object.keys(tables)) delete tables[k];
  idSeq = 0;
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
    todo('t-owner-2', OWNER, C4),
    todo('t-a-1', STAFF_A, C1),
    todo('t-a-2', STAFF_A, C2),
    todo('t-b-1', STAFF_B, C3),
    todo('t-a-done', STAFF_A, C1, {
      completed_at: '2026-02-01T00:00:00.000Z',
      completed_by_user_id: STAFF_A,
    }),
    todo('t-owner-done', OWNER, C1, {
      completed_at: '2026-02-02T00:00:00.000Z',
      completed_by_user_id: OWNER,
    }),
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

const svc = await import('../../src/domains/client-operations/client-operations-todo.service.js');
const { supabaseAdmin } = await import('../../src/db/client.js');
const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
(supabaseAdmin as unknown as { from: (t: string) => FakeQuery }).from = (t: string) => new FakeQuery(t);
test.after(() => {
  (supabaseAdmin as unknown as { from: unknown }).from = realFrom;
});

const ids = (agg: { tasks: Array<{ id: string }> }): string[] => agg.tasks.map((t) => t.id).sort();
const todoRow = (id: string): Row => tables.client_operations_todos.find((r) => r.id === id)!;

// ── tests ────────────────────────────────────────────────────────────────────

test('0. board subject: OFFICE/MY → viewer, STAFF → selected employee (pure)', () => {
  const base = { viewer_user_id: OWNER };
  assert.equal(svc.todoBoardSubjectUserId({ ...base, scope_kind: 'OFFICE', workspace_subject_user_id: null }), OWNER);
  assert.equal(svc.todoBoardSubjectUserId({ ...base, scope_kind: 'MY', workspace_subject_user_id: OWNER }), OWNER);
  assert.equal(svc.todoBoardSubjectUserId({ ...base, scope_kind: 'STAFF', workspace_subject_user_id: STAFF_A }), STAFF_A);
});

test('1. Owner own workspace returns Owner ToDos only (never employees)', async () => {
  seed();
  const board = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(ids(board), ['t-owner-1', 't-owner-2']);
  assert.equal(board.workspace.scope_kind, 'OFFICE');
  const archive = await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(ids(archive), ['t-owner-done']);
  // Default (no workspace requested) is the Owner's own office workspace too.
  assert.deepEqual(ids(await svc.getClientOperationsTodoBoard(ownerCtx(), {})), ['t-owner-1', 't-owner-2']);
});

test('2. Employee MY workspace returns that employee ToDos only', async () => {
  seed();
  const board = await svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(ids(board), ['t-a-1', 't-a-2']);
  const archive = await svc.getClientOperationsTodoArchive(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(ids(archive), ['t-a-done']);
  // Employee asking for "my" with someone else's subject still gets only their own board.
  const spoof = await svc.getClientOperationsTodoBoard(staffACtx(), {
    workspace_scope: 'my',
    workspace_subject_user_id: STAFF_B,
  });
  assert.deepEqual(ids(spoof), ['t-a-1', 't-a-2']);
});

test('3. Owner STAFF(employee A) returns employee A ToDos only', async () => {
  seed();
  const board = await svc.getClientOperationsTodoBoard(ownerCtx(), {
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_A,
  });
  assert.deepEqual(ids(board), ['t-a-1', 't-a-2']);
  assert.equal(board.query.workspace_subject_user_id, STAFF_A);
  assert.equal(board.workspace.viewer_user_id, OWNER); // actor stays the authenticated viewer
});

test('4. Owner STAFF(employee B) does not receive employee A ToDos; switching back shows Owner only', async () => {
  seed();
  const b = await svc.getClientOperationsTodoBoard(ownerCtx(), {
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_B,
  });
  assert.deepEqual(ids(b), ['t-b-1']);
  const back = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' });
  assert.deepEqual(ids(back), ['t-owner-1', 't-owner-2']);
});

test('5. Staff cannot request another employee workspace or the office board', async () => {
  seed();
  await assert.rejects(
    () => svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
    (e: { code?: string }) => e.code === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
  await assert.rejects(
    () => svc.getClientOperationsTodoArchive(staffACtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
    (e: { code?: string }) => e.code === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
  await assert.rejects(
    () => svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'office' }),
    (e: { code?: string }) => e.code === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
});

test('6. Create in Owner workspace creates an Owner-owned ToDo (client-supplied assignee ignored)', async () => {
  seed();
  const board = await svc.createClientOperationsTodo(ownerCtx(), {
    client_id: C1,
    task_text: 'owner private task',
    priority: 1,
    workspace_scope: 'office',
    // A forged assignee must never be read.
    assigned_to_user_id: STAFF_A,
  } as never);
  const created = tables.client_operations_todos.find((r) => r.task_text === 'owner private task')!;
  assert.equal(created.assigned_to_user_id, OWNER);
  assert.equal(created.created_by_user_id, OWNER);
  assert.ok(ids(board).includes(String(created.id)));
  assert.deepEqual(
    board.tasks.filter((t) => t.id === created.id).map((t) => t.allowed_actions.includes('complete_client_operations_todo')),
    [true],
  );
  // Employee A's board is untouched.
  const a = await svc.getClientOperationsTodoBoard(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(ids(a), ['t-a-1', 't-a-2']);
});

test('7. Create while Owner views employee A creates an employee-A ToDo (actor = Owner)', async () => {
  seed();
  const board = await svc.createClientOperationsTodo(ownerCtx(), {
    client_id: C2,
    task_text: 'for anna',
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_A,
  });
  const created = tables.client_operations_todos.find((r) => r.task_text === 'for anna')!;
  assert.equal(created.assigned_to_user_id, STAFF_A);
  assert.equal(created.created_by_user_id, OWNER);
  assert.ok(ids(board).includes(String(created.id)));
  assert.ok(!ids(board).some((id) => id.startsWith('t-owner') || id === 't-b-1'));
  // Owner's own board did not get it.
  const own = await svc.getClientOperationsTodoBoard(ownerCtx(), { workspace_scope: 'office' });
  assert.ok(!ids(own).includes(String(created.id)));
  // Audit keeps actor + subject.
  const audit = tables.audit_log.find((r) => (r.payload_json as Row)?.todo_id === created.id)!;
  assert.equal(audit.actor_user_id, OWNER);
  assert.equal((audit.payload_json as Row).assigned_to_user_id, STAFF_A);
  // Client ACL of the selected employee applies: C4 is office-only, not employee A's client.
  await assert.rejects(() =>
    svc.createClientOperationsTodo(ownerCtx(), {
      client_id: C4,
      task_text: 'not anna client',
      workspace_scope: 'staff',
      workspace_subject_user_id: STAFF_A,
    }),
  );
});

test('8. Create/edit UI has no מטפל (assignee) selector and sends no assignee', () => {
  const modal = repo('apps/web/src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  assert.doesNotMatch(modal, /<span>מטפל<\/span>|<th>מטפל<\/th>|נא לבחור מטפל/);
  assert.doesNotMatch(modal, /assigned_to_user_id|assigneeId|setAssignee|AssigneeOptions|filter_assignee|showAssignee/);
  const url = repo('apps/web/src/lib/client-operations-todo-url.pure.ts');
  assert.doesNotMatch(url, /assignee/i);
  const routes = repo('apps/api/src/domains/client-operations/client-operations.routes.ts');
  assert.doesNotMatch(routes, /todo\/assignee-options/);
  const service = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.doesNotMatch(service, /body\.assigned_to_user_id|filter_assignee|listClientOperationsTodoAssigneeOptions/);
});

test('9. Direct-ID mutations cannot touch a ToDo outside the authorized subject workspace', async () => {
  seed();
  const before = JSON.stringify(tables.client_operations_todos);
  const denied = (e: unknown) => (e as { status?: number; statusCode?: number }).status === 403 || (e as { statusCode?: number }).statusCode === 403;
  // Owner in own workspace → employee A ToDo
  await assert.rejects(() => svc.completeClientOperationsTodo(ownerCtx(), { todo_id: 't-a-1', workspace_scope: 'office' }), denied);
  await assert.rejects(() => svc.updateClientOperationsTodo(ownerCtx(), { todo_id: 't-a-1', task_text: 'x', workspace_scope: 'office' }), denied);
  // Owner viewing B → A's ToDo
  await assert.rejects(
    () => svc.updateClientOperationsTodo(ownerCtx(), { todo_id: 't-a-1', task_text: 'x', workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
    denied,
  );
  // Employee A → B's / Owner's ToDo (MY, and forged STAFF)
  await assert.rejects(() => svc.completeClientOperationsTodo(staffACtx(), { todo_id: 't-b-1', workspace_scope: 'my' }), denied);
  await assert.rejects(() => svc.completeClientOperationsTodo(staffACtx(), { todo_id: 't-owner-1', workspace_scope: 'my' }), denied);
  await assert.rejects(
    () => svc.reopenClientOperationsTodo(staffACtx(), { todo_id: 't-owner-done', workspace_scope: 'staff', workspace_subject_user_id: OWNER }),
  );
  // Owner viewing A → Owner's own ToDo
  await assert.rejects(
    () => svc.completeClientOperationsTodo(ownerCtx(), { todo_id: 't-owner-1', workspace_scope: 'staff', workspace_subject_user_id: STAFF_A }),
    denied,
  );
  assert.equal(JSON.stringify(tables.client_operations_todos), before, 'nothing mutated');
  // Allowed paths still work: own ToDo, and owner → employee through STAFF.
  await svc.completeClientOperationsTodo(staffACtx(), { todo_id: 't-a-1', workspace_scope: 'my' });
  assert.ok(todoRow('t-a-1').completed_at);
  await svc.updateClientOperationsTodo(ownerCtx(), {
    todo_id: 't-b-1',
    task_text: 'edited by owner for B',
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_B,
  });
  assert.equal(todoRow('t-b-1').task_text, 'edited by owner for B');
  assert.equal(todoRow('t-b-1').assigned_to_user_id, STAFF_B, 'edit never reassigns ownership');
});

test('10. Commands return the refreshed aggregate of the SAME workspace', async () => {
  seed();
  const ws = { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A };
  const created = (await svc.executeClientOperationsTodoCommand(ownerCtx(), {
    command: 'create_client_operations_todo',
    client_id: C1,
    task_text: 'cmd created',
    ...ws,
  })) as Awaited<ReturnType<typeof svc.getClientOperationsTodoBoard>>;
  assert.equal(created.query.workspace_scope, 'staff');
  assert.equal(created.query.workspace_subject_user_id, STAFF_A);
  assert.ok(created.tasks.some((t) => t.task_text === 'cmd created'));
  assert.ok(!ids(created).some((id) => id.startsWith('t-owner') || id === 't-b-1'));

  const completed = (await svc.executeClientOperationsTodoCommand(ownerCtx(), {
    command: 'complete_client_operations_todo',
    todo_id: 't-a-2',
    ...ws,
  })) as Awaited<ReturnType<typeof svc.getClientOperationsTodoBoard>>;
  assert.ok(!ids(completed).includes('t-a-2'));
  assert.equal(completed.query.workspace_subject_user_id, STAFF_A);

  const reopened = (await svc.executeClientOperationsTodoCommand(ownerCtx(), {
    command: 'reopen_client_operations_todo',
    todo_id: 't-a-done',
    return_archive: true,
    ...ws,
  })) as { board: { tasks: Array<{ id: string }> }; archive: { tasks: Array<{ id: string }> } };
  assert.ok(reopened.board.tasks.some((t) => t.id === 't-a-done'));
  assert.ok(reopened.archive.tasks.every((t) => ['t-a-2'].includes(t.id)));
  assert.ok(!reopened.board.tasks.some((t) => t.id.startsWith('t-owner') || t.id === 't-b-1'));

  // Employee's own command refreshes the employee's own board.
  const own = (await svc.executeClientOperationsTodoCommand(staffACtx(), {
    command: 'complete_client_operations_todo',
    todo_id: 't-a-done',
    workspace_scope: 'my',
  })) as Awaited<ReturnType<typeof svc.getClientOperationsTodoBoard>>;
  assert.equal(own.query.workspace_scope, 'my');
  assert.ok(own.tasks.every((t) => t.id.startsWith('t-a') || t.task_text === 'cmd created'));
});

test('11. Existing historical ToDos remain intact (owner column kept, nothing deleted/reassigned)', async () => {
  seed();
  const snapshot = tables.client_operations_todos.map((r) => ({ id: r.id, owner: r.assigned_to_user_id }));
  await svc.getClientOperationsTodoBoard(ownerCtx(), {});
  await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  await svc.createClientOperationsTodo(ownerCtx(), { client_id: C1, task_text: 'new', workspace_scope: 'office' });
  await svc.updateClientOperationsTodo(staffACtx(), { todo_id: 't-a-1', task_text: 'edit', workspace_scope: 'my' });
  for (const s of snapshot) {
    const row = todoRow(String(s.id));
    assert.ok(row, `${s.id} still exists`);
    assert.equal(row.assigned_to_user_id, s.owner, `${s.id} ownership unchanged`);
  }
  assert.equal(tables.client_operations_todos.length, snapshot.length + 1);
  // Employee-owned history is still reachable — through the employee workspace.
  const archive = await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  assert.deepEqual(ids(archive), ['t-a-done']);
});

test('12. Client options stay ACL-scoped to the selected workspace', async () => {
  seed();
  const clientIds = (r: { options: Array<{ client_id: string }> }) => r.options.map((o) => o.client_id).sort();
  assert.deepEqual(clientIds(await svc.searchClientOperationsTodoClientOptions(staffACtx(), { workspace_scope: 'my' })), [C1, C2]);
  assert.deepEqual(
    clientIds(await svc.searchClientOperationsTodoClientOptions(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_B })),
    [C3],
  );
  assert.deepEqual(
    clientIds(await svc.searchClientOperationsTodoClientOptions(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A })),
    [C1, C2],
  );
  assert.deepEqual(
    clientIds(await svc.searchClientOperationsTodoClientOptions(ownerCtx(), { workspace_scope: 'office' })),
    [C1, C2, C3, C4],
  );
  // Employee cannot create a ToDo on a client outside their ACL.
  await assert.rejects(() => svc.createClientOperationsTodo(staffACtx(), { client_id: C3, task_text: 'nope', workspace_scope: 'my' }));
});

test('13. ToDo surface is Arial, sans-serif (title, board, archive, modals, inputs, placeholders, selects, buttons)', () => {
  const css = repo('apps/web/src/styles/nx-client-operations-todo.css');
  assert.match(css, /\.nx-co-todo-overlay \*,[\s\S]*?\.nx-co-todo-form-overlay \*,[\s\S]*?::placeholder[\s\S]*?\{\s*font-family: Arial, sans-serif !important;/);
  assert.doesNotMatch(css, /font-family:(?![^;]*Arial)/);
});
