import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveRegistryCommandApplyDecision,
  resolveRegistryCommandRequestedPeriod,
} from '../src/lib/client-operations-registry-command-apply.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('command query uses body period, then viewed tab, then React query', () => {
  assert.equal(
    resolveRegistryCommandRequestedPeriod({
      bodyPeriodKey: '2026-09',
      viewedPeriodKey: '2026-10',
      queryPeriodKey: '2026-11',
    }),
    '2026-09',
  );
  assert.equal(
    resolveRegistryCommandRequestedPeriod({
      bodyPeriodKey: '',
      viewedPeriodKey: '2026-10',
      queryPeriodKey: '2026-11',
    }),
    '2026-10',
  );
  assert.equal(
    resolveRegistryCommandRequestedPeriod({
      bodyPeriodKey: null,
      viewedPeriodKey: null,
      queryPeriodKey: '2026-11',
    }),
    '2026-11',
  );
});

test('matching refreshed aggregate paints the viewed period', () => {
  assert.deepEqual(
    resolveRegistryCommandApplyDecision({
      applyAggregate: true,
      requireApplied: true,
      appliedToView: true,
      requestedPeriodKey: '2026-09',
      responsePeriodKey: '2026-09',
      viewedPeriodKey: '2026-09',
    }),
    { ok: true, reason: 'applied_to_view' },
  );
});

test('tab switch after a successful write caches the requested period and does not error', () => {
  assert.deepEqual(
    resolveRegistryCommandApplyDecision({
      applyAggregate: true,
      requireApplied: true,
      appliedToView: false,
      requestedPeriodKey: '2026-09',
      responsePeriodKey: '2026-09',
      viewedPeriodKey: '2026-10',
    }),
    { ok: true, reason: 'cached_off_view' },
  );
});

test('wrong-period refreshed aggregate stays an error and is not painted', () => {
  assert.deepEqual(
    resolveRegistryCommandApplyDecision({
      applyAggregate: true,
      requireApplied: true,
      appliedToView: false,
      requestedPeriodKey: '2026-09',
      responsePeriodKey: '2026-11',
      viewedPeriodKey: '2026-09',
    }),
    { ok: false, reason: 'period_mismatch' },
  );
});

test('missing period identity on the refreshed aggregate stays an error', () => {
  assert.deepEqual(
    resolveRegistryCommandApplyDecision({
      applyAggregate: true,
      requireApplied: true,
      appliedToView: false,
      requestedPeriodKey: '2026-09',
      responsePeriodKey: null,
      viewedPeriodKey: '2026-09',
    }),
    { ok: false, reason: 'missing_period' },
  );
});

test('registry command path binds the request to the viewed period and keeps the paint guard', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /resolveRegistryCommandRequestedPeriod/);
  assert.match(page, /viewedPeriodKeyRef\.current/);
  assert.match(page, /resolveRegistryCommandApplyDecision/);
  assert.match(page, /AGGREGATE_NOT_APPLIED/);
  assert.match(page, /shouldApplyPeriodAggregateResponse/);
  assert.doesNotMatch(page, /allowUnresolvedBootstrap:\s*true[\s\S]*onRegistryCommand/);
});
