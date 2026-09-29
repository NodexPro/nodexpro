/**
 * Period aggregate presentation cache (not business truth).
 * Cache key MUST include period + search + business filters so filtered and
 * unfiltered aggregates never collide.
 */

export type PeriodAggregateCacheEntry<T> = {
  aggregate: T;
  cachedAtMs: number;
};

export type ClientOperationsRegistryCacheQuery = {
  q?: string | null;
  filter_operational_reporting?: string | null;
  filter_material?: string | null;
  filter_payroll?: string | null;
  filter_reporting_type?: string | null;
  filter_business_type?: string | null;
  filter_handler?: string | null;
};

/** Stable cache key: period + search + all business filters. */
export function buildClientOperationsRegistryCacheKey(
  periodKey: string,
  query?: ClientOperationsRegistryCacheQuery | null,
): string {
  const period = String(periodKey ?? '').trim();
  if (!period) return '';
  const norm = (v: string | null | undefined) => String(v ?? '').trim();
  return [
    period,
    norm(query?.q),
    norm(query?.filter_operational_reporting),
    norm(query?.filter_material),
    norm(query?.filter_payroll),
    norm(query?.filter_reporting_type),
    norm(query?.filter_business_type),
    norm(query?.filter_handler),
  ].join('\u001f');
}

export function hasActiveClientOperationsBusinessFilters(
  query?: ClientOperationsRegistryCacheQuery | null,
): boolean {
  return Boolean(
    String(query?.filter_operational_reporting ?? '').trim() ||
      String(query?.filter_material ?? '').trim() ||
      String(query?.filter_payroll ?? '').trim() ||
      String(query?.filter_reporting_type ?? '').trim() ||
      String(query?.filter_business_type ?? '').trim() ||
      String(query?.filter_handler ?? '').trim(),
  );
}

export function putPeriodAggregateCache<T>(
  cache: Map<string, PeriodAggregateCacheEntry<T>>,
  periodKey: string,
  aggregate: T,
  query?: ClientOperationsRegistryCacheQuery | null,
): void {
  const key = buildClientOperationsRegistryCacheKey(periodKey, query);
  if (!key) return;
  cache.set(key, { aggregate, cachedAtMs: Date.now() });
}

export function getPeriodAggregateCache<T>(
  cache: Map<string, PeriodAggregateCacheEntry<T>>,
  periodKey: string,
  query?: ClientOperationsRegistryCacheQuery | null,
): T | null {
  const key = buildClientOperationsRegistryCacheKey(periodKey, query);
  if (!key) return null;
  return cache.get(key)?.aggregate ?? null;
}

/** Adjacent periods for quiet prefetch (±1 month around selected, within available). */
export function selectPeriodPrefetchKeys(input: {
  selectedPeriodKey: string;
  availablePeriods: string[];
  max?: number;
}): string[] {
  const available = [...new Set(input.availablePeriods.filter(Boolean))].sort();
  const selected = String(input.selectedPeriodKey ?? '').trim();
  if (!selected || !available.length) return [];
  const idx = available.indexOf(selected);
  const max = input.max ?? 4;
  const out: string[] = [];
  if (idx >= 0) {
    for (const offset of [-1, 1, -2, 2]) {
      const next = available[idx + offset];
      if (next && next !== selected) out.push(next);
      if (out.length >= max) break;
    }
  } else {
    for (const key of available) {
      if (key === selected) continue;
      out.push(key);
      if (out.length >= max) break;
    }
  }
  return out;
}

export function shouldApplyPeriodAggregateResponse(input: {
  responsePeriodKey: string | null | undefined;
  viewedPeriodKey: string | null | undefined;
}): boolean {
  const response = String(input.responsePeriodKey ?? '').trim();
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!response || !viewed) return false;
  return response === viewed;
}
