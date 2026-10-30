/**
 * Client Operations — presentation helper for multi-select filter UI state.
 * Matching / allowed ids stay on the backend aggregate contract.
 */

const ALL = 'all';

export function parseClientOperationsMultiSelectCsv(
  current: string | null | undefined,
): string[] {
  return String(current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== ALL);
}

/** Empty / `all` → null (no restriction). Specific ids are sorted for stable query/cache keys. */
export function toggleClientOperationsMultiSelectCsv(
  current: string | null | undefined,
  optionId: string,
): string | null {
  const id = String(optionId ?? '').trim();
  if (!id || id === ALL) return null;
  const selected = parseClientOperationsMultiSelectCsv(current);
  const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  if (next.length === 0) return null;
  return [...next].sort().join(',');
}

export function clientOperationsMultiSelectTriggerLabel(
  labelHe: string,
  allLabelHe: string,
  selectedIds: string[],
): string {
  if (selectedIds.length === 0) return allLabelHe;
  return `${labelHe} (${selectedIds.length})`;
}

export function isClientOperationsMultiSelectAll(current: string | null | undefined): boolean {
  return parseClientOperationsMultiSelectCsv(current).length === 0;
}
