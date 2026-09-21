/**
 * Country Pack Reporting Calendar — pure vocabulary (no I/O).
 * LEGAL OWNER: Country Pack / Owner Legal Control.
 * Runtime resolves ACTIVE stored filing_due_date only — never invents statutory day math.
 */

export const REPORTING_CALENDAR_AGGREGATE_KEY = 'country_reporting_calendar_aggregate' as const;

/** Stable obligation keys — never Hebrew labels. Matches migration 170. */
export const REPORTING_OBLIGATION_KEYS = [
  'vat_regular_income_tax_advances',
  'income_tax_deductions',
  'vat_detailed',
] as const;

export type ReportingObligationKey = (typeof REPORTING_OBLIGATION_KEYS)[number];

export type ReportingCalendarEntryStatus = 'draft' | 'active' | 'deprecated' | 'disabled';

export const REPORTING_OBLIGATION_LABELS_HE: Record<ReportingObligationKey, string> = {
  vat_regular_income_tax_advances: 'מע״מ רגיל + מקדמות מס הכנסה',
  income_tax_deductions: 'ניכויים מס הכנסה',
  vat_detailed: 'מע״מ מפורט',
};

/** client_tax_settings vocabulary */
export type ClientVatType = 'yes' | 'no' | 'patur';
export type ClientVatDueType = 'regular' | 'pcn' | 'not_relevant';
export type ClientVatFrequency = 'monthly' | 'bi_monthly' | 'not_relevant';

const PERIOD_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isReportingObligationKey(value: string): value is ReportingObligationKey {
  return (REPORTING_OBLIGATION_KEYS as readonly string[]).includes(value);
}

export function isReportingPeriodKey(value: string): boolean {
  return PERIOD_KEY_RE.test(value.trim());
}

export function parseReportingPeriodKey(value: string): { year: number; month: number } | null {
  const m = PERIOD_KEY_RE.exec(value.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function buildReportingPeriodKey(year: number, month: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('invalid_reporting_year');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('invalid_reporting_month');
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function reportingPeriodKeysForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => buildReportingPeriodKey(year, i + 1));
}

const HE_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
] as const;

export function hebrewMonthLabel(month: number): string {
  return HE_MONTHS[month - 1] ?? String(month);
}

/** Presentation only. */
export function formatFilingDueDateDisplay(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const s = isoDate.trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Map client VAT settings → calendar obligation key.
 * PCN = מע״מ מפורט = vat_detailed. Backend-owned — no frontend branching.
 */
export function resolveVatObligationKeyFromClientTaxSettings(input: {
  vat_type: ClientVatType | string | null | undefined;
  vat_due_type: ClientVatDueType | string | null | undefined;
}): ReportingObligationKey | null {
  const vatType = String(input.vat_type ?? '')
    .trim()
    .toLowerCase();
  const dueType = String(input.vat_due_type ?? '')
    .trim()
    .toLowerCase();
  if (vatType === 'patur' || vatType === 'no') return null;
  if (dueType === 'not_relevant' || dueType === '') return null;
  if (dueType === 'regular') return 'vat_regular_income_tax_advances';
  if (dueType === 'pcn') return 'vat_detailed';
  return null;
}

export function incomeTaxAdvancesObligationKey(): ReportingObligationKey {
  return 'vat_regular_income_tax_advances';
}

export function incomeTaxDeductionsObligationKey(): ReportingObligationKey {
  return 'income_tax_deductions';
}

export function isNationalInsuranceObligationKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return (
    k === 'national_insurance_deductions' ||
    k === 'ni_deductions' ||
    k === 'bituach_leumi_deductions'
  );
}

export type ReportingCalendarCellView = {
  obligation_key: ReportingObligationKey;
  label: string;
  entry_id: string | null;
  filing_due_date: string | null;
  filing_due_date_display: string | null;
  status: ReportingCalendarEntryStatus | 'missing';
  explanation_code: string | null;
  replaces_entry_id: string | null;
  is_runtime_legal_truth: boolean;
};

export type ReportingCalendarPeriodRowView = {
  reporting_period_key: string;
  period_label: string;
  year: number;
  month: number;
  cells: Record<ReportingObligationKey, ReportingCalendarCellView>;
  row_status: ReportingCalendarEntryStatus | 'mixed' | 'missing';
};

