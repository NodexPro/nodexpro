/**
 * Client Operations — (1) ToDo client type-to-search and (2) registry client-list load performance.
 *
 * Runs the real services against an in-memory Supabase fake (no network, no migration).
 *
 * (1) The picker candidates come from the existing backend-authorized endpoint
 *     (`GET /m/client-operations/todo/client-options`, declared by the ToDo aggregate as
 *     `available_clients_hint.search_endpoint`). The typed text is matched IN THE DATABASE inside the
 *     workspace-authorized client set.
 * (2) Query-count / concurrency protection for the registry aggregate: no per-column N+1, no
 *     full-history scans that the screen does not consume, independent reads started together. Response
 *     content is unchanged (measured before/after with identical response hashes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowMatchesPostgrestOr } from './fake-postgrest-or.pure.js';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const repo = (rel: string): string => readFileSync(join(root, rel), 'utf8');

// ── in-memory Supabase fake (counts queries, optional latency, tracks concurrency) ───────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;
let latencyMs = 0;
let calls: string[] = [];
let inFlight = 0;
let maxInFlight = 0;

const ilikeToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');

class FakeQuery implements PromiseLike<{ data: unknown; error: null | { message: string }; count?: number }> {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private embedUsers = false;
  private max: number | null = null;
  private fromIdx: number | null = null;
  private toIdx: number | null = null;
  private wantCount = false;
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private single_ = false;
  constructor(private readonly table: string) {}

  select(cols?: string, opts?: { count?: string }) {
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
  /** PostgREST `or=` — ACL (`client_id.is.null,client_id.in.(…)`) or search `ilike`. */
  or(expr: string) {
    if (expr.includes('client_id.is.null') || expr.includes('client_id.in.(')) {
      this.filters.push((r) => rowMatchesPostgrestOr(r, expr));
      return this;
    }
    const clauses = expr.split(',').map((c) => {
      const first = c.indexOf('.');
      const second = c.indexOf('.', first + 1);
      return { col: c.slice(0, first), op: c.slice(first + 1, second), val: c.slice(second + 1) };
    });
    this.filters.push((r) =>
      clauses.some((c) => {
        assert.equal(c.op, 'ilike');
        return ilikeToRegExp(c.val).test(String(r[c.col] ?? ''));
      }),
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.fromIdx = from;
    this.toIdx = to;
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
      return { data: this.single_ ? row : [row], error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: matched, error: null };
    }
    let out = matched.map((r) => ({ ...r }));
    for (const { col, asc } of [...this.orderBy].reverse()) {
      out.sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.embedUsers) {
      out = out.map((r) => ({
        ...r,
        users: (tables.users ?? []).find((u) => u.id === r.user_id) ?? null,
      }));
    }
    const count = this.wantCount ? matched.length : undefined;
    if (this.fromIdx != null && this.toIdx != null) out = out.slice(this.fromIdx, this.toIdx + 1);
    else if (this.max != null) out = out.slice(0, this.max);
    if (this.single_) return { data: out[0] ?? null, error: null, count };
    return { data: out, error: null, count };
  }
  then<T1, T2>(
    ok?: ((v: { data: unknown; error: null | { message: string } }) => T1 | PromiseLike<T1>) | null,
    bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    calls.push(this.table);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const finish = () => {
      inFlight -= 1;
      return this.run();
    };
    const p =
      latencyMs > 0
        ? new Promise<{ data: unknown; error: null | { message: string } }>((resolve) =>
            setTimeout(() => resolve(finish()), latencyMs),
          )
        : Promise.resolve().then(finish);
    return p.then(ok, bad);
  }
}

/** Unknown query-builder methods (range filters, rpc-style helpers…) are no-ops on the fake. */
const fakeFrom = (t: string): FakeQuery =>
  new Proxy(new FakeQuery(t), {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return () => receiver;
    },
  });

function resetCounters(latency = 0): void {
  latencyMs = latency;
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
}
const countOf = (table: string): number => calls.filter((c) => c === table).length;

// ── seed ─────────────────────────────────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const OWNER = 'u-owner';
const STAFF_A = 'u-staff-a';
const STAFF_B = 'u-staff-b';

