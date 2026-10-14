/**
 * Client Operations ToDo — request critical path (sequential database round trips).
 *
 * WHY: in production every database / auth call from the API costs one network round trip, and the API runs
 * far from Supabase (measured: ~0.3 s per call — see the performance report). Latency of a request is therefore
 * dominated by the DEPTH of its sequential call chain, not by how many calls it makes. This spec measures that
 * depth exactly (a logical clock, no timers, no real network) for the complete ToDo request path:
 *
 *   authMiddleware -> requireModuleActive('client-operations') -> ToDo service
 *
 * and locks it with budgets so a future change cannot silently re-introduce waterfalls. It also proves the
 * optimized gate keeps its exact decisions (deny reasons, order, audit) — see G* tests.
 *
 * Runs against an in-memory fake (no network, no migrations).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

type Row = Record<string, unknown>;
type Res = { data: unknown; error: null | { message: string }; count?: number };

// ── logical clock: depth of the longest sequential chain of completed calls ─────────────────────────────
let clock = 0;
let callCount = 0;
const resetClock = (): void => {
  clock = 0;
  callCount = 0;
};
/** Complete `produce()` one logical step after the moment the call was ISSUED (calls issued together overlap). */
const trace: string[] = [];
function step<T>(produce: () => T, label = '?'): Promise<T> {
  const start = clock;
  trace.push(`${start + 1} ${label}`);
  callCount += 1;
  return new Promise<T>((resolve, reject) => {
    setImmediate(() => {
      clock = Math.max(clock, start + 1);
      try {
        resolve(produce());
      } catch (e) {
        reject(e);
      }
    });
  });
}

const tables: Record<string, Row[]> = {};
let writes: Array<{ table: string; kind: 'insert' | 'update'; row: Row }> = [];
let idSeq = 0;
/** Failure injection per table: a returned `{ error }` ('error') or a rejected call ('throw'). */
const failTables = new Map<string, 'error' | 'throw'>();