export function buildEmptyCalendarCell(obligationKey: ReportingObligationKey): ReportingCalendarCellView {
  return {
    obligation_key: obligationKey,
    label: REPORTING_OBLIGATION_LABELS_HE[obligationKey],
    entry_id: null,
    filing_due_date: null,
    filing_due_date_display: null,
    status: 'missing',
    explanation_code: null,
    replaces_entry_id: null,
    is_runtime_legal_truth: false,
  };
}

export function buildReportingCalendarPeriodRow(params: {
  reporting_period_key: string;
  cells: Partial<Record<ReportingObligationKey, ReportingCalendarCellView>>;
}): ReportingCalendarPeriodRowView {
  const parsed = parseReportingPeriodKey(params.reporting_period_key);
  if (!parsed) throw new Error('invalid_reporting_period_key');
  const cells = {} as Record<ReportingObligationKey, ReportingCalendarCellView>;
  for (const key of REPORTING_OBLIGATION_KEYS) {
    cells[key] = params.cells[key] ?? buildEmptyCalendarCell(key);
  }
  const statuses = REPORTING_OBLIGATION_KEYS.map((k) => cells[k].status);
  const unique = [...new Set(statuses)];
  let row_status: ReportingCalendarPeriodRowView['row_status'] = 'missing';
  if (unique.length === 1) row_status = unique[0]!;
  else if (unique.some((s) => s !== 'missing')) row_status = 'mixed';
  return {
    reporting_period_key: params.reporting_period_key,
    period_label: `${hebrewMonthLabel(parsed.month)} ${parsed.year}`,
    year: parsed.year,
    month: parsed.month,
    cells,
    row_status,
  };
}

export type ResolvedReportingDueDate = {
  resolved: true;
  country_code: string;
  obligation_key: ReportingObligationKey;
  reporting_period_key: string;
  filing_due_date: string;
  entry_id: string;
  status: 'active';
  explanation_code: string | null;
  legal_basis_reference: string | null;
};

export type UnresolvedReportingDueDate = {
  resolved: false;
  country_code: string;
  obligation_key: string;
  reporting_period_key: string;
  filing_due_date: null;
  reason:
    | 'missing_active_entry'
    | 'draft_not_runtime_truth'
    | 'national_insurance_not_in_tax_authority_calendar'
    | 'vat_not_applicable'
    | 'vat_period_not_applicable_for_frequency'
    | 'filing_due_before_reporting_period_end'
    | 'income_tax_advances_not_applicable'
    | 'invalid_obligation_key'
    | 'invalid_reporting_period_key'
    | 'country_mismatch';
};

/**
 * Backend-owned VAT reporting-period IDENTITY applicability.
 * Calendar stores monthly statutory rows; client frequency decides which period identities apply.
 *
 * IL bi-monthly: odd calendar months (Jan/Mar/May/Jul/Sep/Nov) identify the START of a
 * completed two-month pair (e.g. 2026-07 = July–August). This is period identity only —
 * NOT the Country Pack row used for bi-monthly filing_due_date lookup.
 * Bi-monthly filing dates resolve via {@link biMonthlyVatPairEndPeriodKey} (pair end month).
 */
export function isVatReportingPeriodApplicable(input: {
  vat_frequency: ClientVatFrequency | string | null | undefined;
  reporting_period_key: string;
}): boolean {
  const frequency = String(input.vat_frequency ?? '')
    .trim()
    .toLowerCase();
  const parsed = parseReportingPeriodKey(input.reporting_period_key);
  if (!parsed) return false;
  if (frequency === 'not_relevant' || frequency === '') return false;
  if (frequency === 'monthly') return true;
  if (frequency === 'bi_monthly') return parsed.month % 2 === 1;
  return false;
}

/**
 * Bi-monthly pair end month (even) from an odd period-identity start key.
 * Country Pack has no frequency dimension: filing_due_date for bi-monthly must come from
 * the pair-end monthly statutory row so the due date cannot fall before the pair completes.
 */
export function biMonthlyVatPairEndPeriodKey(periodIdentityStartKey: string): string | null {
  const parsed = parseReportingPeriodKey(periodIdentityStartKey);
  if (!parsed) return null;
  if (parsed.month % 2 === 0) return null;
  return buildReportingPeriodKey(
    parsed.month === 12 ? parsed.year + 1 : parsed.year,
    parsed.month === 12 ? 1 : parsed.month + 1
  );
}

