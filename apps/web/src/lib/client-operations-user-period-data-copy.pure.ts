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
