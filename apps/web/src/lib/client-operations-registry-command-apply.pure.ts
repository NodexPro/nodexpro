/**
 * Registry command refresh vs the currently viewed operational period.
 *
 * Paint must never show another period. A successful write whose refreshed
 * aggregate belongs to the requested period is still success when the user
 * has already switched tabs — that aggregate is cached, not painted.
 */

export type RegistryCommandApplyDecision =
  | { ok: true; reason: 'applied_to_view' | 'cached_off_view' | 'apply_skipped' }
  | { ok: false; reason: 'missing_period' | 'period_mismatch' };

export function resolveRegistryCommandApplyDecision(input: {
  applyAggregate: boolean;
  requireApplied: boolean;
  appliedToView: boolean;
  requestedPeriodKey: string | null | undefined;
  responsePeriodKey: string | null | undefined;
  viewedPeriodKey: string | null | undefined;
}): RegistryCommandApplyDecision {
  if (input.applyAggregate === false) {
    return { ok: true, reason: 'apply_skipped' };
  }
  if (input.appliedToView) {
    return { ok: true, reason: 'applied_to_view' };
  }
  if (!input.requireApplied) {
    return { ok: true, reason: 'cached_off_view' };
  }
  const requested = String(input.requestedPeriodKey ?? '').trim();
  const response = String(input.responsePeriodKey ?? '').trim();
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!response || !requested) {
    return { ok: false, reason: 'missing_period' };
  }
  if (response !== requested) {
    return { ok: false, reason: 'period_mismatch' };
  }
  if (viewed && response !== viewed) {
    return { ok: true, reason: 'cached_off_view' };
  }
  return { ok: false, reason: 'period_mismatch' };
}

export function resolveRegistryCommandRequestedPeriod(input: {
  bodyPeriodKey?: unknown;
  viewedPeriodKey?: string | null;
  queryPeriodKey?: string | null;
}): string | null {
  if (typeof input.bodyPeriodKey === 'string' && input.bodyPeriodKey.trim()) {
    return input.bodyPeriodKey.trim();
  }
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (viewed) return viewed;
  const query = String(input.queryPeriodKey ?? '').trim();
  return query || null;
}