const ALPHA_ONE = 'c-alpha-1';
const ALPHA_TWO = 'c-alpha-2';
const BETA = 'c-beta';
const ZETA = 'c-zeta'; // alphabetically AFTER 300 other clients (beyond the old 200-row window)
const ARCHIVED = 'c-archived';
const FOREIGN = 'c-foreign';

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
    { organization_id: ORG, user_id: STAFF_A, client_id: ALPHA_ONE },
    { organization_id: ORG, user_id: STAFF_A, client_id: ALPHA_TWO },
    { organization_id: ORG, user_id: STAFF_B, client_id: BETA },
  ];
  const client = (id: string, name: string, tax: string, extra: Row = {}): Row => ({
    id,
    organization_id: ORG,
    display_name: name,
    tax_id: tax,
    created_at: '2026-01-01T00:00:00.000Z',
    is_archived: false,
    ...extra,
  });
  tables.clients = [
    client(ALPHA_ONE, 'Alpha One Ltd', '510000001'),
    client(ALPHA_TWO, 'Alpha Two Ltd', '510000002'),
    client(BETA, 'Beta Studio', '510000003'),
    ...Array.from({ length: 300 }, (_, i) =>
      client(`c-bulk-${i}`, `Bulk Client ${String(i).padStart(3, '0')}`, `52${String(i).padStart(7, '0')}`),
    ),
    client(ZETA, 'Zzz Zeta Holdings', '599999999'),
    client(ARCHIVED, 'Alpha Archived Ltd', '510000009', { is_archived: true }),
    client(FOREIGN, 'Zzz Foreign Corp', '588888888', { organization_id: OTHER_ORG }),
  ];
  tables.client_operational_profiles = [];
  tables.audit_log = [];
  tables.client_operations_todos = [];
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

const todoSvc = await import('../../src/domains/client-operations/client-operations-todo.service.js');
const todoPure = await import('../../src/domains/client-operations/client-operations-todo.pure.js');
const periodsSvc = await import('../../src/domains/client-operations/client-operations-user-columns-periods.service.js');
const registrySvc = await import('../../src/domains/client-operations/client-operations.service.js');
const { supabaseAdmin } = await import('../../src/db/client.js');
const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
(supabaseAdmin as unknown as { from: (t: string) => FakeQuery }).from = fakeFrom;
test.after(() => {
  (supabaseAdmin as unknown as { from: unknown }).from = realFrom;
});

const search = (ctx: ReturnType<typeof ownerCtx>, q: Record<string, unknown>) =>
  todoSvc.searchClientOperationsTodoClientOptions(ctx, q as never);
const optionIds = (r: { options: Array<{ client_id: string }> }): string[] => r.options.map((o) => o.client_id);

// ── 1. ToDo client type-to-search ────────────────────────────────────────────────────────────────────

test('S1 typed text becomes safe lowercase tokens (no LIKE / PostgREST filter syntax can pass)', () => {
  assert.deepEqual(todoPure.normalizeTodoClientSearchTokens('  Alpha   ONE '), ['alpha', 'one']);
  assert.deepEqual(todoPure.normalizeTodoClientSearchTokens('%_\\*,()"'), []);
  // `)` `,` `_` are dropped, so an injected filter fragment degrades to inert literal text tokens.
  assert.deepEqual(todoPure.normalizeTodoClientSearchTokens('a),organization_id.neq.x'), ['a', 'organization', 'id.neq.x']);
  assert.equal(todoPure.normalizeTodoClientSearchTokens('a b c d e f g h').length, todoPure.CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_MAX_TOKENS);
  assert.equal(todoPure.normalizeTodoClientSearchTokens('x'.repeat(500))[0].length, todoPure.CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_TOKEN_MAX_LENGTH);
  assert.equal(todoPure.normalizeTodoClientOptionsLimit(undefined), 20);
  assert.equal(todoPure.normalizeTodoClientOptionsLimit('1000'), 50);
  assert.equal(todoPure.normalizeTodoClientOptionsLimit('0'), 1);
  assert.equal(todoPure.normalizeTodoClientOptionsLimit('abc'), 20);
});