class FakeQuery implements PromiseLike<Res> {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private wantCount = false;
  private max: number | null = null;
  private single_ = false;
  private embedUsers = false;
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
  gt(col: string, val: unknown) {
    this.filters.push((r) => String(r[col]) > String(val));
    return this;
  }
  not(col: string, _op: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] != null : r[col] !== val));
    return this;
  }
  or(expr: string) {
    const clauses = expr.split(',').map((c) => {
      const first = c.indexOf('.');
      const second = c.indexOf('.', first + 1);
      return { col: c.slice(0, first), val: c.slice(second + 1) };
    });
    this.filters.push((r) =>
      clauses.some((c) =>
        new RegExp(`^${c.val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i').test(
          String(r[c.col] ?? ''),
        ),
      ),
    );
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
  private run(): Res {
    const injected = failTables.get(this.table);
    if (injected === 'throw') throw new Error(`injected network failure on ${this.table}`);
    if (injected === 'error') return { data: null, error: { message: `injected db error on ${this.table}` } };
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
    ok?: ((v: Res) => T1 | PromiseLike<T1>) | null,
    bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return step(() => this.run(), `${this.table}:${this.mode}`).then(ok, bad);
  }
}

// Supabase Auth (`auth.getUser`) goes through global fetch: one logical step as well.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes('/auth/v1/user')) throw new Error(`unexpected network call: ${url}`);
  return step(
    () =>
      new Response(JSON.stringify({ id: 'auth-owner', email: 'owner@x.io', aud: 'authenticated', app_metadata: {}, user_metadata: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}) as typeof fetch;

const { supabaseAdmin } = await import('../../src/db/client.js');
const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
(supabaseAdmin as unknown as { from: (t: string) => FakeQuery }).from = (t: string) => new FakeQuery(t);
test.after(() => {
  (supabaseAdmin as unknown as { from: unknown }).from = realFrom;
  globalThis.fetch = realFetch;
});

const { authMiddleware } = await import('../../src/middleware/auth.js');
const { requireModuleActive } = await import('../../src/middleware/requireModuleActive.js');
const todoSvc = await import('../../src/domains/client-operations/client-operations-todo.service.js');

// ── seed ────────────────────────────────────────────────────────────────────────────────────────────────
const ORG = 'org-1';
const OWNER = 'u-owner';
const STAFF = 'u-staff';
const AUTH_OF: Record<string, string> = { [OWNER]: 'auth-owner', [STAFF]: 'auth-staff' };
const MOD = 'mod-co';

function seed(opts: { subscription?: 'active' | 'none-with-trial' | 'none'; system?: boolean } = {}): void {
  for (const k of Object.keys(tables)) delete tables[k];
  writes = [];
  idSeq = 0;
  failTables.clear();
  tables.users = [
    { id: OWNER, auth_user_id: 'auth-owner', email: 'owner@x.io', full_name: 'Olga', status: 'active', ui_language: 'he' },
    { id: STAFF, auth_user_id: 'auth-staff', email: 's@x.io', full_name: 'Sam', status: 'active', ui_language: 'he' },
  ];
  tables.organization_memberships = [
    { id: 'm-owner', organization_id: ORG, user_id: OWNER, role_code: 'owner', status: 'active' },
    { id: 'm-staff', organization_id: ORG, user_id: STAFF, role_code: 'staff', status: 'active' },
  ];
  tables.rbac_role_permissions = [
    { role_code: 'owner', permission_code: 'client_operations.view' },
    { role_code: 'owner', permission_code: 'client_operations.edit' },
    { role_code: 'staff', permission_code: 'client_operations.view' },
    { role_code: 'staff', permission_code: 'client_operations.edit' },
  ];
  tables.modules = [
    { id: MOD, code: 'client-operations', name: 'Client Operations', is_active: true, is_system: opts.system === true, nav_path: '/co' },
    { id: 'mod-other', code: 'invoice', name: 'Invoices', is_active: true, is_system: false, nav_path: '/inv' },
  ];
  tables.organization_modules = [{ id: 'om-1', organization_id: ORG, module_id: MOD, status: 'active' }];
  const sub = opts.subscription ?? 'active';
  tables.organization_module_subscriptions =
    sub === 'active' ? [{ id: 's-1', organization_id: ORG, module_id: MOD, status: 'active', ends_at: null, trial_ends_at: null }] : [];
  tables.organization_trials =
    sub === 'none-with-trial'
      ? [{ id: 't-1', organization_id: ORG, trial_scope: 'full_platform', status: 'trialing', ends_at: '2999-01-01T00:00:00.000Z' }]
      : [];
  tables.organization_member_module_access = [
    { organization_id: ORG, membership_id: 'm-staff', module_id: MOD, enabled: true },
  ];
  tables.organization_member_client_access = [{ organization_id: ORG, user_id: STAFF, access_mode: 'selected' }];
  tables.organization_member_client_grants = [{ organization_id: ORG, user_id: STAFF, client_id: 'c-1' }];
  tables.clients = [{ id: 'c-1', organization_id: ORG, display_name: 'Client c-1', tax_id: 't1', is_archived: false }];
  tables.client_operational_profiles = [];
  tables.audit_log = [];
  tables.client_operations_todos = [
    {
      id: 't-owner-1', organization_id: ORG, client_id: 'c-1', assigned_to_user_id: OWNER, task_text: 'owner task', priority: 2,
      created_at: '2026-01-01T00:00:00.000Z', created_by_user_id: OWNER, updated_at: '2026-01-01T00:00:00.000Z',
      updated_by_user_id: OWNER, completed_at: null, completed_by_user_id: null,
    },
    {
      id: 't-staff-1', organization_id: ORG, client_id: 'c-1', assigned_to_user_id: STAFF, task_text: 'staff task', priority: 2,
      created_at: '2026-01-01T00:00:00.000Z', created_by_user_id: STAFF, updated_at: '2026-01-01T00:00:00.000Z',
      updated_by_user_id: STAFF, completed_at: null, completed_by_user_id: null,
    },
  ];
}

type FakeReq = { headers: Record<string, string>; context?: any; correlationId?: string };
const reqFor = (authUserId: string): FakeReq => ({
  headers: { authorization: `Bearer ${authUserId}`, 'x-organization-id': ORG },
});

/** Runs a Core middleware and resolves with what it passed to next() (undefined = allowed). */
function runMw(mw: (req: any, res: any, next: (e?: unknown) => void) => unknown, req: FakeReq): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      const out = mw(req, {}, (e?: unknown) => resolve(e));
      if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function authAs(userId: string): Promise<FakeReq> {
  // the fake auth server answers for whichever bearer token is sent
  const req = reqFor(userId);
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('/auth/v1/user')) throw new Error(`unexpected network call: ${url}`);
    const bearer = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '');
    const id = bearer || AUTH_OF[userId];
    return step(
      () =>
        new Response(JSON.stringify({ id, email: 'x@x.io', aud: 'authenticated', app_metadata: {}, user_metadata: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  }) as typeof fetch;
  try {
    const err = await runMw(authMiddleware as never, req);
    assert.equal(err, undefined, 'auth must pass');
  } finally {
    globalThis.fetch = prevFetch;
  }
  return req;
}

/** auth -> module gate -> a ToDo operation, as one request. Returns the depth of every stage. */
async function measure(
  who: 'owner' | 'staff',
  op: (ctx: any) => Promise<unknown>,
): Promise<{ auth: number; gate: number; handler: number; total: number; calls: number }> {
  const userId = who === 'owner' ? OWNER : STAFF;
  resetClock();
  const req = await authAs(who === 'owner' ? AUTH_OF[OWNER] : AUTH_OF[STAFF]);
  const auth = clock;
  const gateErr = await runMw(requireModuleActive('client-operations') as never, req);
  assert.equal(gateErr, undefined, 'gate must allow');
  const gate = clock - auth;
  const ctx = { ...req.context, user: { ...req.context.user, id: userId } };
  await op(ctx);
  const handler = clock - auth - gate;
  return { auth, gate, handler, total: clock, calls: callCount };
}

const MY = { workspace_scope: 'my' };
const OFFICE = { workspace_scope: 'office' };
type Depth = { auth: number; gate: number; handler: number; total: number; calls: number };
const report = (label: string, m: Depth): void => {
  // eslint-disable-next-line no-console
  console.log(`DEPTH ${label.padEnd(30)} auth=${m.auth} gate=${m.gate} handler=${m.handler} TOTAL=${m.total} (calls=${m.calls})`);
};

const countTrace = (from: number, prefix: string): number => trace.slice(from).filter((l) => l.split(' ')[1]?.startsWith(prefix)).length;

// ── R. request critical path budgets ─────────────────────────────────────────────────────────────────────
// BEFORE this optimization (measured with this same harness on commit 706ae438):
//   owner board 11 · owner board (trial org) 12 · staff board 16 · owner create 15 · staff update 17 · owner complete 11
//   · owner archive 10   (gate alone: 4 owner / 5 trial / 7 staff)
// Every sequential step is one network round trip to Supabase in production (measured ≈ 0.3–0.65 s each).

const OP = {
  board: (ctx: any, scope = OFFICE) => todoSvc.getClientOperationsTodoBoard(ctx, scope),
  archive: (ctx: any) => todoSvc.getClientOperationsTodoArchive(ctx, OFFICE),
  create: (ctx: any, scope = OFFICE) =>
    todoSvc.executeClientOperationsTodoCommand(ctx, { command: 'create_client_operations_todo', client_id: 'c-1', task_text: 'x', ...scope } as never),
  update: (ctx: any) =>
    todoSvc.executeClientOperationsTodoCommand(ctx, { command: 'update_client_operations_todo', todo_id: 't-staff-1', task_text: 'y', ...MY } as never),
  complete: (ctx: any) =>
    todoSvc.executeClientOperationsTodoCommand(ctx, { command: 'complete_client_operations_todo', todo_id: 't-owner-1', completion_reason: 'z', ...OFFICE } as never),
};

test('R1 critical-path depth budgets (owner / staff / trial org) — gate is one step beyond the module read', async () => {
  seed();
  const ownerBoard = await measure('owner', (c) => OP.board(c));
  report('owner board open', ownerBoard);
  seed({ subscription: 'none-with-trial' });
  const trialBoard = await measure('owner', (c) => OP.board(c));
  report('owner board open (trial)', trialBoard);
  seed();
  const staffBoard = await measure('staff', (c) => OP.board(c, MY));
  report('staff board open', staffBoard);
  seed();
  const ownerCreate = await measure('owner', (c) => OP.create(c));
  report('owner create', ownerCreate);
  seed();
  const staffUpdate = await measure('staff', (c) => OP.update(c));
  report('staff update', staffUpdate);
  seed();
  const ownerComplete = await measure('owner', (c) => OP.complete(c));
  report('owner complete', ownerComplete);
  seed();
  const ownerArchive = await measure('owner', (c) => OP.archive(c));
  report('owner archive open', ownerArchive);

  // module gate: module read, then everything else overlaps (was 4 / 5 / 7)
  for (const m of [ownerBoard, trialBoard, staffBoard]) assert.ok(m.gate <= 2, `gate depth ${m.gate} must be <= 2`);
  // whole request
  assert.ok(ownerBoard.total <= 9, `owner board ${ownerBoard.total}`);
  assert.ok(trialBoard.total <= 9, `owner board (trial) ${trialBoard.total}`);
  assert.ok(staffBoard.total <= 10, `staff board ${staffBoard.total}`);
  assert.ok(ownerCreate.total <= 11, `owner create ${ownerCreate.total}`);
  assert.ok(staffUpdate.total <= 11, `staff update ${staffUpdate.total}`);
  assert.ok(ownerComplete.total <= 9, `owner complete ${ownerComplete.total}`);
  assert.ok(ownerArchive.total <= 8, `owner archive ${ownerArchive.total}`);
});

test('R2 gate does not repeat reads (one modules read for the code, one organization_modules, one subscription)', async () => {
  seed();
  resetClock();
  trace.length = 0;
  const req = await authAs('auth-owner');
  const from = trace.length;
  assert.equal(await runMw(requireModuleActive('client-operations') as never, req), undefined);
  assert.equal(countTrace(from, 'modules:'), 1, 'modules read once (was twice)');
  assert.equal(countTrace(from, 'organization_modules:'), 1);
  assert.equal(countTrace(from, 'organization_module_subscriptions:'), 1);
  assert.equal(countTrace(from, 'organization_member_module_access:'), 0, 'Owner has no staff grant read');
});

// ── G. the gate keeps every decision, reason, audit entry and precedence ─────────────────────────────────
async function gateAs(who: 'owner' | 'staff'): Promise<unknown> {
  const req = await authAs(who === 'owner' ? AUTH_OF[OWNER] : AUTH_OF[STAFF]);
  return runMw(requireModuleActive('client-operations') as never, req);
}
const denied = (e: unknown): { statusCode?: number; code?: string; message?: string } => {
  assert.ok(e && typeof e === 'object', 'expected a denial');
  assert.equal((e as { statusCode?: number }).statusCode, 403);
  return e as { statusCode?: number; code?: string; message?: string };
};
const moduleDenyAudits = (): Row[] => (tables.audit_log ?? []).filter((r) => r.action === 'module.access_denied' || String(r.action).includes('access_denied'));

test('G1 allowed: Owner, Staff with a grant, trial org, system module', async () => {
  seed();
  assert.equal(await gateAs('owner'), undefined);
  assert.equal(await gateAs('staff'), undefined);
  seed({ subscription: 'none-with-trial' });
  assert.equal(await gateAs('owner'), undefined);
  assert.equal(await gateAs('staff'), undefined);
  seed({ subscription: 'none', system: true });
  assert.equal(await gateAs('owner'), undefined, 'system modules are always entitled');
});

test('G2 Staff without a grant is denied (MEMBER_MODULE_ACCESS_DENIED); grant revocation applies to the very next request', async () => {
  seed();
  assert.equal(await gateAs('staff'), undefined);
  tables.organization_member_module_access = []; // grant removed between two requests: nothing is cached
  const e = denied(await gateAs('staff'));
  assert.equal(e.code, 'MEMBER_MODULE_ACCESS_DENIED');
  assert.equal(await gateAs('owner'), undefined, 'Owner is unaffected');
});

test('G3 module not active for the organization: denied + audited, even when the Staff grant is also missing', async () => {
  seed();
  tables.organization_modules = [];
  tables.organization_member_module_access = [];
  const e = denied(await gateAs('staff'));
  assert.match(String(e.message), /Module not active for this organization/);
  const audits = moduleDenyAudits();
  assert.equal(audits.length, 1);
  assert.equal((audits[0].payload_json as { reason: string }).reason, 'Module not active for organization');
});

test('G4 not entitled (no subscription, no trial): denied + audited, and it wins over a missing Staff grant', async () => {
  seed({ subscription: 'none' });
  tables.organization_member_module_access = [];
  const e = denied(await gateAs('staff'));
  assert.match(String(e.message), /No subscription or trial for this module/);
  assert.equal(moduleDenyAudits().length, 1);
  assert.equal(e.code, 'FORBIDDEN', 'entitlement denial, not the Staff grant code');
});

test('G5 expired subscription is denied with its reason; globally disabled module is denied before any other read', async () => {
  seed();
  (tables.organization_module_subscriptions[0] as Row).ends_at = '2000-01-01T00:00:00.000Z';
  assert.match(String(denied(await gateAs('owner')).message), /Subscription ended/);
  seed();
  (tables.modules[0] as Row).is_active = false;
  resetClock();
  trace.length = 0;
  const req = await authAs('auth-owner');
  const from = trace.length;
  const e = denied(await runMw(requireModuleActive('client-operations') as never, req));
  assert.match(String(e.message), /globally disabled/);
  assert.equal(countTrace(from, 'organization_modules:'), 0, 'no org-module read after a global kill-switch denial');
});

test('G6 a failing Staff-grant read never becomes an unhandled rejection when an earlier check already denied', async () => {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    seed();
    tables.organization_modules = [];
    const req2 = await authAs('auth-staff');
    failTables.set('organization_member_module_access', 'throw');
    const e = denied(await runMw(requireModuleActive('client-operations') as never, req2));
    assert.match(String(e.message), /Module not active for this organization/);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(seen, [], 'no unhandled rejection');
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('G7 a failing Staff-grant read still fails the request when every earlier check passed (fail closed)', async () => {
  seed();
  const req = await authAs('auth-staff');
  failTables.set('organization_member_module_access', 'error');
  const err = await runMw(requireModuleActive('client-operations') as never, req).catch((e) => e);
  assert.ok(err !== undefined, 'must not allow the request');
});

test('G8 resolveEntitlement: unchanged contract without a known module; trial read overlaps only on the gate path', async () => {
  const { resolveEntitlement } = await import('../../src/domains/modules/entitlement.service.js');
  seed();
  assert.deepEqual(await resolveEntitlement(ORG, MOD), { status: 'entitled' });
  seed({ subscription: 'none-with-trial' });
  assert.deepEqual(await resolveEntitlement(ORG, MOD), { status: 'trial' });
  assert.deepEqual(await resolveEntitlement(ORG, MOD, { id: MOD, is_system: false }), { status: 'trial' });
  seed({ subscription: 'none' });
  assert.equal((await resolveEntitlement(ORG, MOD)).status, 'not_entitled');
  assert.equal((await resolveEntitlement(ORG, 'missing')).status, 'not_entitled');
  // a stale/mismatched hint is ignored: the module is read as before
  assert.equal((await resolveEntitlement(ORG, 'missing', { id: MOD, is_system: true })).status, 'not_entitled');
  // lazy path (loops over many modules) keeps subscription-first behavior: no trial read when a subscription exists
  seed();
  resetClock();
  trace.length = 0;
  await resolveEntitlement(ORG, MOD);
  assert.equal(countTrace(0, 'organization_trials:'), 0);
});

// ── H. ToDo create: independent checks overlap, precedence of denials is unchanged ───────────────────────
test('H1 create: eligible members are listed once (was twice) and the actor/assignee checks overlap', async () => {
  seed();
  resetClock();
  trace.length = 0;
  const req = await authAs('auth-owner');
  assert.equal(await runMw(requireModuleActive('client-operations') as never, req), undefined);
  const from = trace.length;
  await OP.create({ ...req.context, user: { ...req.context.user, id: OWNER } });
  // workspace resolution (1) + eligible-member listing (1) = 2; before: 3 (the listing ran twice)
  assert.equal(countTrace(from, 'organization_memberships:'), 2);
  assert.equal(writes.filter((w) => w.table === 'client_operations_todos' && w.kind === 'insert').length, 1);
});

test('H2 create denial precedence: client access → input validation → assignee eligibility', async () => {
  // (a) staff, client outside their ACL AND empty text → the client denial wins
  seed();
  const staffReq = await authAs('auth-staff');
  const sctx = { ...staffReq.context, user: { ...staffReq.context.user, id: STAFF } };
  tables.clients.push({ id: 'c-9', organization_id: ORG, display_name: 'Other', tax_id: 't9', is_archived: false });
  const a = await todoSvc
    .executeClientOperationsTodoCommand(sctx, { command: 'create_client_operations_todo', client_id: 'c-9', task_text: '   ', ...MY } as never)
    .catch((e) => e);
  assert.equal((a as { statusCode?: number }).statusCode, 403, 'client denial (not the 400 for empty text)');
  // (b) authorized client, empty text → validation error, nothing written
  const b = await todoSvc
    .executeClientOperationsTodoCommand(sctx, { command: 'create_client_operations_todo', client_id: 'c-1', task_text: '   ', ...MY } as never)
    .catch((e) => e);
  assert.equal((b as { statusCode?: number }).statusCode, 400);
  // (c) assignee not handler-eligible (role viewer) → the handler-eligibility denial
  tables.organization_memberships = tables.organization_memberships.map((m) => (m.user_id === STAFF ? { ...m, role_code: 'viewer' } : m));
  const c = await todoSvc
    .executeClientOperationsTodoCommand({ ...sctx, membership: { ...sctx.membership, roleCode: 'viewer' } }, {
      command: 'create_client_operations_todo', client_id: 'c-1', task_text: 'ok', ...MY,
    } as never)
    .catch((e) => e);
  assert.equal((c as { statusCode?: number }).statusCode, 403);
  assert.match(String((c as Error).message), /Assigned handler must be an active organization member/);
  assert.equal(writes.filter((w) => w.table === 'client_operations_todos').length, 0, 'nothing persisted on any denial');
});

test('H3 create for an unauthorized assignee check failing after a passing client check writes nothing (no duplicate / partial task)', async () => {
  seed();
  const req = await authAs('auth-owner');
  const octx = { ...req.context, user: { ...req.context.user, id: OWNER } };
  failTables.set('rbac_role_permissions', 'throw'); // eligibility lookup fails
  await assert.rejects(() => OP.create(octx));
  assert.equal(writes.filter((w) => w.table === 'client_operations_todos').length, 0);
  assert.equal((tables.audit_log ?? []).length, 0);
});

// ── A. client ACL resolver: grants read overlaps the policy read, decisions unchanged ────────────────────
const aclMod = await import('../../src/domains/client-operations/organization-client-access.js');
const resolveAcl = (viewer: string, role: string) =>
  aclMod.resolveOrganizationClientAccessScope({ organizationId: ORG, viewerUserId: viewer, roleCode: role });

test('A1 selected member: live non-archived granted clients only; depth 2 (was 3)', async () => {
  seed();
  tables.clients.push({ id: 'c-arch', organization_id: ORG, display_name: 'Archived', tax_id: 'a', is_archived: true });
  tables.organization_member_client_grants.push({ organization_id: ORG, user_id: STAFF, client_id: 'c-arch' });
  resetClock();
  const scope = await resolveAcl(STAFF, 'staff');
  assert.deepEqual(scope.authorized_client_ids, ['c-1']);
  assert.equal(clock, 2, 'policy ∥ grants, then the live-client filter');
});

test('A2 office roles resolve without any read; `all` mode ignores grants (even if the speculative grants read failed)', async () => {
  seed();
  resetClock();
  assert.equal((await resolveAcl(OWNER, 'owner')).authorized_client_ids, null);
  assert.equal(callCount, 0);
  tables.organization_member_client_access = [{ organization_id: ORG, user_id: STAFF, access_mode: 'all' }];
  failTables.set('organization_member_client_grants', 'error');
  assert.equal((await resolveAcl(STAFF, 'staff')).authorized_client_ids, null);
  failTables.set('organization_member_client_grants', 'throw');
  assert.equal((await resolveAcl(STAFF, 'staff')).authorized_client_ids, null);
});

test('A3 selected + failing grants read fails closed with the original error', async () => {
  seed();
  failTables.set('organization_member_client_grants', 'error');
  await assert.rejects(() => resolveAcl(STAFF, 'staff'), /Failed to load client access grants|injected db error/);
  failTables.set('organization_member_client_grants', 'throw');
  await assert.rejects(() => resolveAcl(STAFF, 'staff'), /injected network failure|Failed to load client access grants/);
});

test('A4 missing policy stays fail-closed (assigned-only, empty allow-list) and a failed policy read still throws', async () => {
  seed();
  tables.organization_member_client_access = [];
  const scope = await resolveAcl(STAFF, 'staff');
  assert.deepEqual(scope.authorized_client_ids, []);
  failTables.set('organization_member_client_access', 'error');
  await assert.rejects(() => resolveAcl(STAFF, 'staff'), /Failed to load client access policy|injected db error/);
});

// ── T. Server-Timing measurement header (no behavior, aggregates only) ───────────────────────────────────
const timing = await import('../../src/shared/request-timing.js');

test('T1 Server-Timing: format exposes only aggregates', () => {
  const header = timing.formatServerTiming({ startedAt: 1000, calls: 21, sumMs: 3120, maxMs: 402 }, 3310);
  assert.equal(
    header,
    'total;dur=2310;desc="API time in the process", db;dur=3120;desc="21 data calls, avg 149ms, max 402ms (sum of overlapping calls)"',
  );
  assert.doesNotMatch(header, /organization|client|todo|users|token|uuid/i);
});

test('T2 Server-Timing: middleware counts data calls made during a request and sets the header once', async () => {
  const headers = new Map<string, string>();
  let headersSent = false;
  const res = {
    get headersSent() {
      return headersSent;
    },
    hasHeader: (n: string) => headers.has(n),
    setHeader: (n: string, v: string) => void headers.set(n, v),
    writeHead(this: unknown, ...args: unknown[]) {
      headersSent = true;
      return args;
    },
  };
  const seenFetch: string[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    seenFetch.push(String(input));
    await new Promise((r) => setTimeout(r, 5));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await new Promise<void>((resolve) => {
      timing.requestTimingMiddleware({} as never, res as never, () => {
        void Promise.all([timing.timedFetch('https://x/a'), timing.timedFetch('https://x/b')]).then(() => {
          res.writeHead(200);
          resolve();
        });
      });
    });
  } finally {
    globalThis.fetch = prev;
  }
  const value = headers.get('Server-Timing') ?? '';
  assert.match(value, /^total;dur=\d+;desc="API time in the process", db;dur=\d+;desc="2 data calls, avg \d+ms, max \d+ms \(sum of overlapping calls\)"$/);
  assert.deepEqual(seenFetch, ['https://x/a', 'https://x/b']);
  // a second writeHead must not rewrite the header
  headers.set('Server-Timing', 'keep');
  res.writeHead(200);
  assert.equal(headers.get('Server-Timing'), 'keep');
});

test('T3 timedFetch is transparent: same result outside a request, same error inside one', async () => {
  const prev = globalThis.fetch;
  const ok = new Response('hello', { status: 201 });
  globalThis.fetch = (async () => ok) as typeof fetch;
  try {
    assert.equal(await timing.timedFetch('https://x'), ok, 'outside a request: delegated as-is');
    globalThis.fetch = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    await new Promise<void>((resolve, reject) => {
      timing.requestTimingMiddleware({} as never, { hasHeader: () => false, setHeader() {}, writeHead() {}, headersSent: false } as never, () => {
        timing.timedFetch('https://x').then(
          () => reject(new Error('should have thrown')),
          (e: unknown) => {
            try {
              assert.match(String((e as Error).message), /network down/);
              resolve();
            } catch (x) {
              reject(x);
            }
          },
        );
      });
    });
  } finally {
    globalThis.fetch = prev;
  }
});

test('T4 wiring: the Supabase clients use timedFetch and the middleware is registered before the routes', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const api = join(dirname(fileURLToPath(import.meta.url)), '../../src');
  const client = readFileSync(join(api, 'db/client.ts'), 'utf8');
  const auth = readFileSync(join(api, 'middleware/auth.ts'), 'utf8');
  const index = readFileSync(join(api, 'index.ts'), 'utf8');
  assert.match(client, /global: \{ fetch: timedFetch \}/);
  assert.match(auth, /global: \{ fetch: timedFetch \}/);
  const use = index.indexOf('app.use(requestTimingMiddleware)');
  assert.ok(use > 0 && use < index.indexOf("app.use('/api/v1/public'"), 'registered before any route');
});
