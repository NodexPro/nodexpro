/**
 * Client Operations — search performance (frontend side).
 * Adjacent-period prefetch is skipped while a free-text search is active and resumes when q is
 * empty. Existing period guards (renderedAggregatePeriodKey, loadSeq, AbortController, bootstrap,
 * cache-miss skeleton, response-period guards), the 120ms debounce and the מחפש... pending
 * indicator are untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasActiveClientOperationsBusinessFilters,
  shouldPrefetchAdjacentPeriods,
} from '../src/lib/client-operations-period-aggregate-cache.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

test('prefetch skipped while normalized effective q is non-empty', () => {
  assert.equal(shouldPrefetchAdjacentPeriods({ q: 'abc' }), false);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: 'ישראל' }), false);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: '  5123  ' }), false);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: 'a' }), false);
});

test('prefetch resumes when q is empty / whitespace / null and no business filter is active', () => {
  assert.equal(shouldPrefetchAdjacentPeriods({ q: '' }), true);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: '   ' }), true);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: null }), true);
  assert.equal(shouldPrefetchAdjacentPeriods({}), true);
  assert.equal(shouldPrefetchAdjacentPeriods(null), true);
  assert.equal(shouldPrefetchAdjacentPeriods(undefined), true);
});

test('existing business-filter prefetch rule preserved (filters still block prefetch; q alone is not a filter)', () => {
  assert.equal(shouldPrefetchAdjacentPeriods({ q: '', filter_business_type: 'company' }), false);
  assert.equal(shouldPrefetchAdjacentPeriods({ q: 'x', filter_business_type: 'company' }), false);
  assert.equal(hasActiveClientOperationsBusinessFilters({ q: 'x' }), false);
});

test('page: prefetchPeriods guards on the pure policy before any adjacent GET', () => {
  const prefetch = pageSource.slice(
    pageSource.indexOf('const prefetchPeriods = useCallback('),
    pageSource.indexOf('const loadRegistry = useCallback('),
  );
  assert.match(prefetch, /if \(!shouldPrefetchAdjacentPeriods\(baseQuery\)\) return;/);
  const guardIdx = prefetch.indexOf('shouldPrefetchAdjacentPeriods(baseQuery)');
  const getIdx = prefetch.indexOf('apiJson<RegistryAggregate>(');
  assert.ok(guardIdx > 0 && getIdx > guardIdx, 'guard precedes the prefetch GET');
  // Prefetch still passes the same base query (q included) — no FE-side query shaping.
  assert.match(prefetch, /moduleClientOperationsRegistry\(\{ \.\.\.baseQuery, operational_period_key: key \}\)/);
});

test('page: period / load guards untouched', () => {
  assert.match(pageSource, /const \[renderedAggregatePeriodKey, setRenderedAggregatePeriodKey\] = useState<string \| null>\(null\)/);
  assert.match(pageSource, /const seq = \+\+loadSeqRef\.current/);
  assert.match(pageSource, /loadAbortRef\.current\?\.abort\(\)/);
  assert.match(pageSource, /new AbortController\(\)/);
  assert.match(pageSource, /allowUnresolvedBootstrap: !periodKey/);
  assert.match(pageSource, /Cache miss: never leave previous-period rows under the new tab/);
  assert.match(pageSource, /clearPeriodBoundPresentation\(\)/);
  assert.match(pageSource, /shouldApplyPeriodAggregateResponse\(\{/);
  assert.match(pageSource, /shouldCachePrefetchAggregate\(\{/);
  assert.match(pageSource, /if \(!selected \|\| viewedPeriodKeyRef\.current !== selected\) return;/);
});

test('search pending spinner מחפש... and 120ms debounce preserved', () => {
  assert.match(viewSource, /מחפש\.\.\./);
  assert.match(viewSource, /applyLiveSearch\(value\);\s*\}, 120\)/);
  assert.match(viewSource, /const searchBusy = searchDebouncePending \|\| searchPending;/);
  assert.match(pageSource, /if \(\(next\.q \?\? null\) !== \(query\.q \?\? null\)\) setQueryRefreshPending\(true\);/);
  assert.match(pageSource, /searchPending=\{queryRefreshPending\}/);
});
