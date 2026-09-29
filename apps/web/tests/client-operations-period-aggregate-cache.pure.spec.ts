import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  selectPeriodPrefetchKeys,
  shouldApplyPeriodAggregateResponse,
  type PeriodAggregateCacheEntry,
} from '../src/lib/client-operations-period-aggregate-cache.pure.js';

test('period cache stores and returns full aggregates by key', () => {
  const cache = new Map<string, PeriodAggregateCacheEntry<{ rows: number }>>();
  putPeriodAggregateCache(cache, '2026-09', { rows: 2 });
  assert.deepEqual(getPeriodAggregateCache(cache, '2026-09'), { rows: 2 });
  assert.equal(getPeriodAggregateCache(cache, '2026-10'), null);
});

test('period cache key separates filtered vs unfiltered aggregates', () => {
  const cache = new Map<string, PeriodAggregateCacheEntry<{ tag: string }>>();
  putPeriodAggregateCache(cache, '2026-09', { tag: 'all' }, { q: null });
  putPeriodAggregateCache(
    cache,
    '2026-09',
    { tag: 'filtered' },
    { filter_business_type: 'company', q: null },
  );
  assert.equal(getPeriodAggregateCache(cache, '2026-09', { q: null })?.tag, 'all');
  assert.equal(
    getPeriodAggregateCache(cache, '2026-09', { filter_business_type: 'company' })?.tag,
    'filtered',
  );
});

test('prefetch selects adjacent available periods', () => {
  assert.deepEqual(
    selectPeriodPrefetchKeys({
      selectedPeriodKey: '2026-09',
      availablePeriods: ['2026-08', '2026-09', '2026-10', '2026-11'],
      max: 2,
    }),
    ['2026-08', '2026-10'],
  );
});

test('stale period aggregate cannot paint viewed period', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-09',
      viewedPeriodKey: '2026-10',
    }),
    false,
  );
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-10',
      viewedPeriodKey: '2026-10',
    }),
    true,
  );
});
