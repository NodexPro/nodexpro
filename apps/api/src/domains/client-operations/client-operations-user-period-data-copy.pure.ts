/**
 * Client Operations — explicit user-entered period data copy (pure).
 * Custom-column period values + manual-row cell values only.
 * No system/operational facts. No automatic tab-switch inheritance.
 */

import { isMeaningfulTypedValue, type PeriodTypedValue } from './client-operations-user-columns-periods.pure.js';
import {
  formatClientOperationsManualRowSlot,
  isClientOperationsManualFreeTextColumnKey,
  isMeaningfulManualCellValue,
  type ClientOperationsManualRowSlot,
} from './client-operations-manual-rows.pure.js';

export type UserPeriodDataCopyMode = 'empty_only' | 'replace_existing';

export function parseUserPeriodDataCopyMode(raw: unknown): UserPeriodDataCopyMode {
  const mode = typeof raw === 'string' ? raw.trim() : '';
  if (mode === 'empty_only' || mode === 'replace_existing') return mode;
  throw new Error('mode must be empty_only | replace_existing');
}

/** Source must have meaningful value; EMPTY_ONLY never overwrites meaningful target. */
export function shouldCopyUserEnteredValue(input: {
  mode: UserPeriodDataCopyMode;
  sourceMeaningful: boolean;
  targetMeaningful: boolean;
}): boolean {
  if (!input.sourceMeaningful) return false;
  if (input.mode === 'empty_only') return !input.targetMeaningful;
  return true;
}

export type CustomColumnPeriodValueRow = {
  client_id: string;
  column_id: string;
} & PeriodTypedValue;

export type PlannedCustomColumnPeriodCopy = {
  client_id: string;
  column_id: string;
  values: PeriodTypedValue;
};

export function planCustomColumnPeriodValueCopies(input: {
  mode: UserPeriodDataCopyMode;
  sourceRows: readonly CustomColumnPeriodValueRow[];
  targetRows: readonly CustomColumnPeriodValueRow[];
  /** Active custom column ids eligible for copy (org-owned definitions). */
  eligibleColumnIds: ReadonlySet<string>;
}): PlannedCustomColumnPeriodCopy[] {
  const targetByKey = new Map<string, PeriodTypedValue>();
  for (const row of input.targetRows) {
    targetByKey.set(`${row.client_id}:${row.column_id}`, {
      value_text: row.value_text,
      value_number: row.value_number,
      value_date: row.value_date,
      value_bool: row.value_bool,
    });
  }

  const out: PlannedCustomColumnPeriodCopy[] = [];
  for (const row of input.sourceRows) {
    const columnId = String(row.column_id ?? '').trim();
    const clientId = String(row.client_id ?? '').trim();
    if (!columnId || !clientId) continue;
    if (!input.eligibleColumnIds.has(columnId)) continue;
    const sourceValues: PeriodTypedValue = {
      value_text: row.value_text,
      value_number: row.value_number,
      value_date: row.value_date,
      value_bool: row.value_bool,
    };
    const targetValues = targetByKey.get(`${clientId}:${columnId}`);
    if (
      !shouldCopyUserEnteredValue({
        mode: input.mode,
        sourceMeaningful: isMeaningfulTypedValue(sourceValues),
        targetMeaningful: isMeaningfulTypedValue(targetValues),
      })
    ) {
      continue;
    }
    out.push({ client_id: clientId, column_id: columnId, values: sourceValues });
  }
  return out;
}

export type ManualRowPeriodValueRow = {
  slot: number;
  column_key: string;
  value_text: string;
};

export type PlannedManualRowPeriodCopy = {
  slot: ClientOperationsManualRowSlot;
  column_key: string;
  value_text: string;
};

export function planManualRowPeriodValueCopies(input: {
  mode: UserPeriodDataCopyMode;
  sourceRows: readonly ManualRowPeriodValueRow[];
  targetRows: readonly ManualRowPeriodValueRow[];
}): PlannedManualRowPeriodCopy[] {
  const targetByKey = new Map<string, string>();
  for (const row of input.targetRows) {
    const key = `${row.slot}:${row.column_key}`;
    targetByKey.set(key, row.value_text);
  }

  const out: PlannedManualRowPeriodCopy[] = [];
  for (const row of input.sourceRows) {
    let slot: ClientOperationsManualRowSlot;
    try {
      slot = formatClientOperationsManualRowSlot(row.slot);
    } catch {
      continue;
    }
    const columnKey = String(row.column_key ?? '').trim();
    if (!isClientOperationsManualFreeTextColumnKey(columnKey)) continue;
    const sourceText = String(row.value_text ?? '');
    const targetText = targetByKey.get(`${slot}:${columnKey}`) ?? '';
    if (
      !shouldCopyUserEnteredValue({
        mode: input.mode,
        sourceMeaningful: isMeaningfulManualCellValue(sourceText),
        targetMeaningful: isMeaningfulManualCellValue(targetText),
      })
    ) {
      continue;
    }
    out.push({ slot, column_key: columnKey, value_text: sourceText.trim() });
  }
  return out;
}

/** UX helper: target already has meaningful user-entered custom/manual content. */
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

/** Source month choices for copy menu — exclude current target. */
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

/**
 * Canonical aggregate list: distinct YYYY-MM periods that contain meaningful
 * user-entered custom and/or manual values. Newest first (copy-menu order).
 */
export function buildUserPeriodDataCopySourcePeriods(input: {
  customPeriodKeys: readonly string[];
  manualPeriodKeys: readonly string[];
}): string[] {
  const set = new Set<string>();
  for (const key of [...input.customPeriodKeys, ...input.manualPeriodKeys]) {
    const trimmed = String(key ?? '').trim();
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) set.add(trimmed);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}
