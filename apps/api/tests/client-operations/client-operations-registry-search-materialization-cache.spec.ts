/**
 * Client Operations — repeated search performance:
 * PRE-SEARCH materialization cache (org + period + filters + capability; never q/sort)
 * + EXISTING `applyRegistryQueryToRows` / `materializeClientOperationsManualRows(searchQ)` per request.
 *
 * Covers: reuse within TTL for different q, TTL rebuild, dimension isolation (period / filters / org /
 * capability), mutation safety (invalidate + never store a pre-invalidation build), coalescing,
 * tenant isolation, search-semantics equivalence, and source contracts for route / commands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoundedTtlCache } from '../../src/shared/bounded-ttl-cache.js';
import {
  CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES,
  CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS,
  buildClientOperationsRegistryMaterializationCacheKey,
  clearClientOperationsRegistryMaterializationCacheForTests,
  clientOperationsRegistryMaterializationCache,
  clientOperationsRegistryMaterializationCacheOrgPrefix,
  invalidateClientOperationsRegistryMaterializationCache,
} from '../../src/domains/client-operations/client-operations-registry-materialization-cache.js';
import {
  normalizeClientOperationsRegistryBusinessFilterQuery,
  rowMatchesClientOperationsBusinessFilters,
  type ClientOperationsRegistryRowFilterFacets,
} from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';
import {
  applyRegistryQueryToRows,
  buildRegistryRowCells,
  formatPcnRegistryDisplay,
  mergeCustomCellsIntoRow,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { materializeClientOperationsManualRows } from '../../src/domains/client-operations/client-operations-manual-rows.pure.js';
import { formatOperationalDateDisplayHe } from '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const serviceSource = read('../../src/domains/client-operations/client-operations.service.ts');
const routesSource = read('../../src/domains/client-operations/client-operations.routes.ts');
const cacheSource = read(
  '../../src/domains/client-operations/client-operations-registry-materialization-cache.ts',
);
const customColumnsSource = read(
  '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts',
);
const notesSource = read('../../src/domains/client-operations/client-operations-notes.service.ts');
const manualRowsSource = read(
  '../../src/domains/client-operations/client-operations-manual-rows.service.ts',
);
const workEngineClientsTabSource = read(
  '../../src/domains/work-engine/work-engine-clients-tab.read-model.service.ts',
);

const noFilters = () => normalizeClientOperationsRegistryBusinessFilterQuery({});

const baseKeyInput = (overrides: Partial<Parameters<typeof buildClientOperationsRegistryMaterializationCacheKey>[0]> = {}) => ({
  organizationId: 'org-A',
  accessScopeKey: 'OFFICE',
  selectedPeriodKey: '2026-09',
  defaultPeriodKey: '2026-09',
  canEditRegistry: true,
  filters: noFilters(),
  ...overrides,
});

function fakeClock(start = 5_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

// ---------------------------------------------------------------------------
// Cache key — every pre-search dimension, never q / sort
// ---------------------------------------------------------------------------

test('key: q / sort are not inputs — same base ⇒ same key regardless of search', () => {
  const key = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput());
  assert.equal(key, buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput()));
  // The key builder has no q / sort dimension at all (type + source contract).
  const keyFnSource = cacheSource.slice(
    cacheSource.indexOf('export function buildClientOperationsRegistryMaterializationCacheKey'),
    cacheSource.indexOf('export const clientOperationsRegistryMaterializationCache'),
  );
  assert.doesNotMatch(keyFnSource, /\bq\b|sort_by|sort_dir|searchQ/);
  assert.match(cacheSource, /MUST NOT include `q`, `sort_by`, `sort_dir`/);
});

test('key: org / period / default period / capability / each business filter change the key', () => {
  const base = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput());
  const variants = [
    baseKeyInput({ organizationId: 'org-B' }),
    baseKeyInput({ accessScopeKey: 'ASSIGNED:user-A' }),
    baseKeyInput({ selectedPeriodKey: '2026-08' }),
    baseKeyInput({ defaultPeriodKey: '2026-10' }),
    baseKeyInput({ canEditRegistry: false }),
    baseKeyInput({ filters: { ...noFilters(), operational_reporting: 'not_reported' } }),
    baseKeyInput({ filters: { ...noFilters(), material: 'received' } }),
    baseKeyInput({ filters: { ...noFilters(), payroll: 'has_payroll' } }),
    baseKeyInput({ filters: { ...noFilters(), reporting_type: 'vat' } }),
    baseKeyInput({ filters: { ...noFilters(), business_type: 'company' } }),
    baseKeyInput({ filters: { ...noFilters(), handler: 'user-1' } }),
  ];
  const keys = variants.map((v) => buildClientOperationsRegistryMaterializationCacheKey(v));
  for (const k of keys) assert.notEqual(k, base);
  assert.equal(new Set(keys).size, keys.length, 'each dimension yields a distinct key');
});

test('key: Staff ASSIGNED scope never equals OFFICE for same org/period/filters', () => {
  const office = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ accessScopeKey: 'OFFICE' }));
  const staffA = buildClientOperationsRegistryMaterializationCacheKey(
    baseKeyInput({ accessScopeKey: 'ASSIGNED:staff-a' }),
  );
  const staffB = buildClientOperationsRegistryMaterializationCacheKey(
    baseKeyInput({ accessScopeKey: 'ASSIGNED:staff-b' }),
  );
  assert.notEqual(office, staffA);
  assert.notEqual(staffA, staffB);
  assert.match(office, /\u001fOFFICE\u001f/);
  assert.match(staffA, /\u001fASSIGNED:staff-a\u001f/);
});

test('key: org prefix is a strict scope (no cross-tenant prefix collision)', () => {
  const a = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ organizationId: 'org-1' }));
  const b = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ organizationId: 'org-10' }));
  assert.ok(a.startsWith(clientOperationsRegistryMaterializationCacheOrgPrefix('org-1')));
  assert.ok(!b.startsWith(clientOperationsRegistryMaterializationCacheOrgPrefix('org-1')));
});

// ---------------------------------------------------------------------------
// Pipeline simulation: first q builds; later q's reuse; TTL; dimensions never reuse
// ---------------------------------------------------------------------------

type Row = { client_id: string; client_name: string | null; cells: Record<string, string> };
type Materialization = { built_rows: Row[]; version: number };

function makeRows(): Row[] {
  const mk = (
    id: string,
    name: string,
    taxId: string,
    extra: Partial<Parameters<typeof buildRegistryRowCells>[0]> = {},
  ): Row => ({
    client_id: id,
    client_name: name,
    cells: buildRegistryRowCells({
      client_name: name,
      tax_id: taxId,
      business_type: null,
      payroll_flag: null,
      material_brought_flag: null,
      pcn_display: '',
      vat_status: null,
      vat_due_registry_display_he: null,
      income_tax_advance_status: null,
      national_insurance_status: null,
      national_insurance_deductions_status: null,
      income_tax_deductions_status: null,
      assigned_handler_display_he: null,
      notes_cell_text_he: null,
      ...extra,
    }),
  });
  return [
    mk('c1', 'Alpha Ltd', '512345678', { pcn_display: formatPcnRegistryDisplay('pcn') }),
    mk('c2', 'ישראל ישראלי', '039876543', { notes_cell_text_he: '(1) להתקשר לגבי מקדמות' }),
    mk('c3', 'Beta Holdings', '515555555', {
      annual_report_display_he: formatOperationalDateDisplayHe('2026-11-30'),
    }),
  ];
}

test('same period + same filters: first q builds, 2nd/3rd different q reuse within TTL; TTL ⇒ rebuild', async () => {
  const clock = fakeClock();
  const cache = new BoundedTtlCache<Materialization>({
    ttlMs: CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS,
    maxEntries: CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES,
    now: clock.now,
  });
  let builds = 0;
  const build = async (): Promise<Materialization> => ({ built_rows: makeRows(), version: ++builds });
  const key = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput());

  const search = async (q: string | null) => {
    const { value, source } = await cache.getOrBuild(key, build);
    return { rows: applyRegistryQueryToRows(value.built_rows, { q }), source, version: value.version };
  };

  const r1 = await search('alp');
  assert.equal(r1.source, 'built');
  assert.deepEqual(r1.rows.map((r) => r.client_id), ['c1']);
  clock.advance(1_500);
  const r2 = await search('ישראל');
  assert.equal(r2.source, 'hit');
  assert.equal(r2.version, 1);
  assert.deepEqual(r2.rows.map((r) => r.client_id), ['c2']);
  clock.advance(1_500);
  const r3 = await search('5155');
  assert.equal(r3.source, 'hit');
  assert.deepEqual(r3.rows.map((r) => r.client_id), ['c3']);
  assert.equal(builds, 1, 'three different q values ⇒ one materialization');

  clock.advance(CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS);
  const r4 = await search('alp');
  assert.equal(r4.source, 'built');
  assert.equal(r4.version, 2);
  assert.equal(builds, 2);
});

test('TTL is ~10s (5–15s window) and the cache is bounded', () => {
  assert.ok(CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS >= 5_000);
  assert.ok(CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS <= 15_000);
  assert.ok(CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES > 0);
  assert.ok(CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES <= 1_000);
});

test('different period / filters / org / capability NEVER reuse a materialization', async () => {
  const cache = new BoundedTtlCache<Materialization>({ ttlMs: 10_000, maxEntries: 50 });
  let builds = 0;
  const build = async (): Promise<Materialization> => ({ built_rows: makeRows(), version: ++builds });
  const run = (input: Parameters<typeof buildClientOperationsRegistryMaterializationCacheKey>[0]) =>
    cache.getOrBuild(buildClientOperationsRegistryMaterializationCacheKey(input), build);

  assert.equal((await run(baseKeyInput())).source, 'built');
  assert.equal((await run(baseKeyInput())).source, 'hit');
  assert.equal((await run(baseKeyInput({ selectedPeriodKey: '2026-08' }))).source, 'built');
  assert.equal(
    (await run(baseKeyInput({ filters: { ...noFilters(), business_type: 'company' } }))).source,
    'built',
  );
  assert.equal((await run(baseKeyInput({ organizationId: 'org-B' }))).source, 'built');
  assert.equal((await run(baseKeyInput({ canEditRegistry: false }))).source, 'built');
  assert.equal((await run(baseKeyInput({ defaultPeriodKey: '2026-10' }))).source, 'built');
  assert.equal(builds, 6);
});

test('tenant isolation: org B never sees org A rows; invalidating org A leaves org B intact', async () => {
  clearClientOperationsRegistryMaterializationCacheForTests();
  const cache = clientOperationsRegistryMaterializationCache;
  const keyA = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ organizationId: 'org-A' }));
  const keyB = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ organizationId: 'org-B' }));
  const fake = (tag: string) =>
    ({ built_rows: [{ client_id: tag, client_name: tag, cells: {} }] }) as unknown as NonNullable<
      ReturnType<typeof cache.peek>
    >;
  const a = await cache.getOrBuild(keyA, async () => fake('A-row'));
  const b = await cache.getOrBuild(keyB, async () => fake('B-row'));
  assert.equal(a.source, 'built');
  assert.equal(b.source, 'built');
  assert.equal((cache.peek(keyB) as unknown as Materialization).built_rows[0]!.client_id, 'B-row');
  assert.equal(invalidateClientOperationsRegistryMaterializationCache('org-A'), 1);
  assert.equal(cache.peek(keyA), undefined);
  assert.equal((cache.peek(keyB) as unknown as Materialization).built_rows[0]!.client_id, 'B-row');
  assert.equal(invalidateClientOperationsRegistryMaterializationCache(''), 0);
  assert.equal(invalidateClientOperationsRegistryMaterializationCache(null), 0);
  clearClientOperationsRegistryMaterializationCacheForTests();
});

test('mutation safety: invalidate ⇒ next GET rebuilds; build started before a write is never stored', async () => {
  clearClientOperationsRegistryMaterializationCacheForTests();
  const cache = clientOperationsRegistryMaterializationCache;
  const key = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput({ organizationId: 'org-M' }));
  let builds = 0;
  const build = async () =>
    ({ built_rows: [], version: ++builds }) as unknown as NonNullable<ReturnType<typeof cache.peek>>;
  await cache.getOrBuild(key, build);
  assert.equal((await cache.getOrBuild(key, build)).source, 'hit');
  invalidateClientOperationsRegistryMaterializationCache('org-M');
  assert.equal((await cache.getOrBuild(key, build)).source, 'built');
  assert.equal(builds, 2);

  // Concurrent write while a GET is materializing: the in-flight result is returned but not kept.
  invalidateClientOperationsRegistryMaterializationCache('org-M');
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const pending = cache.getOrBuild(key, async () => {
    await gate;
    return build();
  });
  invalidateClientOperationsRegistryMaterializationCache('org-M');
  release!();
  await pending;
  assert.equal(cache.peek(key), undefined);
  clearClientOperationsRegistryMaterializationCacheForTests();
});

test('concurrent identical GETs coalesce into a single materialization build', async () => {
  const cache = new BoundedTtlCache<Materialization>({ ttlMs: 10_000, maxEntries: 50 });
  let builds = 0;
  const key = buildClientOperationsRegistryMaterializationCacheKey(baseKeyInput());
  const build = async (): Promise<Materialization> => {
    builds += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { built_rows: makeRows(), version: builds };
  };
  const results = await Promise.all([
    cache.getOrBuild(key, build),
    cache.getOrBuild(key, build),
    cache.getOrBuild(key, build),
  ]);
  assert.equal(builds, 1);
  assert.deepEqual(
    results.map((r) => r.source).sort(),
    ['built', 'coalesced', 'coalesced'],
  );
});

// ---------------------------------------------------------------------------
// Search semantics — identical function on cached canonical rows
// ---------------------------------------------------------------------------

test('search equivalence: q on cached rows === q on freshly built rows (same function, same input)', () => {
  const fresh = makeRows();
  const cached = makeRows(); // structurally identical canonical rows (what the cache holds)
  for (const q of ['alp', 'ALPHA LTD', 'ישראל', '5123', '512345678', 'PCN', 'מקדמות', '30/11/2026', 'zzz', '']) {
    assert.deepEqual(
      applyRegistryQueryToRows(cached, { q }),
      applyRegistryQueryToRows(fresh, { q }),
      `q=${JSON.stringify(q)}`,
    );
  }
});

test('search semantics preserved: full/partial name, Hebrew, tax id, PCN, notes, date, no match', () => {
  const rows = makeRows();
  const ids = (q: string) => applyRegistryQueryToRows(rows, { q }).map((r) => r.client_id);
  assert.deepEqual(ids('Alpha Ltd'), ['c1']); // full name
  assert.deepEqual(ids('alp'), ['c1']); // partial, case-insensitive
  assert.deepEqual(ids('ALPHA'), ['c1']);
  assert.deepEqual(ids('ישראל'), ['c2']); // Hebrew display string
  assert.deepEqual(ids('512345678'), ['c1']); // tax id full (ת.ז. / ח.פ. rendered cell)
  assert.deepEqual(ids('5123'), ['c1']); // tax id partial
  assert.deepEqual(ids('pcn'), ['c1']); // PCN rendered cell
  assert.deepEqual(ids('מקדמות'), ['c2']); // notes cell
  assert.deepEqual(ids('30/11/2026'), ['c3']); // operational date display
  assert.deepEqual(ids('11/2026'), ['c3']);
  assert.deepEqual(ids('no-such-client'), []); // no matches
  assert.deepEqual(ids('   '), ['c1', 'c2', 'c3']); // blank q ⇒ all rows (trimmed)
});

test('search semantics preserved: custom column cells are searchable on cached rows', () => {
  const rows = makeRows().map((r) =>
    mergeCustomCellsIntoRow(
      r,
      [{ key: 'user_slot_1', id: 'col-1', data_type: 'text' }],
      new Map([[`${r.client_id}:col-1`, { value_text: r.client_id === 'c3' ? 'סניף חיפה' : null }]]),
    ),
  );
  assert.deepEqual(
    applyRegistryQueryToRows(rows, { q: 'חיפה' }).map((r) => r.client_id),
    ['c3'],
  );
});

test('search semantics preserved: manual rows — pre-search values map + searchQ applied per request', () => {
  const valuesBySlotColumn = new Map<string, string>([
    ['1:client_name', 'הערה ידנית'],
    ['2:notes', 'follow up March'],
  ]);
  const columnKeys = ['folder', 'client_name', 'notes'];
  const all = materializeClientOperationsManualRows({ columnKeys, valuesBySlotColumn, searchQ: null });
  assert.equal(all.length, 5);
  const heb = materializeClientOperationsManualRows({ columnKeys, valuesBySlotColumn, searchQ: 'ידנית' });
  assert.deepEqual(heb.map((r) => r.manual_row_slot), [1]);
  const eng = materializeClientOperationsManualRows({ columnKeys, valuesBySlotColumn, searchQ: 'MARCH' });
  assert.deepEqual(eng.map((r) => r.manual_row_slot), [2]);
  const none = materializeClientOperationsManualRows({ columnKeys, valuesBySlotColumn, searchQ: 'zzz' });
  assert.deepEqual(none, []);
  // Same values map reused for different q ⇒ same results as a fresh load would give.
  assert.deepEqual(
    materializeClientOperationsManualRows({ columnKeys, valuesBySlotColumn: new Map(valuesBySlotColumn), searchQ: 'ידנית' }),
    heb,
  );
});

test('q + business filters = AND (filters pre-materialization, q post-materialization)', () => {
  const facets = (business_type: ClientOperationsRegistryRowFilterFacets['business_type']) =>
    ({
      operational_reporting: 'not_reported',
      operational_reporting_participating_columns: ['vat'],
      material: 'not_received',
      payroll: 'no_payroll',
      reporting_types: [],
      business_type,
      handler_user_id: null,
    }) satisfies ClientOperationsRegistryRowFilterFacets;
  const seeds = [
    { row: makeRows()[0]!, facets: facets('company') },
    { row: makeRows()[1]!, facets: facets('osek_murshe') },
    { row: makeRows()[2]!, facets: facets('company') },
  ];
  const active = { ...noFilters(), business_type: 'company' };
  const preSearchRows = seeds
    .filter((s) => rowMatchesClientOperationsBusinessFilters(s.facets, active))
    .map((s) => s.row);
  assert.deepEqual(preSearchRows.map((r) => r.client_id), ['c1', 'c3']);
  assert.deepEqual(applyRegistryQueryToRows(preSearchRows, { q: 'beta' }).map((r) => r.client_id), ['c3']);
  assert.deepEqual(applyRegistryQueryToRows(preSearchRows, { q: 'ישראל' }), []);
});

test('sort is post-materialization too (same cached rows, different sort_by/sort_dir)', () => {
  const rows = makeRows();
  const asc = applyRegistryQueryToRows(rows, { sort_by: 'client_name', sort_dir: 'asc' }).map((r) => r.client_id);
  const desc = applyRegistryQueryToRows(rows, { sort_by: 'client_name', sort_dir: 'desc' }).map((r) => r.client_id);
  assert.deepEqual([...asc].reverse(), desc);
  assert.deepEqual(rows.map((r) => r.client_id), ['c1', 'c2', 'c3'], 'cached rows are not mutated by sort');
});

// ---------------------------------------------------------------------------
// Source contracts — pipeline order, route opt-in, commands bypass + invalidate
// ---------------------------------------------------------------------------

test('service: tenant + RBAC + period + filters resolved BEFORE cache lookup; q applied AFTER', () => {
  const list = serviceSource.slice(
    serviceSource.indexOf('export async function listClientOperationsRegistry('),
    serviceSource.indexOf('async function buildClientOperationsRegistryPreSearchMaterialization('),
  );
  const idx = (re: RegExp) => {
    const m = re.exec(list);
    assert.ok(m, `expected ${re}`);
    return m!.index;
  };
  const org = idx(/const orgId = assertOrg\(ctx\)/);
  const accessScope = idx(/resolveClientOperationsWorkspaceScopeFromContext\(ctx/);
  const period = idx(/resolveRegistryOperationalPeriodKey\(query\.operational_period_key\)/);
  const rbac = idx(/client_operations\.edit/);
  const filters = idx(/normalizeClientOperationsRegistryBusinessFilterQuery\(query\)/);
  const cacheLookup = idx(/clientOperationsRegistryMaterializationCache\.getOrBuild\(/);
  const search = idx(/applyRegistryQueryToRows\(materialization\.built_rows, \{ q, sort_by, sort_dir \}\)/);
  const manual = idx(/materializeClientOperationsManualRows\(\{[\s\S]*?searchQ: q/);
  assert.ok(
    org < cacheLookup &&
      accessScope < cacheLookup &&
      period < cacheLookup &&
      rbac < cacheLookup &&
      filters < cacheLookup,
  );
  assert.ok(cacheLookup < search && cacheLookup < manual);
  // Same aggregate contract (query echo + allowed_actions per request, never cached).
  assert.match(list, /query:\s*registryQueryEcho\(/);
  assert.match(list, /selectedPeriodKey/);
  assert.match(list, /allowed_actions: buildRegistryAllowedActions\(ctx\)/);
  assert.match(list, /materialization_cache_hit/);
});

test('service: cache key derives from every pre-search dimension; opt-in flag defaults to bypass', () => {
  assert.match(
    serviceSource,
    /buildClientOperationsRegistryMaterializationCacheKey\(\{\s*organizationId: orgId,\s*accessScopeKey: materializationAccess\.access_scope_key,\s*selectedPeriodKey,\s*defaultPeriodKey,\s*canEditRegistry,\s*filters: filterActive,\s*\}\)/,
  );
  assert.match(serviceSource, /if \(options\?\.materializationCache === true\)/);
  assert.match(serviceSource, /materializationSource = 'bypass'/);
});

test('service: manual rows keep one pipeline (values pre-search, materialize with searchQ)', () => {
  assert.match(serviceSource, /loadManualRowValuesBySlotColumnForRegistryAggregate\(/);
  assert.match(serviceSource, /manual_rows = anyBusinessFilter\s*\?\s*\[\]/);
  assert.match(manualRowsSource, /export async function loadManualRowValuesBySlotColumnForRegistryAggregate/);
  // Existing wrapper still composes the same two steps (no duplicated row building).
  const wrapper = manualRowsSource.slice(
    manualRowsSource.indexOf('export async function buildManualRowsForRegistryAggregate'),
    manualRowsSource.indexOf('export async function buildManualRowsPeriodSetupForAggregate'),
  );
  assert.match(wrapper, /loadManualRowValuesBySlotColumnForRegistryAggregate\(/);
  assert.match(wrapper, /materializeClientOperationsManualRows\(/);
});

test('route: GET /registry opts into the materialization cache; write requests invalidate org scope', () => {
  const get = routesSource.slice(
    routesSource.indexOf("router.get('/registry'"),
    routesSource.indexOf("router.post('/registry/commands'"),
  );
  assert.match(get, /\{ materializationCache: true \}/);
  assert.match(routesSource, /if \(req\.method === 'GET' \|\| req\.method === 'HEAD' \|\| req\.method === 'OPTIONS'\) return next\(\)/);
  assert.match(routesSource, /invalidateClientOperationsRegistryMaterializationCache\(orgId\);\s*res\.on\('finish'/);
  // Auth / org / module / permission middleware precede the route (never cached).
  assert.match(routesSource, /clientOperationsModuleRouter\.use\(authMiddleware, requireOrg, requireModuleActive\(MODULE_CODE\), router\)/);
  assert.match(routesSource, /router\.get\('\/registry', \.\.\.withView/);
});

test('commands: never read the cache, invalidate, and return a freshly built full aggregate', () => {
  assert.match(customColumnsSource, /invalidateClientOperationsRegistryMaterializationCache\(orgId\)/);
  assert.match(customColumnsSource, /return listClientOperationsRegistry\(ctx, responseQuery\);/);
  assert.doesNotMatch(customColumnsSource, /materializationCache: true/);
  assert.match(notesSource, /invalidateClientOperationsRegistryMaterializationCache\(ctx\.organizationId\)/);
  assert.match(notesSource, /listClientOperationsRegistry\(ctx, \{\}\)/);
  assert.doesNotMatch(notesSource, /materializationCache: true/);
  // Other read models keep building fresh truth (no opt-in outside GET /registry).
  assert.doesNotMatch(workEngineClientsTabSource, /materializationCache/);
});

test('no second source of truth: no separate search endpoint, no FE business filtering', () => {
  assert.doesNotMatch(routesSource, /router\.get\('\/registry\/search'/);
  assert.equal((routesSource.match(/router\.get\('\/registry'/g) ?? []).length, 1);
  const page = read('../../../web/src/pages/ClientOperationsRegistry.tsx');
  const view = read('../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx');
  assert.doesNotMatch(page, /rows\.filter\s*\(/);
  assert.doesNotMatch(view, /rows\.filter\s*\(/);
});
