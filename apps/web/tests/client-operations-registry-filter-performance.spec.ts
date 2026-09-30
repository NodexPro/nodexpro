/**
 * Client Operations — filter performance UX (immediate onChange, quiet load, no debounce).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientOperationsRegistryCacheKey,
  getPeriodAggregateCache,
  hasActiveClientOperationsBusinessFilters,
  putPeriodAggregateCache,
  shouldPrefetchAdjacentPeriods,
  type PeriodAggregateCacheEntry,
} from '../src/lib/client-operations-period-aggregate-cache.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const cacheSource = readFileSync(
  join(dir, '../src/lib/client-operations-period-aggregate-cache.pure.ts'),
  'utf8',
);

test('1 dropdown onChange immediately starts aggregate request (no Apply / Enter)', () => {
  assert.match(viewSource, /onChange=\{\(e\) => applyBusinessFilterChange\(def\.id, e\.target\.value\)\}/);
  assert.match(viewSource, /applyBusinessFilterChange[\s\S]*onQueryChange\(/);
  assert.doesNotMatch(viewSource, /החל סינון|סינון עכשיו/);
  assert.doesNotMatch(viewSource, /nx-co-sheet__filter-bar[\s\S]{0,1200}\bApply\b/);
  assert.doesNotMatch(viewSource, /onKeyDown[\s\S]{0,80}filter/);
  assert.doesNotMatch(viewSource, /nx-co-sheet__filter-bar[\s\S]{0,800}type=["']submit["']/);
});

test('2 no filter debounce on dropdowns', () => {
  // Search keeps debounce; business filter path must not.
  assert.match(viewSource, /searchDebounceRef\.current = setTimeout\(\(\) => \{\s*applyLiveSearch/);
  assert.doesNotMatch(
    viewSource,
    /applyBusinessFilterChange[\s\S]{0,400}setTimeout/,
  );
  assert.doesNotMatch(viewSource, /filterDebounce|FILTER_DEBOUNCE/);
});

test('3 selected value updates immediately from query (optimistic)', () => {
  assert.match(viewSource, /Optimistic selection from query/);
  assert.match(viewSource, /fromQueryOrAll\(query\.filter_business_type\)/);
  assert.match(viewSource, /value=\{selected\}/);
  // Must not wait exclusively on filters.active for controlled value.
  assert.match(viewSource, /Never wait for filters\.active/);
});

test('4 quiet load — table remains visible; no blocking page loader for filters', () => {
  assert.match(viewSource, /applyBusinessFilterChange[\s\S]*\{ quiet: true \}/);
  assert.match(pageSource, /onQueryChange[\s\S]*preferCache:\s*false/);
  assert.match(pageSource, /if \(!options\?\.quiet\) setLoading\(true\)/);
  // Filter path must not wipe the whole period cache (keyed by period+search+filters).
  assert.doesNotMatch(
    pageSource,
    /onQueryChange[\s\S]{0,500}periodCacheRef\.current\.clear\(\)/,
  );
});

test('5 second filter change aborts/supersedes; loadSeq guard; stale cannot paint', () => {
  assert.match(pageSource, /loadAbortRef\.current\?\.abort\(\)/);
  assert.match(pageSource, /new AbortController\(\)/);
  assert.match(pageSource, /const seq = \+\+loadSeqRef\.current/);
  assert.match(pageSource, /if \(seq !== loadSeqRef\.current\)/);
  assert.match(pageSource, /Do NOT cache — stale/);
});

test('6 one selection = one aggregate request; no adjacent prefetch while filters active', () => {
  // Guard is the pure policy (filters OR active search) — see shouldPrefetchAdjacentPeriods.
  assert.match(pageSource, /if \(!shouldPrefetchAdjacentPeriods\(baseQuery\)\) return/);
  assert.match(pageSource, /never fan-out adjacent-period prefetches/);
  assert.equal(shouldPrefetchAdjacentPeriods({ filter_material: 'not_received' }), false);
  assert.equal(shouldPrefetchAdjacentPeriods({}), true);
});

test('7 no frontend business rows.filter matching', () => {
  assert.doesNotMatch(viewSource, /rows\.filter\s*\(/);
  assert.doesNotMatch(pageSource, /rows\.filter\s*\(/);
  assert.doesNotMatch(viewSource, /filter_facets/);
});

test('8 search debounce remains 120ms; filters do not inherit it', () => {
  assert.match(viewSource, /applyLiveSearch\(value\);\s*\}, 120\)/);
  assert.match(viewSource, /applyBusinessFilterChange/);
  assert.doesNotMatch(
    viewSource,
    /applyBusinessFilterChange[\s\S]{0,500},\s*120\s*\)/,
  );
});

test('9 cache key includes period + search + all filters; no mix filtered/unfiltered', () => {
  assert.match(cacheSource, /buildClientOperationsRegistryCacheKey/);
  const cache = new Map<string, PeriodAggregateCacheEntry<{ id: string }>>();
  putPeriodAggregateCache(cache, '2026-09', { id: 'unfiltered' }, {});
  putPeriodAggregateCache(
    cache,
    '2026-09',
    { id: 'company' },
    { filter_business_type: 'company' },
  );
  assert.equal(getPeriodAggregateCache(cache, '2026-09', {})?.id, 'unfiltered');
  assert.equal(
    getPeriodAggregateCache(cache, '2026-09', { filter_business_type: 'company' })?.id,
    'company',
  );
  assert.notEqual(
    buildClientOperationsRegistryCacheKey('2026-09', {}),
    buildClientOperationsRegistryCacheKey('2026-09', { filter_business_type: 'company' }),
  );
  assert.equal(
    hasActiveClientOperationsBusinessFilters({ filter_material: 'not_received' }),
    true,
  );
  assert.equal(hasActiveClientOperationsBusinessFilters({ q: 'abc' }), false);
});

test('10 clear filters + manual-row policy remain backend-owned via quiet reload', () => {
  assert.match(viewSource, /clearBusinessFilters/);
  assert.match(viewSource, /filter_business_type: null/);
  assert.match(pageSource, /shouldApplyPeriodAggregateResponse|viewedPeriodKeyRef/);
});

test('11 filter select not disabled by loading', () => {
  assert.match(viewSource, /disabled=\{!onQueryChange\}/);
  assert.doesNotMatch(viewSource, /disabled=\{!onQueryChange \|\| loading\}/);
  assert.doesNotMatch(viewSource, /filter-select[\s\S]{0,80}disabled=\{[^}]*loading/);
});