/** Last calendar date (YYYY-MM-DD) of a reporting_period_key month. */
export function lastDateOfReportingPeriodMonth(periodKey: string): string | null {
  const parsed = parseReportingPeriodKey(periodKey);
  if (!parsed) return null;
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Invariant: a filing due date must not represent an impossible schedule for a period
 * that has not yet completed. Requires filing_due_date strictly after period end date.
 */
export function isFilingDueDateAfterReportingPeriodEnd(
  filingDueDate: string,
  periodEndKey: string
): boolean {
  const end = lastDateOfReportingPeriodMonth(periodEndKey);
  if (!end) return false;
  const due = String(filingDueDate ?? '')
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  return due > end;
}

export type YearPublicationCellSnapshot = {
  reporting_period_key: string;
  obligation_key: ReportingObligationKey;
  draft_id: string | null;
  active_id: string | null;
  effective_filing_due_date: string | null;
};

export type YearPublicationAssessment = {
  complete: boolean;
  expected_count: number;
  present_count: number;
  draft_ids_to_activate: string[];
  active_ids_to_deprecate: string[];
  missing: Array<{ reporting_period_key: string; obligation_key: ReportingObligationKey }>;
  invalid_dates: Array<{ reporting_period_key: string; obligation_key: ReportingObligationKey }>;
};

/**
 * Validate the intended publication set BEFORE any legal-truth mutation.
 * Completeness = every year period × configured obligation key has draft or active with a real date.
 * Obligation set is the Country Pack calendar vocabulary (not a hardcoded "36" forever).
 */
export function assessYearPublicationCompleteness(
  year: number,
  cells: YearPublicationCellSnapshot[],
  obligationKeys: readonly ReportingObligationKey[] = REPORTING_OBLIGATION_KEYS
): YearPublicationAssessment {
  const periodKeys = reportingPeriodKeysForYear(year);
  const byKey = new Map(
    cells.map((c) => [`${c.reporting_period_key}:${c.obligation_key}`, c] as const)
  );
  const missing: YearPublicationAssessment['missing'] = [];
  const invalid_dates: YearPublicationAssessment['invalid_dates'] = [];
  const draft_ids_to_activate: string[] = [];
  const active_ids_to_deprecate: string[] = [];
  let present_count = 0;

  for (const periodKey of periodKeys) {
    for (const obligationKey of obligationKeys) {
      const cell = byKey.get(`${periodKey}:${obligationKey}`);
      const effective = cell?.effective_filing_due_date?.trim().slice(0, 10) ?? null;
      if (!cell || (!cell.draft_id && !cell.active_id)) {
        missing.push({ reporting_period_key: periodKey, obligation_key: obligationKey });
        continue;
      }
      if (!effective || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
        invalid_dates.push({ reporting_period_key: periodKey, obligation_key: obligationKey });
        continue;
      }
      present_count += 1;
      if (cell.draft_id) {
        draft_ids_to_activate.push(cell.draft_id);
        if (cell.active_id) active_ids_to_deprecate.push(cell.active_id);
      }
    }
  }

  const expected_count = periodKeys.length * obligationKeys.length;
  return {
    complete: missing.length === 0 && invalid_dates.length === 0 && present_count === expected_count,
    expected_count,
    present_count,
    draft_ids_to_activate,
    active_ids_to_deprecate,
    missing,
    invalid_dates,
  };
}

export function ownerReportingCalendarStatusPresentation(input: {
  active_count: number;
  draft_count: number;
  missing_count: number;
  configured_count: number;
}): { status: string; status_label: string } {
  if (input.active_count > 0 && input.draft_count > 0) {
    return { status: 'unpublished_changes', status_label: 'שינויים שלא פורסמו' };
  }
  if (input.active_count > 0 && input.draft_count === 0 && input.missing_count === 0) {
    return { status: 'published', status_label: 'פורסם' };
  }
  if (input.draft_count > 0 || input.configured_count > 0) {
    return { status: 'draft', status_label: 'טיוטה' };
  }
  return { status: 'empty', status_label: 'טיוטה' };
}

export type ReportingDueDateResolution = ResolvedReportingDueDate | UnresolvedReportingDueDate;

export function unresolvedReportingDueDate(
  countryCode: string,
  obligationKey: string,
  reportingPeriodKey: string,
  reason: UnresolvedReportingDueDate['reason']
): UnresolvedReportingDueDate {
  return {
    resolved: false,
    country_code: countryCode,
    obligation_key: obligationKey,
    reporting_period_key: reportingPeriodKey,
    filing_due_date: null,
    reason,
  };
}
