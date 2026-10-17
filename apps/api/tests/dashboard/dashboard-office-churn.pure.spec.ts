import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientEndedInPeriod,
  clientOnBooksAtPeriodStart,
  monthActivePopulation,
  monthDepartedCount,
  monthNewCount,
  projectOfficeChurn,
} from '../../src/domains/dashboard/dashboard-office-churn.pure.js';
import type { DashboardFeeClientInput } from '../../src/domains/dashboard/dashboard-office-fees.pure.js';

function client(partial: Partial<DashboardFeeClientInput> = {}): DashboardFeeClientInput {
  return {
    id: 'c1',
    display_name: 'לקוח',
    status: 'active',
    is_archived: false,
    created_at: '2025-01-15T00:00:00.000Z',
    ended_at: null,
    ...partial,
  };
}

test('churn numerator uses ended_at inside the Jerusalem period, not inactive/archived flags', () => {
  const start = '2026-10-01';
  const end = '2026-10-31';
  assert.equal(
    clientEndedInPeriod(client({ ended_at: '2026-10-12T08:00:00.000Z' }), start, end),
    true,
  );
  assert.equal(clientEndedInPeriod(client({ status: 'inactive', ended_at: null }), start, end), false);
  assert.equal(clientEndedInPeriod(client({ is_archived: true, ended_at: null }), start, end), false);
  assert.equal(clientEndedInPeriod(client({ ended_at: '2026-09-30T20:00:00.000Z' }), start, end), false);
});

test('beginning-of-period population excludes clients created during the period and those already ended', () => {
  const start = '2026-10-01';
  assert.equal(clientOnBooksAtPeriodStart(client({ created_at: '2025-12-01T00:00:00.000Z' }), start), true);
  assert.equal(clientOnBooksAtPeriodStart(client({ created_at: '2026-10-02T00:00:00.000Z' }), start), false);
  assert.equal(
    clientOnBooksAtPeriodStart(
      client({ created_at: '2025-01-01T00:00:00.000Z', ended_at: '2026-09-15T00:00:00.000Z' }),
      start,
    ),
    false,
  );
  assert.equal(clientOnBooksAtPeriodStart(client({ created_at: null }), start), null);
});

test('churn percent is departed / population at start and is omitted when the denominator is missing or zero', () => {
  const start = '2026-10-01';
  const end = '2026-10-31';
  const ready = projectOfficeChurn(
    [
      client({ id: 'stay', created_at: '2025-01-01T00:00:00.000Z' }),
      client({ id: 'left', created_at: '2025-01-01T00:00:00.000Z', ended_at: '2026-10-08T00:00:00.000Z' }),
      client({ id: 'new', created_at: '2026-10-04T00:00:00.000Z' }),
    ],
    start,
    end,
  );
  assert.equal(ready.departed_count, 1);
  assert.equal(ready.population_at_start, 2);
  assert.equal(ready.churn_percent, 50);

  const missingHistory = projectOfficeChurn(
    [
      client({ id: 'left', created_at: null, ended_at: '2026-10-08T00:00:00.000Z' }),
      client({ id: 'stay', created_at: '2025-01-01T00:00:00.000Z' }),
    ],
    start,
    end,
  );
  assert.equal(missingHistory.departed_count, 1);
  assert.equal(missingHistory.population_established, false);
  assert.equal(missingHistory.churn_percent, null);

  const emptyDenom = projectOfficeChurn(
    [client({ id: 'only-new', created_at: '2026-10-02T00:00:00.000Z' })],
    start,
    end,
  );
  assert.equal(emptyDenom.population_at_start, 0);
  assert.equal(emptyDenom.churn_percent, null);
});

test('month growth uses Jerusalem bounds and does not keep leavers in the closing population', () => {
  const clients = [
    client({ id: 'old', created_at: '2025-01-01T00:00:00.000Z' }),
    client({ id: 'born', created_at: '2026-10-05T00:00:00.000Z' }),
    client({ id: 'left', created_at: '2025-01-01T00:00:00.000Z', ended_at: '2026-10-20T00:00:00.000Z' }),
  ];
  assert.equal(monthNewCount(clients, '2026-10-01', '2026-10-31'), 1);
  assert.equal(monthDepartedCount(clients, '2026-10-01', '2026-10-31'), 1);
  assert.equal(monthActivePopulation(clients, '2026-10-01', '2026-10-31'), 2);
  assert.equal(monthActivePopulation(clients, '2026-09-01', '2026-09-30'), 2);
});
