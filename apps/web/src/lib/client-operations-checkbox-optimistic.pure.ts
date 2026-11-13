/**
 * Presentation-only overlay for Client Operations material checkboxes.
 * Not business truth: the named command aggregate remains authoritative.
 */

export type OptimisticCheckboxEntry = {
  markKey: string;
  periodKey: string;
  value: boolean;
  seq: number;
};

export function checkboxOptimisticMarkKey(
  clientId: string,
  kind: string,
  periodKey: string,
): string {
  return `${String(clientId ?? '').trim()}:${String(kind ?? '').trim()}:${String(periodKey ?? '').trim()}`;
}

export function resolveOptimisticCheckboxChecked(input: {
  aggregateChecked: boolean;
  entry: OptimisticCheckboxEntry | undefined;
  viewedPeriodKey: string;
}): boolean {
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!input.entry || !viewed || input.entry.periodKey !== viewed) {
    return Boolean(input.aggregateChecked);
  }
  return input.entry.value;
}

export function canStartOptimisticCheckboxCommand(
  pendingKeys: ReadonlySet<string>,
  markKey: string,
): boolean {
  return Boolean(markKey) && !pendingKeys.has(markKey);
}

export function beginOptimisticCheckbox(
  map: Map<string, OptimisticCheckboxEntry>,
  input: { markKey: string; periodKey: string; value: boolean },
): OptimisticCheckboxEntry | null {
  const markKey = String(input.markKey ?? '').trim();
  const periodKey = String(input.periodKey ?? '').trim();
  if (!markKey || !periodKey) return null;
  const prev = map.get(markKey);
  const entry: OptimisticCheckboxEntry = {
    markKey,
    periodKey,
    value: Boolean(input.value),
    seq: (prev?.seq ?? 0) + 1,
  };
  map.set(markKey, entry);
  return entry;
}

export function shouldClearOptimisticCheckboxAfterSuccess(input: {
  entry: OptimisticCheckboxEntry | undefined;
  seq: number;
}): boolean {
  return Boolean(input.entry) && input.entry!.seq === input.seq;
}

export function revertOptimisticCheckbox(
  map: Map<string, OptimisticCheckboxEntry>,
  markKey: string,
  seq: number,
): boolean {
  const entry = map.get(markKey);
  if (!entry || entry.seq !== seq) return false;
  map.delete(markKey);
  return true;
}

export function dropOptimisticCheckboxesForOtherPeriod(
  map: Map<string, OptimisticCheckboxEntry>,
  viewedPeriodKey: string,
): boolean {
  const viewed = String(viewedPeriodKey ?? '').trim();
  let changed = false;
  for (const [key, entry] of map) {
    if (!viewed || entry.periodKey !== viewed) {
      map.delete(key);
      changed = true;
    }
  }
  return changed;
}

export function reconcileOptimisticCheckboxWithAggregate(input: {
  entry: OptimisticCheckboxEntry | undefined;
  viewedPeriodKey: string;
  aggregateChecked: boolean;
}): 'use-optimistic' | 'use-aggregate' {
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!input.entry || !viewed || input.entry.periodKey !== viewed) return 'use-aggregate';
  return 'use-optimistic';
}
