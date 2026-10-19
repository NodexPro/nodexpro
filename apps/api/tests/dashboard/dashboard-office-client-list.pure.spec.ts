import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paginateNamedRows,
  parseOfficeClientListKey,
  selectOfficeClientList,
} from '../../src/domains/dashboard/dashboard-office-client-list.pure.js';
import type { DashboardFeeClientInput } from '../../src/domains/dashboard/dashboard-office-fees.pure.js';

function client(partial: Partial<DashboardFeeClientInput> & { id: string }): DashboardFeeClientInput {
  return {
    display_name: partial.display_name ?? partial.id,
    status: partial.status ?? 'active',
    is_archived: partial.is_archived ?? false,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    ended_at: partial.ended_at ?? null,
    ...partial,
  };
}

const periodStart = '2026-10-01';
const periodEnd = '2026-10-31';

const roster: DashboardFeeClientInput[] = [
  client({ id: 'active-1', status: 'active', created_at: '2025-01-01T00:00:00.000Z' }),
  client({ id: 'pending-1', status: 'pending', created_at: '2025-01-01T00:00:00.000Z' }),
  client({ id: 'inactive-1', status: 'inactive', created_at: '2025-01-01T00:00:00.000Z' }),
  client({ id: 'archived-1', status: 'active', is_archived: true, created_at: '2025-01-01T00:00:00.000Z' }),
  client({ id: 'new-1', status: 'active', created_at: '2026-10-12T08:00:00.000Z' }),
  client({ id: 'departed-1', status: 'inactive', created_at: '2025-01-01T00:00:00.000Z', ended_at: '2026-10-08T00:00:00.000Z' }),
  client({ id: 'fee-expired-not-departed', status: 'active', created_at: '2025-01-01T00:00:00.000Z', ended_at: null }),
];

test('parseOfficeClientListKey accepts only canonical Dashboard list keys', () => {
  assert.equal(parseOfficeClientListKey('active'), 'active');
  assert.equal(parseOfficeClientListKey('new_in_period'), 'new_in_period');
  assert.equal(parseOfficeClientListKey('departed'), 'departed');
  assert.equal(parseOfficeClientListKey('status:pending'), 'status:pending');
  assert.equal(parseOfficeClientListKey('fee_expired'), null);
  assert.equal(parseOfficeClientListKey('all'), null);
});

test('active list is current Core active clients, not the selected period', () => {
  const ids = selectOfficeClientList(roster, 'active', periodStart, periodEnd).map((c) => c.id).sort();
  assert.deepEqual(ids, ['active-1', 'fee-expired-not-departed', 'new-1']);
});

test('new-in-period uses created_at inside the selected window', () => {
  const ids = selectOfficeClientList(roster, 'new_in_period', periodStart, periodEnd).map((c) => c.id);
  assert.deepEqual(ids, ['new-1']);
});

test('departed uses Core ended_at and does not treat a live fee-bearing client as churn', () => {
  const ids = selectOfficeClientList(roster, 'departed', periodStart, periodEnd).map((c) => c.id);
  assert.deepEqual(ids, ['departed-1']);
  assert.equal(ids.includes('fee-expired-not-departed'), false);
});

test('status lists stay on canonical Core status and archived is separate', () => {
  assert.deepEqual(
    selectOfficeClientList(roster, 'status:pending', periodStart, periodEnd).map((c) => c.id),
    ['pending-1'],
  );
  assert.deepEqual(
    selectOfficeClientList(roster, 'status:archived', periodStart, periodEnd).map((c) => c.id),
    ['archived-1'],
  );
  assert.equal(
    selectOfficeClientList(roster, 'status:active', periodStart, periodEnd).some((c) => c.is_archived),
    false,
  );
});

test('paginateNamedRows searches and pages on the server-owned list, not a second client fetch', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `c${String(i).padStart(2, '0')}`,
    display_name: i === 7 ? 'Alpha Office' : `Client ${i}`,
  }));
  const page1 = paginateNamedRows(rows, { page: 1, page_size: 25 });
  assert.equal(page1.total, 30);
  assert.equal(page1.total_pages, 2);
  assert.equal(page1.rows.length, 25);
  const found = paginateNamedRows(rows, { q: 'alpha' });
  assert.equal(found.total, 1);
  assert.equal(found.rows[0]?.id, 'c07');
});
