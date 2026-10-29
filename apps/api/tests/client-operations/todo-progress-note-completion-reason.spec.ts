/**
 * Client Operations ToDo — optional progress note (שלב טיפול) + optional completion reason (סיבת סגירה),
 * migration 189, plus the verified command-path optimizations.
 *
 * Runs the real service against an in-memory Supabase fake (no network; migration NOT executed).
 * Covers: migration safety (static), validation, named commands, full-aggregate truth flow, audit, atomic
 * completion + reason, reopen clearing the reason, authorization / ownership / client-ACL regression
 * (a canonical ToDo whose client left the ACL must not be mutable by direct id), and query-count budgets.
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

// ── in-memory Supabase fake (records writes per table + every table read) ───────────────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;
let writes: Array<{ table: string; kind: 'insert' | 'update'; row: Row }> = [];
let calls: string[] = [];

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
      return { data: matched.map((r) => ({ ...r })), error: null };
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

function seed(): void {
  for (const k of Object.keys(tables)) delete tables[k];
  idSeq = 0;
  writes = [];
  calls = [];
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
    // Legacy rows predate migration 189: progress_note / completion_reason are absent (NULL).
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
    todo('t-owner-old', OWNER, C1, {
      completed_at: '2026-01-02T00:00:00.000Z',
      completed_by_user_id: OWNER,
    }), // legacy archived row: no reason column at all
  ];
}

const ctxFor = (userId: string, roleCode: string, permissions = ['client_operations.view', 'client_operations.edit']) => ({
  user: { id: userId, authUserId: `auth-${userId}`, email: '', fullName: null, status: 'active', uiLanguage: null },
  organizationId: ORG,
  membership: { organizationId: ORG, userId, roleId: `role-${roleCode}`, roleCode, permissions },
});
const ownerCtx = () => ctxFor(OWNER, 'owner');
const staffACtx = () => ctxFor(STAFF_A, 'staff');
const staffBCtx = () => ctxFor(STAFF_B, 'staff');

const svc = await import('../../src/domains/client-operations/client-operations-todo.service.js');
const pure = await import('../../src/domains/client-operations/client-operations-todo.pure.js');
const { supabaseAdmin } = await import('../../src/db/client.js');
const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
(supabaseAdmin as unknown as { from: (t: string) => FakeQuery }).from = (t: string) => {
  calls.push(t);
  return new FakeQuery(t);
};
test.after(() => {
  (supabaseAdmin as unknown as { from: unknown }).from = realFrom;
});

type Agg = { tasks: Array<Record<string, any>>; workspace: Record<string, any>; [k: string]: any };
const todoRow = (id: string): Row => tables.client_operations_todos.find((r) => r.id === id)!;
const cmd = (ctx: ReturnType<typeof ownerCtx>, body: Record<string, unknown>) =>
  svc.executeClientOperationsTodoCommand(ctx, body as never) as Promise<Agg>;
const codeOf = (e: unknown) => (e as { code?: string }).code;
const auditOf = (action: string): Row[] => (tables.audit_log ?? []).filter((r) => r.action === action);
const todoWrites = () => writes.filter((w) => w.table === 'client_operations_todos');
const card = (agg: Agg, id: string) => agg.tasks.find((t) => t.id === id)!;
const OFFICE = { workspace_scope: 'office' };
const MY = { workspace_scope: 'my' };

// ── migration 189 (static) ───────────────────────────────────────────────────────────────────────────

test('M1 migration 189: additive, two nullable columns, bounded checks, reason only while completed', () => {
  const sql = repo('supabase/migrations/189_client_operations_todo_progress_note_completion_reason.sql');
  assert.match(sql, /add column if not exists progress_note text null/i);
  assert.match(sql, /add column if not exists completion_reason text null/i);
  assert.match(sql, /char_length\(progress_note\) <= 300/);
  assert.match(sql, /char_length\(completion_reason\) <= 300/);
  assert.match(sql, /length\(btrim\(progress_note\)\) > 0/);
  assert.match(sql, /completion_reason is null or completed_at is not null/i);
  // No backfill / data rewrite / destructive change; only the ToDo table is touched; FK + RLS untouched.
  assert.doesNotMatch(sql, /\b(update|delete|insert)\b\s+(into\s+)?public\./i);
  assert.doesNotMatch(sql, /drop (table|column)/i);
  assert.doesNotMatch(sql, /create table|create policy|alter column|enable row level/i);
  assert.deepEqual([...new Set([...sql.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1]))], ['client_operations_todos']);
  // Fixed value set / workflow columns are not introduced.
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /create type|enum|progress_status/i);
});

test('M2 migration numbering: 189 is the next free number after 188 and unique', () => {
  const names = readdirSync(join(root, 'supabase/migrations')).filter((n) => n.startsWith('189_'));
  assert.deepEqual(names, ['189_client_operations_todo_progress_note_completion_reason.sql']);
});

// ── pure validation ──────────────────────────────────────────────────────────────────────────────────

test('P1 normalization: blank → null, trimmed, one line, bounded, text only', () => {
  assert.equal(pure.normalizeTodoProgressNote(undefined), null);
  assert.equal(pure.normalizeTodoProgressNote(null), null);
  assert.equal(pure.normalizeTodoProgressNote('   '), null);
  assert.equal(pure.normalizeTodoProgressNote('  ממתין לחתימה  '), 'ממתין לחתימה');
  assert.equal(pure.normalizeTodoProgressNote('בבדיקה\n\nשלב 2\t'), 'בבדיקה שלב 2');
  assert.equal(pure.normalizeTodoProgressNote('x'.repeat(300)), 'x'.repeat(300));
  assert.throws(() => pure.normalizeTodoProgressNote('x'.repeat(301)), /TODO_PROGRESS_NOTE_TOO_LONG/);
  assert.throws(() => pure.normalizeTodoProgressNote({ a: 1 }), /TODO_PROGRESS_NOTE_INVALID/);
  assert.equal(pure.normalizeTodoCompletionReason(''), null);
  assert.equal(pure.normalizeTodoCompletionReason(' בוטל '), 'בוטל');
  assert.throws(() => pure.normalizeTodoCompletionReason('x'.repeat(301)), /TODO_COMPLETION_REASON_TOO_LONG/);
  assert.throws(() => pure.normalizeTodoCompletionReason(42), /TODO_COMPLETION_REASON_INVALID/);
});

// ── A. progress note (שלב טיפול) ─────────────────────────────────────────────────────────────────────

test('A1 create with an optional note; board card carries it; backend limits are in the aggregate', async () => {
  seed();
  const board = await cmd(ownerCtx(), {
    command: 'create_client_operations_todo',
    client_id: C1,
    task_text: 'with note',
    progress_note: '  ממתין לתשובת הלקוח ',
    ...OFFICE,
  });
  const row = tables.client_operations_todos.find((r) => r.task_text === 'with note')!;
  assert.equal(row.progress_note, 'ממתין לתשובת הלקוח');
  assert.equal(card(board, String(row.id)).progress_note, 'ממתין לתשובת הלקוח');
  assert.deepEqual(board.field_limits, { progress_note_max_length: 300, completion_reason_max_length: 300 });
  // Without a note the field is simply null.
  const board2 = await cmd(ownerCtx(), { command: 'create_client_operations_todo', client_id: C1, task_text: 'plain', ...OFFICE });
  const plain = tables.client_operations_todos.find((r) => r.task_text === 'plain')!;
  assert.equal(plain.progress_note, null);
  assert.equal(card(board2, String(plain.id)).progress_note, null);
  // Too long note: rejected before anything is written.
  const before = tables.client_operations_todos.length;
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'create_client_operations_todo', client_id: C1, task_text: 'x2', progress_note: 'n'.repeat(301), ...OFFICE }),
    (e) => codeOf(e) === 'TODO_PROGRESS_NOTE_TOO_LONG',
  );
  assert.equal(tables.client_operations_todos.length, before);
});

test('A2 named progress-note command: edit, change, clear — full refreshed aggregate + audit; nothing else changes', async () => {
  seed();
  const snapshot = { ...todoRow('t-owner-1') };
  const set = await cmd(ownerCtx(), {
    command: 'update_client_operations_todo_progress_note',
    todo_id: 't-owner-1',
    progress_note: 'בבדיקה',
    ...OFFICE,
  });
  // Full aggregate truth: same workspace contract + the refreshed card.
  assert.equal(set.workspace.scope_kind, 'OFFICE');
  assert.equal(card(set, 't-owner-1').progress_note, 'בבדיקה');
  assert.ok(Array.isArray(set.pagination ? [1] : null) && set.summary.active_total >= 1);
  assert.ok(card(set, 't-owner-1').allowed_actions.includes('update_client_operations_todo_progress_note'));
  // Completion state, priority, text, ownership are untouched by the note.
  const row = todoRow('t-owner-1');
  assert.equal(row.completed_at, null);
  assert.equal(row.priority, snapshot.priority);
  assert.equal(row.task_text, snapshot.task_text);
  assert.equal(row.assigned_to_user_id, snapshot.assigned_to_user_id);

  await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: 'ממתין לחתימה', ...OFFICE });
  assert.equal(todoRow('t-owner-1').progress_note, 'ממתין לחתימה');
  const cleared = await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: '   ', ...OFFICE });
  assert.equal(todoRow('t-owner-1').progress_note, null);
  assert.equal(card(cleared, 't-owner-1').progress_note, null);

  // Audit: one event per real change, before/after recorded, module-scoped.
  const audits = auditOf('client_operations.todo.progress_note.updated');
  assert.equal(audits.length, 3);
  assert.deepEqual((audits[0].payload_json as Row).before, { progress_note: null });
  assert.deepEqual((audits[0].payload_json as Row).after, { progress_note: 'בבדיקה' });
  assert.deepEqual((audits[2].payload_json as Row).after, { progress_note: null });
  assert.equal(audits[0].organization_id, ORG);
  assert.equal(audits[0].entity_id, 't-owner-1');
});

test('A3 unchanged note = no write and no audit, still the full aggregate (idempotent autosave)', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: 'בבדיקה', ...OFFICE });
  writes = [];
  tables.audit_log = [];
  const again = await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: ' בבדיקה ', ...OFFICE });
  assert.equal(todoWrites().length, 0);
  assert.equal(tables.audit_log.length, 0);
  assert.equal(card(again, 't-owner-1').progress_note, 'בבדיקה');
});

test('A4 note is not a status: no enum/transition, rejected on completed ToDos, validated, other commands ignore it', async () => {
  seed();
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-old', progress_note: 'x', ...OFFICE }),
    (e) => codeOf(e) === 'TODO_ALREADY_COMPLETED',
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: 'n'.repeat(301), ...OFFICE }),
    (e) => codeOf(e) === 'TODO_PROGRESS_NOTE_TOO_LONG',
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: { x: 1 }, ...OFFICE }),
    (e) => codeOf(e) === 'TODO_PROGRESS_NOTE_INVALID',
  );
  // The generic update command does not take the note (one action = one named command).
  await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: 't-owner-1', task_text: 'renamed', progress_note: 'sneaky', ...OFFICE });
  assert.equal(todoRow('t-owner-1').progress_note ?? null, null);
  assert.equal(todoRow('t-owner-1').task_text, 'renamed');
  // Any text is accepted (no fixed value set) and never changes completion/priority.
  await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: 'כל טקסט חופשי', ...OFFICE });
  assert.equal(todoRow('t-owner-1').completed_at, null);
  assert.equal(todoRow('t-owner-1').priority, 2);
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.doesNotMatch(src, /progress_status|PROGRESS_STATUSES|workflow_transition/i);
});

test('A5 authorization: other employee, view-only, wrong workspace and out-of-ACL canonical ToDo are all rejected', async () => {
  seed();
  const note = (ctx: ReturnType<typeof ownerCtx>, id: string, ws: Record<string, unknown>) =>
    cmd(ctx, { command: 'update_client_operations_todo_progress_note', todo_id: id, progress_note: 'x', ...ws });
  // Employee B cannot touch employee A's ToDo by direct id.
  await assert.rejects(() => note(staffBCtx(), 't-a-1', MY));
  // View-only member cannot write.
  await assert.rejects(
    () => note(ctxFor(STAFF_A, 'staff', ['client_operations.view']), 't-a-1', MY),
    (e) => codeOf(e) === 'CLIENT_OPERATIONS_EDIT_FORBIDDEN',
  );
  // Owner in the OFFICE workspace does not own employee A's private board.
  await assert.rejects(() => note(ownerCtx(), 't-a-1', OFFICE));
  // Owner in STAFF(A) scope may (existing cc15179e ownership model).
  await note(ownerCtx(), 't-a-1', { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  assert.equal(todoRow('t-a-1').progress_note, 'x');
  // Regression: A's canonical ToDo on a client outside A's ACL (C4) must not be mutable by direct id.
  await assert.rejects(() => note(staffACtx(), 't-a-other', MY));
  assert.equal(todoRow('t-a-other').progress_note ?? null, null);
  // Unknown id / cross-tenant style id.
  await assert.rejects(() => note(ownerCtx(), 'does-not-exist', OFFICE));
});

// ── B. completion reason (סיבת סגירה) ────────────────────────────────────────────────────────────────

test('B1 completion without a reason is valid (reason stays null)', async () => {
  seed();
  const board = await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', ...OFFICE });
  assert.ok(!board.tasks.some((t) => t.id === 't-owner-1'));
  const row = todoRow('t-owner-1');
  assert.ok(row.completed_at);
  assert.equal(row.completion_reason, null);
  const archive = await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE);
  assert.equal(card(archive as Agg, 't-owner-1').completion_reason, null);
});

test('B2 reason is persisted ATOMICALLY with completion (single UPDATE), audited, and shown in the archive only', async () => {
  seed();
  writes = [];
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: '  לא נדרש יותר ', ...OFFICE });
  const ups = todoWrites().filter((w) => w.kind === 'update');
  assert.equal(ups.length, 1, 'exactly one write');
  assert.equal(ups[0].row.completion_reason, 'לא נדרש יותר');
  assert.ok(ups[0].row.completed_at && ups[0].row.completed_by_user_id);
  const audits = auditOf('client_operations.todo.completed');
  assert.equal(audits.length, 1);
  assert.equal((audits[0].payload_json as Row).completion_reason, 'לא נדרש יותר');
  const archive = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.equal(card(archive, 't-owner-1').completion_reason, 'לא נדרש יותר');
});

test('B3 invalid reason is rejected and the ToDo is NOT completed', async () => {
  seed();
  writes = [];
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'r'.repeat(301), ...OFFICE }),
    (e) => codeOf(e) === 'TODO_COMPLETION_REASON_TOO_LONG',
  );
  await assert.rejects(
    () => cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: ['a'], ...OFFICE }),
    (e) => codeOf(e) === 'TODO_COMPLETION_REASON_INVALID',
  );
  assert.equal(todoWrites().length, 0);
  assert.equal(todoRow('t-owner-1').completed_at, null);
  assert.equal(auditOf('client_operations.todo.completed').length, 0);
});

test('B4 no duplicate completion: a repeated/racing completion never overwrites the reason nor re-audits', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'הועבר לעובד אחר', ...OFFICE });
  const first = { ...todoRow('t-owner-1') };
  writes = [];
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'בוטל', ...OFFICE });
  assert.equal(todoWrites().length, 0);
  assert.equal(todoRow('t-owner-1').completion_reason, 'הועבר לעובד אחר');
  assert.equal(todoRow('t-owner-1').completed_at, first.completed_at);
  assert.equal(auditOf('client_operations.todo.completed').length, 1);
  // The UPDATE itself is guarded so a lost race cannot complete twice.
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.match(src, /\.is\('completed_at', null\)\s*\.select\('id'\)/);
});

test('B5 reopen clears the reason; a later completion never inherits it; audit keeps the previous reason', async () => {
  seed();
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'בוטל', ...OFFICE });
  const res = (await cmd(ownerCtx(), {
    command: 'reopen_client_operations_todo',
    todo_id: 't-owner-1',
    return_archive: true,
    ...OFFICE,
  })) as unknown as { board: Agg; archive: Agg };
  assert.equal(todoRow('t-owner-1').completion_reason, null);
  assert.equal(todoRow('t-owner-1').completed_at, null);
  assert.equal(card(res.board, 't-owner-1').completion_reason, null);
  assert.ok(!res.archive.tasks.some((t) => t.id === 't-owner-1'));
  const reopened = auditOf('client_operations.todo.reopened');
  assert.equal(reopened.length, 1);
  assert.equal((reopened[0].payload_json as Row).previous_completion_reason, 'בוטל');
  // Complete again WITHOUT a reason → the archive shows no reason (not the old one).
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', ...OFFICE });
  assert.equal(todoRow('t-owner-1').completion_reason, null);
  const archive = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.equal(card(archive, 't-owner-1').completion_reason, null);
  // And with a new reason → the new one.
  await cmd(ownerCtx(), { command: 'reopen_client_operations_todo', todo_id: 't-owner-1', ...OFFICE });
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'הועבר לעובד אחר', ...OFFICE });
  const archive2 = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.equal(card(archive2, 't-owner-1').completion_reason, 'הועבר לעובד אחר');
});

test('B6 legacy archived rows stay valid (null reason); an active row never exposes a reason; note survives the cycle', async () => {
  seed();
  const archive = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.equal(card(archive, 't-owner-old').completion_reason, null);
  assert.equal(card(archive, 't-owner-old').progress_note, null);
  // Even a corrupted active row holding a reason is rendered without it.
  todoRow('t-owner-1').completion_reason = 'stale';
  const board = await svc.getClientOperationsTodoBoard(ownerCtx(), OFFICE);
  assert.equal((board.tasks.find((t) => t.id === 't-owner-1') as Record<string, unknown>).completion_reason, null);
  delete todoRow('t-owner-1').completion_reason;
  // Progress note is kept through complete → archive → reopen.
  await cmd(ownerCtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-owner-1', progress_note: 'ממתין לחתימה', ...OFFICE });
  await cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'בוטל', ...OFFICE });
  const arch2 = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.equal(card(arch2, 't-owner-1').progress_note, 'ממתין לחתימה');
  await cmd(ownerCtx(), { command: 'reopen_client_operations_todo', todo_id: 't-owner-1', ...OFFICE });
  assert.equal(todoRow('t-owner-1').progress_note, 'ממתין לחתימה');
});

test('B7 authorization: reason is never written for an unauthorized completer; out-of-ACL canonical ToDo cannot be completed/reopened/edited', async () => {
  seed();
  writes = [];
  await assert.rejects(() => cmd(staffBCtx(), { command: 'complete_client_operations_todo', todo_id: 't-a-1', completion_reason: 'x', ...MY }));
  await assert.rejects(
    () => cmd(ctxFor(STAFF_A, 'staff', ['client_operations.view']), { command: 'complete_client_operations_todo', todo_id: 't-a-1', completion_reason: 'x', ...MY }),
    (e) => codeOf(e) === 'CLIENT_OPERATIONS_EDIT_FORBIDDEN',
  );
  // Regression for the canonical client-ACL check in the mutation guard.
  await assert.rejects(() => cmd(staffACtx(), { command: 'complete_client_operations_todo', todo_id: 't-a-other', completion_reason: 'x', ...MY }));
  await assert.rejects(() => cmd(staffACtx(), { command: 'update_client_operations_todo', todo_id: 't-a-other', task_text: 'hijack', ...MY }));
  await assert.rejects(() => cmd(staffACtx(), { command: 'reopen_client_operations_todo', todo_id: 't-a-other', ...MY }));
  assert.equal(todoWrites().length, 0);
  assert.equal(todoRow('t-a-other').completed_at, null);
});

test('B8 archive aggregate for an employee shows only their own closed ToDos with their reasons; Owner/MY/STAFF unchanged', async () => {
  seed();
  await cmd(staffACtx(), { command: 'complete_client_operations_todo', todo_id: 't-a-1', completion_reason: 'בוטל', ...MY });
  const mine = (await svc.getClientOperationsTodoArchive(staffACtx(), MY)) as Agg;
  assert.deepEqual(mine.tasks.map((t) => [t.id, t.completion_reason]), [['t-a-1', 'בוטל']]);
  const viaOwner = (await svc.getClientOperationsTodoArchive(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A })) as Agg;
  assert.deepEqual(viaOwner.tasks.map((t) => t.id), ['t-a-1']);
  const ownerOffice = (await svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE)) as Agg;
  assert.deepEqual(ownerOffice.tasks.map((t) => t.id), ['t-owner-old']);
});

test('B9 restricted employee cannot read or touch out-of-ACL ToDos (board, archive, note, complete, reopen) even by direct id', async () => {
  seed();
  // An already-closed ToDo on a client outside A's ACL, carrying a note and a reason (must stay invisible and immutable).
  tables.client_operations_todos.push({
    ...tables.client_operations_todos.find((r) => r.id === 't-a-other')!,
    id: 't-a-other-closed',
    progress_note: 'secret note',
    completion_reason: 'secret reason',
    completed_at: '2026-01-03T00:00:00.000Z',
    completed_by_user_id: STAFF_A,
  });
  const leaks = (agg: Agg) => JSON.stringify(agg).includes('secret') || agg.tasks.some((t) => String(t.id).startsWith('t-a-other'));
  // READ: employee's own workspace and the owner viewing that employee both apply the client ACL.
  assert.equal(leaks((await svc.getClientOperationsTodoBoard(staffACtx(), MY)) as Agg), false, 'board/my');
  assert.equal(leaks((await svc.getClientOperationsTodoArchive(staffACtx(), MY)) as Agg), false, 'archive/my');
  const staffScope = { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A };
  assert.equal(leaks((await svc.getClientOperationsTodoBoard(ownerCtx(), staffScope)) as Agg), false, 'board/owner->A');
  assert.equal(leaks((await svc.getClientOperationsTodoArchive(ownerCtx(), staffScope)) as Agg), false, 'archive/owner->A');
  // WRITE by direct id: every command is rejected and nothing is persisted.
  writes = [];
  const before = JSON.stringify(tables.client_operations_todos);
  for (const todo_id of ['t-a-other', 't-a-other-closed']) {
    for (const body of [
      { command: 'update_client_operations_todo_progress_note', progress_note: 'x' },
      { command: 'update_client_operations_todo', task_text: 'hijack' },
      { command: 'complete_client_operations_todo', completion_reason: 'x' },
      { command: 'reopen_client_operations_todo' },
    ]) {
      await assert.rejects(() => cmd(staffACtx(), { ...body, todo_id, ...MY }), undefined, `${body.command} ${todo_id}`);
      await assert.rejects(() => cmd(ownerCtx(), { ...body, todo_id, ...staffScope }), undefined, `owner->A ${body.command} ${todo_id}`);
    }
  }
  assert.equal(todoWrites().length, 0, 'no ToDo write attempted');
  assert.equal(JSON.stringify(tables.client_operations_todos), before, 'rows unchanged');
  assert.equal((tables.audit_log ?? []).length, 0, 'no audit entries for rejected commands');
});

// ── C. performance guards (verified optimizations; contract unchanged) ───────────────────────────────

async function countQueries(fn: () => Promise<unknown>): Promise<{ total: number; by: Record<string, number> }> {
  calls = [];
  await fn();
  const by: Record<string, number> = {};
  for (const c of calls) by[c] = (by[c] ?? 0) + 1;
  return { total: calls.length, by };
}

test('C1 a command resolves the workspace ONCE and rebuilds the aggregate from it (query budget)', async () => {
  seed();
  const owner = await countQueries(() => cmd(ownerCtx(), { command: 'complete_client_operations_todo', todo_id: 't-owner-1', ...OFFICE }));
  // before: 8 queries (membership/ACL resolved twice); after: 7.
  assert.ok(owner.total <= 7, `owner complete used ${owner.total} queries: ${JSON.stringify(owner.by)}`);
  const staff = await countQueries(() => cmd(staffACtx(), { command: 'update_client_operations_todo_progress_note', todo_id: 't-a-1', progress_note: 'x', ...MY }));
  // before (update, limited ACL): 13; after: 10.
  assert.ok(staff.total <= 10, `staff note used ${staff.total} queries: ${JSON.stringify(staff.by)}`);
  assert.equal(staff.by.organization_member_client_access, 1, 'client ACL resolved once per command');
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.doesNotMatch(src, /return getClientOperationsTodoBoard\(/);
  assert.doesNotMatch(src, /getClientOperationsTodoArchive\(ctx/);
});

test('C2 client identities are read once per aggregate; the archive does not hydrate the whole archive for one page', async () => {
  seed();
  for (let i = 0; i < 30; i++) {
    tables.client_operations_todos.push({
      id: `t-done-${i}`,
      organization_id: ORG,
      client_id: C1,
      assigned_to_user_id: OWNER,
      task_text: `done ${i}`,
      priority: 3,
      created_at: '2026-01-01T00:00:00.000Z',
      created_by_user_id: OWNER,
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by_user_id: OWNER,
      completed_at: `2026-02-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
      completed_by_user_id: OWNER,
    });
  }
  const noQ = await countQueries(() => svc.getClientOperationsTodoArchive(ownerCtx(), OFFICE));
  assert.equal(noQ.by.clients, 1);
  const withQ = await countQueries(() => svc.getClientOperationsTodoArchive(ownerCtx(), { ...OFFICE, q: 'done' }));
  assert.equal(withQ.by.clients, 1, 'search loads identities once and reuses them for the page');
  const boardQ = await countQueries(() => svc.getClientOperationsTodoBoard(ownerCtx(), { ...OFFICE, q: 'task' }));
  assert.equal(boardQ.by.clients, 1);
  // Large identity sets are read in bounded chunks (the ids travel in the request URL).
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.match(src, /CLIENT_IDENTITY_CHUNK_SIZE/);
});

test('C3 audit write and aggregate rebuild run together, and every command still returns the full aggregate', async () => {
  seed();
  const agg = await cmd(ownerCtx(), { command: 'update_client_operations_todo', todo_id: 't-owner-1', task_text: 'changed', ...OFFICE });
  assert.equal(card(agg, 't-owner-1').task_text, 'changed');
  assert.equal(auditOf('client_operations.todo.updated').length, 1);
  assert.ok(agg.summary && agg.pagination && agg.allowed_actions && agg.query);
  const src = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.match(src, /Promise\.all\(\[\s*audit \? writeAudit\(audit\) : Promise\.resolve\(\),/);
});
