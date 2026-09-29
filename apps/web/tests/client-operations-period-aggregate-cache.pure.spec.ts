import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRenderPeriodBoundRows,
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  selectPeriodPrefetchKeys,
  shouldApplyPeriodAggregateResponse,
  shouldCachePrefetchAggregate,
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

test('INITIAL BOOTSTRAP: null viewed + explicit response period may paint only with flag', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: null,
    }),
    false,
  );
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
});

test('bootstrap flag does not weaken explicit mismatch', () => {
  assert.equal(
    shouldApplyPeriodAggregateResponse({
      responsePeriodKey: '2026-08',
      viewedPeriodKey: '2026-09',
      allowUnresolvedBootstrap: true,
    }),
    false,
  );
});

test('prefetch cache requires confirmed response period', () => {
  assert.equal(
    shouldCachePrefetchAggregate({
      requestedPeriodKey: '2026-08',
      responsePeriodKey: '2026-08',
    }),
    true,
  );
  assert.equal(
    shouldCachePrefetchAggregate({
      requestedPeriodKey: '2026-08',
      responsePeriodKey: '2026-09',
    }),
    false,
  );
});

test('period-bound rows require selected === rendered aggregate period', () => {
  assert.equal(
    canRenderPeriodBoundRows({
      selectedPeriodKey: '2026-11',
      renderedAggregatePeriodKey: '2026-11',
    }),
    true,
  );
  assert.equal(
    canRenderPeriodBoundRows({
      selectedPeriodKey: '2026-11',
      renderedAggregatePeriodKey: '2026-08',
    }),
    false,
  );
});
