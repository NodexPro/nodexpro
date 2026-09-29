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

/** Explicit period identity from a registry/command aggregate (no row inference). */
export function resolveRegistryAggregatePeriodKey(
  data:
    | {
        period?: { selected_period_key?: string | null } | null;
        query?: { operational_period_key?: string | null } | null;
      }
    | null
    | undefined,
): string | null {
  const fromPeriod = String(data?.period?.selected_period_key ?? '').trim();
  if (fromPeriod) return fromPeriod;
  const fromQuery = String(data?.query?.operational_period_key ?? '').trim();
  return fromQuery || null;
}

/**
 * Paint guard for registry aggregates.
 *
 * Default (explicit view): response paints only when it has an explicit period
 * that equals the currently viewed/selected period. Missing either ⇒ reject.
 *
 * Initial unresolved bootstrap (`allowUnresolvedBootstrap: true`):
 * when viewed is still null/empty (fresh entry with operational_period_key=null),
 * a response with explicit selected period may establish that period as the view.
 * Do NOT enable this for commands, prefetch, or quiet stale paths.
 */
export function shouldApplyPeriodAggregateResponse(input: {
  responsePeriodKey: string | null | undefined;
  viewedPeriodKey: string | null | undefined;
  /** Only the initial registry GET with unresolved viewed period may set this. */
  allowUnresolvedBootstrap?: boolean;
}): boolean {
  const response = String(input.responsePeriodKey ?? '').trim();
  if (!response) return false;
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!viewed) {
    return input.allowUnresolvedBootstrap === true;
  }
  return response === viewed;
}

/** Prefetch may cache under requested key only when response confirms that period. */
export function shouldCachePrefetchAggregate(input: {
  requestedPeriodKey: string;
  responsePeriodKey: string | null | undefined;
}): boolean {
  const requested = String(input.requestedPeriodKey ?? '').trim();
  const response = String(input.responsePeriodKey ?? '').trim();
  if (!requested || !response) return false;
  return requested === response;
}

/**
 * Period-bound rows render only when the aggregate currently painted matches
 * the selected tab. Otherwise show a period-safe transition state.
 */
export function canRenderPeriodBoundRows(input: {
  selectedPeriodKey: string | null | undefined;
  renderedAggregatePeriodKey: string | null | undefined;
}): boolean {
  const selected = String(input.selectedPeriodKey ?? '').trim();
  const rendered = String(input.renderedAggregatePeriodKey ?? '').trim();
  if (!selected || !rendered) return false;
  return selected === rendered;
}