test('S2 Owner own workspace: typing reaches ANY authorized client (also beyond the old 200-row window)', async () => {
  seed();
  const r = await search(ownerCtx(), { workspace_scope: 'office', q: 'zzz zeta' });
  assert.deepEqual(optionIds(r), [ZETA]);
  assert.equal(r.has_more, false);
  // Case-insensitive; tax id is searchable too.
  assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: 'ZZZ' })), [ZETA]);
  assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: '599999999' })), [ZETA]);
  // Every typed token must match (AND), in any order.
  assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: 'ltd alpha two' })), [ALPHA_TWO]);
  // No match → empty, never an error.
  const none = await search(ownerCtx(), { workspace_scope: 'office', q: 'nonexistent-client' });
  assert.deepEqual(none, { options: [], has_more: false });
});

test('S3 only a small page is returned (DOM-bounded) with has_more; limit is clamped', async () => {
  seed();
  const first = await search(ownerCtx(), { workspace_scope: 'office' });
  assert.equal(first.options.length, 20);
  assert.equal(first.has_more, true);
  const names = first.options.map((o) => o.display_name ?? '');
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b)), names, 'sorted by display name');
  const big = await search(ownerCtx(), { workspace_scope: 'office', limit: 100000 });
  assert.equal(big.options.length, 50);
  assert.equal(big.has_more, true);
  const small = await search(ownerCtx(), { workspace_scope: 'office', q: 'bulk client', limit: 2 });
  assert.equal(small.options.length, 2);
  assert.equal(small.has_more, true);
  const exact = await search(ownerCtx(), { workspace_scope: 'office', q: 'alpha', limit: 2 });
  assert.equal(exact.options.length, 2);
  assert.equal(exact.has_more, false, 'exactly `limit` matches ⇒ no more');
});

test('S4 filter-syntax characters in typed text cannot widen the result or reach other tenants', async () => {
  seed();
  const base = await search(ownerCtx(), { workspace_scope: 'office' });
  for (const q of ['%', '_', '%%', '*', ',', '()', '"']) {
    assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q })), optionIds(base), `q=${q}`);
  }
  const injected = await search(ownerCtx(), {
    workspace_scope: 'office',
    q: 'x),organization_id.neq.org-1',
  });
  assert.deepEqual(injected.options, []);
  // Another organization's client never appears, even when typed exactly.
  assert.deepEqual((await search(ownerCtx(), { workspace_scope: 'office', q: 'Foreign' })).options, []);
  assert.ok(!optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: 'zzz' })).includes(FOREIGN));
});

test('S5 archived clients are never offered', async () => {
  seed();
  assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: 'archived' })), []);
});

test('S6 employee sees only their authorized clients; unauthorized never appear even when typed exactly', async () => {
  seed();
  const mine = await search(staffACtx(), { workspace_scope: 'my', q: 'alpha' });
  assert.deepEqual(optionIds(mine).sort(), [ALPHA_ONE, ALPHA_TWO]);
  const all = await search(staffACtx(), { workspace_scope: 'my' });
  assert.deepEqual(optionIds(all).sort(), [ALPHA_ONE, ALPHA_TWO]);
  for (const q of ['Beta Studio', 'Zzz Zeta Holdings', 'Bulk Client 001', '599999999']) {
    assert.deepEqual((await search(staffACtx(), { workspace_scope: 'my', q })).options, [], `q=${q}`);
  }
});

test('S7 Owner viewing employee A gets exactly employee A client scope (not the office scope)', async () => {
  seed();
  const viaOwner = await search(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A });
  assert.deepEqual(optionIds(viaOwner).sort(), [ALPHA_ONE, ALPHA_TWO]);
  assert.deepEqual(
    (await search(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_A, q: 'zzz' })).options,
    [],
  );
  // Switching to employee B → B's scope; back to the office → full office scope again.
  assert.deepEqual(
    optionIds(await search(ownerCtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_B })),
    [BETA],
  );
  assert.deepEqual(optionIds(await search(ownerCtx(), { workspace_scope: 'office', q: 'zzz' })), [ZETA]);
});

