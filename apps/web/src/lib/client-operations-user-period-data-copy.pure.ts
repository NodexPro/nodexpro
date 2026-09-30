/**
 * Client Operations — user period data copy UX helpers (presentation only).
 * Backend owns copy truth; FE only builds menu choices + conflict dialog mode.
 */

const EMPTY_DISPLAY = new Set(['', '—', '–', '-', '־', '\u00a0', '\u200b']);

function isMeaningfulManualCellValue(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  if (EMPTY_DISPLAY.has(trimmed)) return false;
  return true;
}

export type UserPeriodDataCopyMode = 'empty_only' | 'replace_existing';

export function sourcePeriodsForUserPeriodDataCopy(
  availablePeriods: readonly string[],
  targetPeriodKey: string,
): string[] {
  const target = String(targetPeriodKey ?? '').trim();
  return [...availablePeriods]
    .map((p) => String(p ?? '').trim())
    .filter((p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p) && p !== target)
    .sort((a, b) => b.localeCompare(a));
}

export function targetPeriodHasConflictingUserEnteredData(input: {
  customCellTexts: readonly string[];
  manualCellTexts: readonly string[];
}): boolean {
  for (const text of input.customCellTexts) {
    if (String(text ?? '').trim()) return true;
  }
  for (const text of input.manualCellTexts) {
    if (isMeaningfulManualCellValue(text)) return true;
  }
  return false;
}

export function buildCopyUserPeriodDataCommandBody(input: {
  sourcePeriodKey: string;
  targetPeriodKey: string;
  mode: UserPeriodDataCopyMode;
  query: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    command: 'copy_client_operations_user_period_data',
    source_operational_period_key: input.sourcePeriodKey,
    target_operational_period_key: input.targetPeriodKey,
    operational_period_key: input.targetPeriodKey,
    mode: input.mode,
    query: {
      ...input.query,
      operational_period_key: input.targetPeriodKey,
    },
  };
}

/**
 * Clamp a fixed-position context menu into the viewport.
 * Prefer keeping the pointer-adjacent corner visible; flip left/up when needed.
 */
export function clampClientOperationsContextMenuPosition(input: {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  /** When true (RTL), prefer opening leftward from the pointer when space allows. */
  rtl?: boolean;
}): { left: number; top: number } {
  const margin = input.margin ?? 8;
  const width = Math.max(0, input.menuWidth);
  const height = Math.max(0, input.menuHeight);
  const vw = Math.max(0, input.viewportWidth);
  const vh = Math.max(0, input.viewportHeight);

  let left = input.rtl ? input.x - width : input.x;
  let top = input.y;

  if (left + width > vw - margin) {
    left = Math.max(margin, vw - width - margin);
  }
  if (left < margin) left = margin;

  if (top + height > vh - margin) {
    top = Math.max(margin, vh - height - margin);
  }
  if (top < margin) top = margin;

  return { left, top };
}
