/**
 * Client Operations — period cache isolation + FE no dash-from-applicability.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientOperationsRegistryCacheKey,
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  selectPeriodPrefetchKeys,
  shouldApplyPeriodAggregateResponse,
  type PeriodAggregateCacheEntry,
} from '../src/lib/client-operations-period-aggregate-cache.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

test('08/09/10/11 unfiltered cache keys are distinct', () => {
  const periods = ['2026-08', '2026-09', '2026-10', '2026-11'];
  const cache = new Map<string, PeriodAggregateCacheEntry<{ period: string }>>();
  for (const p of periods) putPeriodAggregateCache(cache, p, { period: p }, {});
  for (const p of periods) {
    assert.equal(getPeriodAggregateCache(cache, p, {})?.period, p);
  }
  assert.equal(new Set(periods.map((p) => buildClientOperationsRegistryCacheKey(p, {}))).size, 4);
});

test('filtered cache cannot collide with unfiltered for same period', () => {
  const cache = new Map<string, PeriodAggregateCacheEntry<{ tag: string }>>();
  putPeriodAggregateCache(cache, '2026-09', { tag: 'all' }, {});
  putPeriodAggregateCache(
    cache,
    '2026-09',
    { tag: 'company' },
    { filter_business_type: 'company' },
  );
  assert.equal(getPeriodAggregateCache(cache, '2026-09', {})?.tag, 'all');
  assert.equal(
    getPeriodAggregateCache(cache, '2026-09', { filter_business_type: 'company' })?.tag,
    'company',
  );
});

test('stale period response cannot paint viewed period', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: '2026-09',
    }),
    false,
  );
});

test('prefetch targets adjacent keys; GET uses TARGET period', () => {
  assert.deepEqual(
    selectPeriodPrefetchKeys({
      selectedPeriodKey: '2026-09',
      availablePeriods: ['2026-08', '2026-09', '2026-10', '2026-11'],
      max: 2,
    }),
    ['2026-08', '2026-10'],
  );
  // Prefetch GETs go through workspace-aware registryUrl (Stage 4), not a bare
  // moduleClientOperationsRegistry spread — period key + workspace scope preserved.
  const prefetch = pageSource.slice(
    pageSource.indexOf('const prefetchPeriods = useCallback('),
    pageSource.indexOf('const loadRegistry = useCallback('),
  );
  assert.match(prefetch, /registryUrl\(\{[\s\S]*?operational_period_key:\s*key/);
  assert.match(prefetch, /workspace_scope:\s*baseQuery\.workspace_scope/);
  assert.match(prefetch, /workspace_subject_user_id:\s*baseQuery\.workspace_subject_user_id/);
  assert.match(pageSource, /appendClientOperationsWorkspaceQuery\(moduleClientOperationsRegistry\(params\)/);
});

test('FE does not blank configured labels via obligationApplicable', () => {
  assert.doesNotMatch(
    viewSource,
    /if \(applicable === false\)[\s\S]{0,200}nx-co-sheet__na[\s\S]{0,80}—/,
  );
});
