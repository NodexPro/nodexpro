/**
 * CO registry default order: created-this-period last; next month alphabetical.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRegistryQueryToRows,
  compareRegistryRowsForOperationalPeriod,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.ts';

function row(input: { id: string; name: string; created_at: string | null }) {
  return {
    client_id: input.id,
    client_name: input.name,
    created_at: input.created_at,
    cells: { client_name: input.name },
  };
}

const alef = row({ id: 'a', name: 'אלון', created_at: '2026-09-02T08:00:00.000Z' });
const bet = row({ id: 'b', name: 'בניה', created_at: '2026-09-10T08:00:00.000Z' });
const newEarly = row({ id: 'n1', name: 'אביב', created_at: '2026-10-03T08:00:00.000Z' });
const newLate = row({ id: 'n2', name: 'אהוד', created_at: '2026-10-20T08:00:00.000Z' });

test('creation-month clients sort after earlier clients, newest last', () => {
  const october = applyRegistryQueryToRows([newLate, alef, newEarly, bet], {
    operational_period_key: '2026-10',
  }).map((r) => r.client_id);
  assert.deepEqual(october, ['a', 'b', 'n1', 'n2']);
});

test('next month the same clients join Hebrew alphabetical order', () => {
  const november = applyRegistryQueryToRows([newLate, alef, newEarly, bet], {
    operational_period_key: '2026-11',
  }).map((r) => r.client_id);
  assert.deepEqual(november, ['n1', 'n2', 'a', 'b']);
});

test('explicit column sort still wins over creation-month order', () => {
  const names = applyRegistryQueryToRows([newLate, alef, newEarly, bet], {
    operational_period_key: '2026-10',
    sort_by: 'client_name',
    sort_dir: 'asc',
  }).map((r) => r.client_id);
  assert.deepEqual(names, ['n1', 'n2', 'a', 'b']);
});

test('tie-breaker is client_id when created_at matches', () => {
  const same = row({ id: 'z', name: 'אלון', created_at: '2026-09-02T08:00:00.000Z' });
  const cmp = compareRegistryRowsForOperationalPeriod(alef, same, '2026-10');
  assert.ok(cmp < 0);
});
