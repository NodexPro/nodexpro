/**
 * Period switch consistency + current-working tab state (presentation contracts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canRenderPeriodBoundRows,
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  resolveRegistryAggregatePeriodKey,
  shouldApplyPeriodAggregateResponse,
  shouldCachePrefetchAggregate,
  type PeriodAggregateCacheEntry,
} from '../src/lib/client-operations-period-aggregate-cache.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('0 — INITIAL BOOTSTRAP: null viewed accepts backend selected period', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: null,
      allowUnresolvedBootstrap: true,
    }),
    true,
  );
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: null,
      allowUnresolvedBootstrap: false,
    }),
    false,
  );
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: null,
      viewedPeriodKey: null,
      allowUnresolvedBootstrap: true,
    }),
    false,
  );
  assert.equal(
    canRenderPeriodBoundRows({
      selectedPeriodKey: '2026-08',
      renderedAggregatePeriodKey: '2026-08',
    }),
    true,
  );
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /allowUnresolvedBootstrap:\s*!periodKey/);
  assert.match(page, /allowUnresolvedBootstrap/);
  // Commands must not pass bootstrap by default.
  assert.match(page, /applyAggregate\(data\)/);
});

test('1 — cache miss: selected B cannot keep A rows visible (contract)', () => {
  assert.equal(
    canRenderPeriodBoundRows({
      selectedPeriodKey: '2026-09',
      renderedAggregatePeriodKey: '2026-08',
    }),
    false,
  );
  assert.equal(
    canRenderPeriodBoundRows({
      selectedPeriodKey: '2026-09',
      renderedAggregatePeriodKey: null,
    }),
    false,
  );
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /canRenderPeriodBoundRows|renderedAggregatePeriodKey|periodContentPending/);
  assert.match(page, /setRows\(\[\]\)/);
  assert.match(page, /setManualRows\(\[\]\)/);
});

test('2 — cache hit path still uses preferCache + applyAggregate', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /preferCache:\s*true/);
  assert.match(page, /getPeriodAggregateCache/);
  assert.match(page, /applyAggregate\(cached/);
});

test('3 — rapid A→B→C→D: loadSeq drops superseded GETs', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /seq !== loadSeqRef\.current/);
  assert.match(page, /loadAbortRef\.current\?\.abort/);
});

test('4 — late A GET cannot paint B', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: '2026-09',
    }),
    false,
  );
});

test('5 — missing response period cannot paint', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: null,
      viewedPeriodKey: '2026-09',
    }),
    false,
  );
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '',
      viewedPeriodKey: '2026-09',
    }),
    false,
  );
});

test('6 — matching period may paint', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-11',
      viewedPeriodKey: '2026-11',
    }),
    true,
  );
});

test('7 — command aggregate missing period cannot paint (source contract)', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /shouldApplyPeriodAggregateResponse/);
  assert.match(page, /resolveRegistryAggregatePeriodKey/);
  // Guard must reject before setRows when period missing (no truthy-only short-circuit).
  assert.doesNotMatch(
    page,
    /if\s*\(\s*responsePeriod\s*&&\s*viewed\s*&&\s*!shouldApplyPeriodAggregateResponse/,
  );
});

test('8 — prefetch caches only when response period === requested', () => {
  assert.equal(
    shouldCachePrefetchAggregate({
      requestedPeriodKey: '2026-10',
      responsePeriodKey: '2026-10',
    }),
    true,
  );
  assert.equal(
    shouldCachePrefetchAggregate({
      requestedPeriodKey: '2026-10',
      responsePeriodKey: '2026-09',
    }),
    false,
  );
  assert.equal(
    shouldCachePrefetchAggregate({
      requestedPeriodKey: '2026-10',
      responsePeriodKey: null,
    }),
    false,
  );
});

test('9 — composite cache period+filters isolated', () => {
  const cache = new Map<string, PeriodAggregateCacheEntry<{ tag: string }>>();
  putPeriodAggregateCache(cache, '2026-08', { tag: 'a' }, { q: null });
  putPeriodAggregateCache(cache, '2026-09', { tag: 'b' }, { q: null });
  putPeriodAggregateCache(
    cache,
    '2026-09',
    { tag: 'b-filtered' },
    { filter_payroll: 'active', q: null },
  );
  assert.equal(getPeriodAggregateCache(cache, '2026-08', { q: null })?.tag, 'a');
  assert.equal(getPeriodAggregateCache(cache, '2026-09', { q: null })?.tag, 'b');
  assert.equal(
    getPeriodAggregateCache(cache, '2026-09', { filter_payroll: 'active', q: null })?.tag,
    'b-filtered',
  );
});

test('10 — resolveRegistryAggregatePeriodKey prefers period.selected then query', () => {
  assert.equal(
    resolveRegistryAggregatePeriodKey({
      period: { selected_period_key: '2026-08' },
      query: { operational_period_key: '2026-09' },
    }),
    '2026-08',
  );
  assert.equal(
    resolveRegistryAggregatePeriodKey({
      period: null,
      query: { operational_period_key: '2026-09' },
    }),
    '2026-09',
  );
  assert.equal(resolveRegistryAggregatePeriodKey({}), null);
});

test('11 — selected vs current-working tab states are independent', () => {
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  assert.match(tabs, /is-current-working-period/);
  assert.match(tabs, /is-active/);
  assert.match(tabs, /defaultPeriodKey/);
  assert.match(tabs, /selectedPeriodKey/);
  assert.doesNotMatch(tabs, /businessMonthKey|getMonth\(\)/);
  // Both classes can coexist independently (selected 11, current 08).
  assert.match(tabs, /key === defaultPeriodKey|key === selectedPeriodKey/);
});

test('12 — prefetch fan-out only after still-current applied load', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /prefetchPeriods/);
  assert.match(page, /shouldCachePrefetchAggregate/);
  // Prefetch after apply must re-check loadSeq / viewed period.
  assert.match(page, /viewedPeriodKeyRef\.current/);
});
