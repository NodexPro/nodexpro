/**
 * Client Operations — user Excel columns × operational periods (pure).
 * No I/O. Backend owns eligibility / inheritance / blank display.
 */

export type PeriodTypedValue = {
  value_text: string | null;
  value_number: number | string | null;
  value_date: string | null;
  value_bool: boolean | null;
};

export function isMeaningfulTypedValue(value: PeriodTypedValue | null | undefined): boolean {
  if (!value) return false;
  if (value.value_text != null && String(value.value_text).trim() !== '') return true;
  if (value.value_number != null && value.value_number !== '') return true;
  if (value.value_date != null && String(value.value_date).trim() !== '') return true;
  if (value.value_bool === true || value.value_bool === false) return true;
  return false;
}

/** Empty user custom cells render blank — never em dash. */
export function formatUserCustomCellDisplayHe(
  dataType: 'text' | 'number' | 'date' | 'boolean',
  value: PeriodTypedValue | null | undefined,
): string {
  if (!isMeaningfulTypedValue(value)) return '';
  if (dataType === 'boolean') return value!.value_bool ? 'כן' : 'לא';
  if (dataType === 'number') {
    const n = typeof value!.value_number === 'number' ? value!.value_number : Number(value!.value_number);
    if (!Number.isFinite(n)) return '';
    return new Intl.NumberFormat('he-IL').format(n);
  }
  if (dataType === 'date') {
    const raw = String(value!.value_date ?? '');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return raw;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return String(value!.value_text ?? '').trim();
}

export function mergeUserCustomCellsIntoRowPeriodAware<T extends { client_id: string; cells: Record<string, string> }>(
  row: T,
  columns: Array<{ id: string; key: string; data_type: 'text' | 'number' | 'date' | 'boolean' }>,
  valuesByClientAndColumn: Map<string, PeriodTypedValue>,
): T {
  const cells = { ...row.cells };
  for (const column of columns) {
    const value = valuesByClientAndColumn.get(`${row.client_id}:${column.id}`);
    cells[column.key] = formatUserCustomCellDisplayHe(column.data_type, value);
  }
  return { ...row, cells };
}

export function shouldPrecheckAutoExtend(input: {
  auto_extend_to_future: boolean;
  auto_extend_from_period_key: string | null | undefined;
  operational_period_key: string;
}): boolean {
  if (!input.auto_extend_to_future) return false;
  const from = String(input.auto_extend_from_period_key ?? '').trim();
  if (!from) return false;
  return input.operational_period_key >= from;
}

/** Latest earlier period key among candidates strictly before target. */
export function latestEarlierPeriodKey(
  targetPeriodKey: string,
  candidatePeriodKeys: readonly string[],
): string | null {
  let best: string | null = null;
  for (const key of candidatePeriodKeys) {
    if (key < targetPeriodKey && (best === null || key > best)) best = key;
  }
  return best;
}

export type EligibleUserColumnForPeriodSetup = {
  column_id: string;
  label: string;
  key: string;
  preselected: boolean;
};

export function buildEligibleUserColumnsForPeriodSetup(input: {
  columns: Array<{
    id: string;
    key: string;
    label: string;
    auto_extend_to_future: boolean;
    auto_extend_from_period_key: string | null;
    has_meaningful_prior_data: boolean;
    legacy_baseline_completed: boolean;
  }>;
  operational_period_key: string;
}): EligibleUserColumnForPeriodSetup[] {
  const out: EligibleUserColumnForPeriodSetup[] = [];
  for (const column of input.columns) {
    if (!column.has_meaningful_prior_data) continue;
    // Legacy meaningful data must be baselined before period setup can offer the column.
    if (!column.legacy_baseline_completed && column.has_meaningful_prior_data) {
      // Still eligible only after baseline; skip until completed.
      // Caller sets has_meaningful_prior_data from period values OR (legacy meaningful AND baselined).
      continue;
    }
    out.push({
      column_id: column.id,
      label: String(column.label ?? '').trim() || column.key,
      key: column.key,
      preselected: shouldPrecheckAutoExtend({
        auto_extend_to_future: column.auto_extend_to_future,
        auto_extend_from_period_key: column.auto_extend_from_period_key,
        operational_period_key: input.operational_period_key,
      }),
    });
  }
  return out;
}

/**
 * Eligibility uses backend-provided has_meaningful_prior_data already filtered.
 * This helper only applies preselect + label shaping for columns already marked eligible.
 */
export function mapEligibleColumnsForPeriodSetupDialog(input: {
  eligible: Array<{
    id: string;
    key: string;
    label: string;
    auto_extend_to_future: boolean;
    auto_extend_from_period_key: string | null;
  }>;
  operational_period_key: string;
}): EligibleUserColumnForPeriodSetup[] {
  return input.eligible.map((column) => ({
    column_id: column.id,
    label: String(column.label ?? '').trim() || column.key,
    key: column.key,
    preselected: shouldPrecheckAutoExtend({
      auto_extend_to_future: column.auto_extend_to_future,
      auto_extend_from_period_key: column.auto_extend_from_period_key,
      operational_period_key: input.operational_period_key,
    }),
  }));
}
