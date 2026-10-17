import { isoToJerusalemDate } from './dashboard-office-period.pure.js';
import type { DashboardFeeClientInput } from './dashboard-office-fees.pure.js';

export type OfficeChurnProjection = {
  departed_count: number;
  population_at_start: number | null;
  population_established: boolean;
  churn_percent: number | null;
  departed_client_ids: string[];
};

/**
 * Office-service end date is `clients.ended_at` (UI: תאריך סיום טיפול).
 * Inactive/archived without an end date in the period is not churn.
 */
export function clientEndedInPeriod(
  client: DashboardFeeClientInput,
  periodStart: string,
  periodEnd: string,
): boolean {
  const ended = isoToJerusalemDate(client.ended_at);
  return ended != null && ended >= periodStart && ended <= periodEnd;
}

/**
 * On the books at period start: opened before the period and not ended before it.
 * Returns null when created_at is missing so the denominator cannot be trusted.
 */
export function clientOnBooksAtPeriodStart(
  client: DashboardFeeClientInput,
  periodStart: string,
): boolean | null {
  const created = isoToJerusalemDate(client.created_at);
  if (!created) return null;
  if (created >= periodStart) return false;
  const ended = isoToJerusalemDate(client.ended_at);
  if (ended && ended < periodStart) return false;
  return true;
}

export function projectOfficeChurn(
  clients: DashboardFeeClientInput[],
  periodStart: string,
  periodEnd: string,
): OfficeChurnProjection {
  const departed_client_ids: string[] = [];
  let population = 0;
  let population_established = true;
  for (const client of clients) {
    if (clientEndedInPeriod(client, periodStart, periodEnd)) {
      departed_client_ids.push(client.id);
    }
    const onBooks = clientOnBooksAtPeriodStart(client, periodStart);
    if (onBooks == null) population_established = false;
    else if (onBooks) population += 1;
  }
  const departed_count = departed_client_ids.length;
  if (!population_established) {
    return {
      departed_count,
      population_at_start: null,
      population_established: false,
      churn_percent: null,
      departed_client_ids,
    };
  }
  if (population <= 0) {
    return {
      departed_count,
      population_at_start: 0,
      population_established: true,
      churn_percent: null,
      departed_client_ids,
    };
  }
  return {
    departed_count,
    population_at_start: population,
    population_established: true,
    churn_percent: Math.round((departed_count / population) * 10000) / 100,
    departed_client_ids,
  };
}

export function monthActivePopulation(
  clients: DashboardFeeClientInput[],
  monthStart: string,
  monthEnd: string,
): number {
  let n = 0;
  for (const client of clients) {
    const created = isoToJerusalemDate(client.created_at);
    if (!created || created > monthEnd) continue;
    const ended = isoToJerusalemDate(client.ended_at);
    if (ended && ended < monthStart) continue;
    if (ended && ended <= monthEnd && ended >= monthStart) {
      // Left during the month: not in the closing population.
      continue;
    }
    n += 1;
  }
  return n;
}

export function monthNewCount(
  clients: DashboardFeeClientInput[],
  monthStart: string,
  monthEnd: string,
): number {
  return clients.filter((c) => {
    const created = isoToJerusalemDate(c.created_at);
    return created != null && created >= monthStart && created <= monthEnd;
  }).length;
}

export function monthDepartedCount(
  clients: DashboardFeeClientInput[],
  monthStart: string,
  monthEnd: string,
): number {
  return clients.filter((c) => clientEndedInPeriod(c, monthStart, monthEnd)).length;
}
