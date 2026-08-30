/**
 * P4.4 — Performance closure validation.
 * Does not duplicate P4.1/P4.2/P4.3 suites; anchors their coverage + CDM slow-aggregate wiring.
 *
 * P4 CLOSED means:
 * - CDM populations bounded/paginated honestly
 * - documents-by-type year filtered in DB
 * - WE queue global summary/catalog no silent 5000 cap
 * - slow aggregate diagnostics cover hot aggregates (incl. CDM)
 * - focused regression tests pass
 *
 * NO AGGREGATE CACHE REQUIRED FOR P4 CLOSURE.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  emitSlowAggregateWarning,
  slowAggregateThresholdMs,
} from '../../src/shared/observability.js';
import { logAggregatePayloadBreakdown } from '../../src/shared/aggregate-payload-metrics.js';
import { INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY } from '../../src/domains/income/income.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(dir, '../..');

const p41Spec = join(
  apiRoot,
  'tests/income/income-client-document-management-p41-pagination.spec.ts',
);
const p42Spec = join(
  apiRoot,
  'tests/work-engine/work-engine-invoices-documents-by-type-p42-year-in-sql.spec.ts',
);
const p43Spec = join(
  apiRoot,
  'tests/work-engine/work-engine-queue-p43-exact-summary-catalog.spec.ts',
);

const cdmServiceSource = readFileSync(
  join(
    apiRoot,
    'src/domains/income/income-client-document-management-panel.service.ts',
  ),
  'utf8',
);
const cdmPureSource = readFileSync(
  join(apiRoot, 'src/domains/income/income-client-document-management-panel.pure.ts'),
  'utf8',
);
const byTypeSource = readFileSync(
  join(
    apiRoot,
    'src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const queueReadSource = readFileSync(
  join(apiRoot, 'src/domains/work-engine/work-engine.read-models.service.ts'),
  'utf8',
);
const queueExactSource = readFileSync(
  join(
    apiRoot,
    'src/domains/work-engine/work-engine-queue-summary-catalog.exact.ts',
  ),
  'utf8',
);
const observabilitySource = readFileSync(
  join(apiRoot, 'src/shared/observability.ts'),
  'utf8',
);
const metricsSource = readFileSync(
  join(apiRoot, 'src/shared/aggregate-payload-metrics.ts'),
  'utf8',
);

test('P4.4 — focused P4.1/P4.2/P4.3 regression suites exist (reuse, do not duplicate)', () => {
  assert.equal(existsSync(p41Spec), true);
  assert.equal(existsSync(p42Spec), true);
  assert.equal(existsSync(p43Spec), true);
  assert.match(readFileSync(p41Spec, 'utf8'), /has_more/);
  assert.match(readFileSync(p42Spec, 'utf8'), /filterCandidatesByYear/);
  assert.match(readFileSync(p43Spec, 'utf8'), /loadWorkItemCountsByStateExact/);
});

test('P4.4 — P4.1 anchors: bounded pagination + backend has_more + org scope', () => {
  assert.match(cdmPureSource, /CDM_POPULATION_DEFAULT_LIMIT\s*=\s*50/);
  assert.match(cdmPureSource, /CDM_POPULATION_MAX_LIMIT\s*=\s*100/);
  assert.match(cdmServiceSource, /takeCdmPopulationPage/);
  assert.match(cdmServiceSource, /page:\s*\{[\s\S]*has_more:/);
  assert.doesNotMatch(cdmServiceSource, /\.limit\(500\)/);
  assert.doesNotMatch(cdmServiceSource, /\.limit\(5000\)/);
  assert.match(cdmServiceSource, /\.eq\('organization_id',\s*orgId\)/);
});

test('P4.4 — P4.2 anchors: selectedYear in DB; no Node multi-year filter restore', () => {
  assert.match(byTypeSource, /\.gte\('issue_date',\s*startInclusive\)/);
  assert.match(byTypeSource, /\.lt\('issue_date',\s*endExclusive\)/);
  assert.match(byTypeSource, /\.gte\('updated_at',\s*startInclusive\)/);
  assert.doesNotMatch(byTypeSource, /function filterCandidatesByYear/);
  assert.match(byTypeSource, /\.eq\('organization_id',\s*params\.orgId\)/);
});

test('P4.4 — P4.3 anchors: exact state counts; catalogs page; row pagination unchanged', () => {
  assert.match(queueExactSource, /count: 'exact',\s*head: true/);
  assert.match(queueExactSource, /\.range\(from,\s*to\)/);
  assert.doesNotMatch(queueExactSource, /\.limit\(5000\)/);
  assert.match(queueReadSource, /loadWorkItemCountsByStateExact/);
  assert.match(queueReadSource, /loadWorkItemFilterCatalogDimensionsExact/);
  assert.match(queueReadSource, /\.range\(f\.offset,\s*f\.offset \+ f\.limit - 1\)/);
  assert.match(queueReadSource, /\.eq\('org_id',\s*orgId\)/);
});

test('P4.4 — CDM wires canonical logAggregatePayloadBreakdown + duration_ms', () => {
  assert.match(
    cdmServiceSource,
    /logAggregatePayloadBreakdown\(\s*INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY/,
  );
  assert.match(cdmServiceSource, /duration_ms:\s*Date\.now\(\) - aggregateStartMs/);
  assert.match(cdmServiceSource, /from '\.\.\/\.\.\/shared\/aggregate-payload-metrics\.js'/);
  // Stage console timing may remain; slow path must still use shared helper.
  assert.match(metricsSource, /emitSlowAggregateWarning/);
  assert.match(observabilitySource, /SLOW_AGGREGATE_THRESHOLD_MS/);
});

test('P4.4 — CDM slow-aggregate fires through canonical helper + shared threshold', () => {
  const lines: Array<{ prefix: string; payload: Record<string, unknown> }> = [];
  const originalWarn = console.warn;
  const originalInfo = console.info;
  console.warn = ((prefix: string, payload: Record<string, unknown>) => {
    lines.push({ prefix, payload });
  }) as typeof console.warn;
  console.info = (() => {}) as typeof console.info;
  try {
    const threshold = slowAggregateThresholdMs();
    assert.ok(threshold > 0);

    logAggregatePayloadBreakdown(
      INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
      { aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY, rows: [] },
      {
        correlation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        duration_ms: threshold - 1,
      },
    );
    assert.equal(lines.filter((l) => l.prefix === '[slow-aggregate]').length, 0);

    logAggregatePayloadBreakdown(
      INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
      { aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY, rows: [] },
      {
        correlation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        duration_ms: threshold + 25,
      },
    );
    const slow = lines.filter((l) => l.prefix === '[slow-aggregate]');
    assert.equal(slow.length, 1);
    assert.equal(slow[0].payload.aggregate_key, INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY);

    // Direct helper still uses same threshold (no second hardcoded threshold).
    lines.length = 0;
    emitSlowAggregateWarning({
      aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
      duration_ms: threshold + 1,
    });
    assert.equal(lines.length, 1);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
});

test('P4.4 — closure criteria: no aggregate cache required', () => {
  assert.doesNotMatch(cdmServiceSource, /redis|createClient\(|aggregateCache/i);
  assert.doesNotMatch(byTypeSource, /redis|aggregateCache/i);
  assert.doesNotMatch(queueExactSource, /redis|aggregateCache/i);
});
