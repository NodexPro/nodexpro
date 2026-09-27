/**
 * Period aggregate presentation cache (not business truth).
 * Keys = operational_period_key; values = full backend aggregates.
 */

export type PeriodAggregateCacheEntry<T> = {
  aggregate: T;
  cachedAtMs: number;
};

export function putPeriodAggregateCache<T>(
  cache: Map<string, PeriodAggregateCacheEntry<T>>,
  periodKey: string,
  aggregate: T,
): void {
  const key = String(periodKey ?? '').trim();
  if (!key) return;
  cache.set(key, { aggregate, cachedAtMs: Date.now() });
}

export function getPeriodAggregateCache<T>(
  cache: Map<string, PeriodAggregateCacheEntry<T>>,
  periodKey: string,
): T | null {
  const key = String(periodKey ?? '').trim();
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