test('S8 employee cannot search another employee / office workspace', async () => {
  seed();
  await assert.rejects(
    () => search(staffACtx(), { workspace_scope: 'staff', workspace_subject_user_id: STAFF_B }),
    (e: { code?: string }) => e.code === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
  await assert.rejects(
    () => search(staffACtx(), { workspace_scope: 'office' }),
    (e: { code?: string }) => e.code === 'WORKSPACE_SCOPE_FORBIDDEN',
  );
});

test('S9 employee with zero client grants gets no options and no clients query', async () => {
  seed();
  tables.organization_member_client_grants = tables.organization_member_client_grants.filter((g) => g.user_id !== STAFF_A);
  resetCounters();
  const r = await search(staffACtx(), { workspace_scope: 'my', q: 'alpha' });
  assert.deepEqual(r, { options: [], has_more: false });
  assert.equal(countOf('clients'), 0);
});

test('S10 ToDo create from a searched option stores the canonical client_id', async () => {
  seed();
  const found = await search(ownerCtx(), { workspace_scope: 'office', q: 'zzz zeta' });
  const option = found.options[0];
  assert.equal(option.client_id, ZETA);
  await todoSvc.createClientOperationsTodo(ownerCtx(), {
    client_id: option.client_id,
    task_text: 'picked via type-to-search',
    workspace_scope: 'office',
  });
  const created = tables.client_operations_todos.find((r) => r.task_text === 'picked via type-to-search')!;
  assert.equal(created.client_id, ZETA);
  assert.equal(created.assigned_to_user_id, OWNER);
  // An unauthorized client id (not from the employee's options) is still rejected by the command.
  await assert.rejects(() =>
    todoSvc.createClientOperationsTodo(staffACtx(), {
      client_id: ZETA,
      task_text: 'not my client',
      workspace_scope: 'my',
    }),
  );
});

// ── 2. Registry client-list load — query count / concurrency protection ─────────────────────────────

const customColumn = (i: number, baselined: boolean) => ({
  id: `col-${i}`,
  organization_id: ORG,
  key: `custom_${i}`,
  label: `Col ${i}`,
  data_type: 'text' as const,
  position: i,
  visible: true,
  auto_extend_to_future: false,
  auto_extend_from_period_key: null,
  legacy_baseline_period_key: null,
  legacy_baseline_completed_at: baselined ? '2026-01-01T00:00:00Z' : null,
});

function seedUserColumnsPeriod(setupComplete: boolean) {
  const columns = Array.from({ length: 10 }, (_, i) => customColumn(i, i % 2 === 0));
  tables.client_operations_registry_custom_column_period_visibility = [];
  tables.client_operations_user_columns_period_setup = setupComplete
    ? [{ organization_id: ORG, operational_period_key: '2026-05' }]
    : [];
  tables.client_operations_registry_custom_column_period_values = [
    // col-0 (baselined) has a meaningful period value → eligible for the period-setup dialog.
    { organization_id: ORG, client_id: 'c', column_id: 'col-0', operational_period_key: '2026-04', value_text: 'x' },
  ];
  tables.client_operations_registry_custom_column_values = [
    // col-1 (NOT baselined) has a meaningful legacy value → needs the legacy-baseline prompt.
    { organization_id: ORG, client_id: 'c', column_id: 'col-1', value_text: 'legacy' },
  ];
  return columns;
}

test('P1 user-columns extras: no per-column queries; same eligibility / baseline result (setup pending)', async () => {
  seed();
  const columns = seedUserColumnsPeriod(false);
  resetCounters();
  const extras = await periodsSvc.buildUserColumnsPeriodAggregateExtras({
    organizationId: ORG,
    columns,
    selectedPeriodKey: '2026-05',
    availablePeriods: ['2026-04', '2026-05'],
    canEdit: true,
  });
  // visibility ×2 + setup ×1 + one batched scan per value table (legacy unbaselined / period / legacy baselined)
  assert.ok(calls.length <= 6, `expected ≤ 6 queries for 10 columns, got ${calls.length}: ${calls.join(',')}`);
  assert.ok(countOf('client_operations_registry_custom_column_values') <= 2);
  assert.equal(countOf('client_operations_registry_custom_column_period_values'), 1);
  assert.deepEqual(extras.columns_needing_legacy_baseline.map((c) => c.column_id), ['col-1']);
  assert.deepEqual(extras.user_column_period_setup?.eligible_columns.map((c) => c.column_id), ['col-0']);
});

test('P2 user-columns extras: completed period setup skips the full-history value scans entirely', async () => {
  seed();
  const columns = seedUserColumnsPeriod(true);
  resetCounters();
  const extras = await periodsSvc.buildUserColumnsPeriodAggregateExtras({
    organizationId: ORG,
    columns,
    selectedPeriodKey: '2026-05',
    availablePeriods: ['2026-04', '2026-05'],
    canEdit: true,
  });
  assert.equal(countOf('client_operations_registry_custom_column_period_values'), 0);
  assert.equal(countOf('client_operations_registry_custom_column_values'), 1);
  assert.ok(calls.length <= 4, `expected ≤ 4 queries, got ${calls.length}`);
  assert.equal(extras.user_column_period_setup, null);
  assert.deepEqual(extras.columns_needing_legacy_baseline.map((c) => c.column_id), ['col-1']);
});

test('P3 workspace resolver: subjects come with their display identity in ONE read (no users lookup)', async () => {
  seed();
  const scope = await import('../../src/domains/client-operations/client-operations-workspace.service.js');
  resetCounters();
  const resolved = await scope.resolveClientOperationsWorkspaceScopeFromContext(ownerCtx() as never, {
    workspace_scope: 'staff',
    workspace_subject_user_id: STAFF_A,
  });
  assert.equal(countOf('users'), 0, 'display names are embedded, not looked up separately');
  assert.deepEqual(
    resolved.workspace.available_workspace_subjects.map((s) => s.display_name).sort(),
    ['Anna A', 'Boris B'],
  );
  assert.equal(resolved.workspace.scope_kind, 'STAFF');
  assert.equal(resolved.workspace.workspace_subject_user_id, STAFF_A);
});

function seedRegistry(nClients: number) {
  seed();
  tables.clients = Array.from({ length: nClients }, (_, i) => ({
    id: `r-${i}`,
    organization_id: ORG,
    display_name: `Registry Client ${i}`,
    tax_id: `7${String(i).padStart(8, '0')}`,
    created_at: '2026-01-01T00:00:00.000Z',
    is_archived: false,
  }));
  tables.client_operations_registry_custom_columns = Array.from({ length: 10 }, (_, i) => ({
    ...customColumn(i, i % 2 === 0),
    archived_at: null,
  }));
}

test('P4 registry aggregate: independent reads start together; no N+1, no unused full-history reads', async () => {
  seedRegistry(25);
  resetCounters(5);
  const res = await registrySvc.listClientOperationsRegistry(
    ownerCtx() as never,
    { operational_period_key: '2026-05' },
    { materializationCache: false },
  );
  assert.equal(res.rows.length, 25);
  assert.equal(res.manual_rows.length, 5);
  // Custom columns: one batched value scan per table (was 1 + 10 per-column reads).
  assert.ok(countOf('client_operations_registry_custom_column_values') <= 2);
  // Member display names are embedded in the one subjects/handlers read.
  assert.equal(countOf('users'), 0);
  // NI-deductions full-history facts are read only for clients that configured that obligation.
  assert.equal(countOf('client_ni_deductions_126_cycles'), 0);
  // One clients read for the whole screen.
  assert.equal(countOf('clients'), 1);
  // Independent reads are in flight together (sequential awaits would keep this at 1–3).
  assert.ok(maxInFlight >= 5, `expected concurrent independent reads, max in flight = ${maxInFlight}`);
  // Total round trips stay bounded regardless of client count (set-based loads).
  const small = calls.length;
  seedRegistry(120);
  resetCounters(5);
  await registrySvc.listClientOperationsRegistry(
    ownerCtx() as never,
    { operational_period_key: '2026-05' },
    { materializationCache: false },
  );
  assert.equal(calls.length, small, 'query count must not grow with the number of clients');
  assert.ok(small <= 36, `registry aggregate query budget exceeded: ${small}`);
});

test('P5 registry aggregate: zero-client / zero-grant scope still returns the five manual slots', async () => {
  seedRegistry(0);
  resetCounters(0);
  const res = await registrySvc.listClientOperationsRegistry(
    ownerCtx() as never,
    { operational_period_key: '2026-05' },
    { materializationCache: false },
  );
  assert.equal(res.rows.length, 0);
  assert.equal(res.manual_rows.length, 5);
  seedRegistry(5);
  tables.organization_member_client_grants = [];
  const staff = await registrySvc.listClientOperationsRegistry(
    staffACtx() as never,
    { operational_period_key: '2026-05', workspace_scope: 'my' },
    { materializationCache: false },
  );
  assert.equal(staff.rows.length, 0, 'zero grants ⇒ zero client rows (no org-wide leak)');
  assert.equal(staff.manual_rows.length, 5);
});

test('P6 registry aggregate: employee and Owner-viewing-employee see the same authorized client rows', async () => {
  seedRegistry(6);
  tables.organization_member_client_grants = [
    { organization_id: ORG, user_id: STAFF_A, client_id: 'r-1' },
    { organization_id: ORG, user_id: STAFF_A, client_id: 'r-4' },
  ];
  resetCounters(0);
  const own = await registrySvc.listClientOperationsRegistry(
    staffACtx() as never,
    { operational_period_key: '2026-05', workspace_scope: 'my' },
    { materializationCache: false },
  );
  const viaOwner = await registrySvc.listClientOperationsRegistry(
    ownerCtx() as never,
    { operational_period_key: '2026-05', workspace_scope: 'staff', workspace_subject_user_id: STAFF_A },
    { materializationCache: false },
  );
  const office = await registrySvc.listClientOperationsRegistry(
    ownerCtx() as never,
    { operational_period_key: '2026-05', workspace_scope: 'office' },
    { materializationCache: false },
  );
  const ids = (r: { rows: Array<{ client_id: string }> }) => r.rows.map((x) => x.client_id).sort();
  assert.deepEqual(ids(own), ['r-1', 'r-4']);
  assert.deepEqual(ids(viaOwner), ['r-1', 'r-4']);
  assert.equal(office.rows.length, 6);
});

test('P7 period switching re-reads only the period-bound state; the aggregate stays a single GET', () => {
  const src = repo('apps/api/src/domains/client-operations/client-operations.service.ts');
  // Independent boot reads are started together (not awaited one after another).
  assert.match(src, /const bootPromise = settled\(/);
  assert.match(src, /const userColumnsExtrasPromise = settled\(/);
  assert.match(src, /const manualRowsPeriodSetupPromise = settled\(/);
  assert.match(src, /const manualRowValuesPromise = settled\(/);
  const clientsRead = src.indexOf("timed('active_clients'");
  assert.ok(clientsRead > src.indexOf('const sharedInputsPromise = settled('), 'shared reads are started BEFORE the clients chain');
  // The registry period cache + pre-search materialization cache remain the only caches (no new stale cache).
  assert.match(src, /clientOperationsRegistryMaterializationCache\.getOrBuild/);
  // Authorization (workspace + ACL) is resolved before any cache lookup or read.
  assert.ok(
    src.indexOf('resolveClientOperationsWorkspaceScopeFromContext(ctx, {') <
      src.indexOf('clientOperationsRegistryMaterializationCache.getOrBuild'),
  );
});

test('P8 the ToDo aggregate still declares the backend search endpoint the picker uses (no new GET)', () => {
  const service = repo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.match(service, /available_clients_hint/);
  assert.match(service, /search_endpoint: 'todo_client_options'/);
  const routes = repo('apps/api/src/domains/client-operations/client-operations.routes.ts');
  assert.equal((routes.match(/todo\/client-options/g) ?? []).length, 1);
});
