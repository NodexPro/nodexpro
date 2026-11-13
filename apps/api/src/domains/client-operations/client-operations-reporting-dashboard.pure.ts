/**
 * Client Operations reporting-status dashboard — backend-owned presentation.
 *
 * VIEW over existing filing truth (client_obligations + ITD/NI period facts)
 * and Country Pack Reporting Calendar due dates. Not a second reporting domain.
 *
 * 4-day yellow is a CO product warning, not a legal due-date change.
 * DocFlow delivery is not government filing proof.
 */

import { CO_UI } from './client-operations-ui-labels.pure.js';
import {
  incomeTaxAdvancesObligationKey,
  incomeTaxDeductionsObligationKey,
  parseReportingPeriodKey,
  resolveVatObligationKeyFromClientTaxSettings,
} from '../country-pack/reporting-calendar.pure.js';
import { type TaxObligationPaymentClassification } from '../accounting-base/accounting-base-tax-obligation-payment.pure.js';

/** Product warning window (calendar days). Does not change statutory due dates. */
export const CLIENT_OPERATIONS_REPORTING_WARNING_DAYS = 4;

/** Filing KPI cards: one count per client, never canonical_id-only collapse. */
export const CLIENT_OPERATIONS_REPORTING_KPI_IDS = [
  'vat',
  'income_tax',
  'income_tax_deductions',
  'national_insurance_deductions',
  'payroll',
  'annual',
  'capital_declaration',
] as const;

export type ClientOperationsReportingKpiId = (typeof CLIENT_OPERATIONS_REPORTING_KPI_IDS)[number];

export const CLIENT_OPERATIONS_PAYMENTS_OUTSTANDING_KPI_ID = 'payments_outstanding' as const;

/** Legacy `withholding` remains a table filter alias for both deduction kinds. */
export const CLIENT_OPERATIONS_REPORTING_FILTER_IDS = [
  ...CLIENT_OPERATIONS_REPORTING_KPI_IDS,
  'withholding',
  CLIENT_OPERATIONS_PAYMENTS_OUTSTANDING_KPI_ID,
] as const;

export type ClientOperationsReportingFilterId =
  (typeof CLIENT_OPERATIONS_REPORTING_FILTER_IDS)[number];

export const CLIENT_OPERATIONS_REPORTING_OBLIGATION_KINDS = [
  'vat',
  'income_tax_advance',
  'payroll',
  'national_insurance',
  'income_tax_deductions',
  'national_insurance_deductions',
  'annual',
] as const;

export type ClientOperationsReportingObligationKind =
  (typeof CLIENT_OPERATIONS_REPORTING_OBLIGATION_KINDS)[number];

export type ClientOperationsReportingCellTone =
  | 'not_applicable'
  | 'unknown'
  | 'neutral_open'
  | 'warning'
  | 'urgent'
  | 'overdue'
  | 'submitted'
  | 'payment_outstanding'
  | 'payment_unknown';

export type ClientOperationsReportingRowTone =
  | 'none'
  | 'neutral'
  | 'warning'
  | 'urgent'
  | 'overdue'
  | 'payment_outstanding'
  | 'complete';

export type ClientOperationsReportingPaymentState =
  | 'not_applicable'
  | 'unfiled'
  | 'unknown'
  | 'outstanding'
  | 'partially_paid'
  | 'paid_in_full'
  | 'not_required';

export type ClientOperationsReportingDisplayIcon =
  | 'none'
  | 'check'
  | 'bang_overdue'
  | 'bang_payment'
  | 'unknown';

export type ClientOperationsReportingAllowedAction =
  | 'confirm_filing'
  | 'unfile'
  | 'update_payment';

export type ClientOperationsReportingPaymentOption = {
  id: TaxObligationPaymentClassification;
  label_key: string;
};

export type ClientOperationsReportingPaymentModal = {
  mode: 'file_with_payment' | 'update_payment';
  title_key: string;
  options: ClientOperationsReportingPaymentOption[];
  confirm_key: string;
  cancel_key: string;
};

export type ClientOperationsReportingSortId = 'priority' | 'client_name' | 'period_created';

const PERIOD_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SELF_EMPLOYED_NI_OFFICE_REMINDER_DAY = 15;
const YEAR_KEY_RE = /^(\d{4})$/;
const BIMONTHLY_VAT_PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|1[0-2])$/;

const SUBMITTED_STATUSES = new Set([
  'reported',
  'reported_late',
  'reported_and_paid',
  'paid_on_time',
  'paid_late',
]);

const NOT_APPLICABLE_STATUSES = new Set(['not_relevant']);

const READY_TO_MARK_STATUSES = new Set(['ready_to_report', 'ready_to_process']);

export const REPORTING_KPI_LABEL_KEYS: Record<ClientOperationsReportingKpiId, string> = {
  vat: CO_UI.reporting.kpi.vat,
  income_tax: CO_UI.reporting.kpi.incomeTax,
  income_tax_deductions: CO_UI.reporting.kpi.incomeTaxDeductions,
  national_insurance_deductions: CO_UI.reporting.kpi.nationalInsuranceDeductions,
  payroll: CO_UI.reporting.kpi.payroll,
  annual: CO_UI.reporting.kpi.annual,
  capital_declaration: CO_UI.reporting.kpi.capitalDeclaration,
};

export const REPORTING_CELL_TONE_LABEL_KEYS: Record<ClientOperationsReportingCellTone, string> = {
  not_applicable: CO_UI.reporting.cell.notApplicable,
  unknown: CO_UI.reporting.cell.unknown,
  neutral_open: CO_UI.reporting.cell.open,
  warning: CO_UI.reporting.cell.warning,
  urgent: CO_UI.reporting.cell.urgent,
  overdue: CO_UI.reporting.cell.overdue,
  submitted: CO_UI.reporting.cell.submitted,
  payment_outstanding: CO_UI.reporting.cell.paymentOutstanding,
  payment_unknown: CO_UI.reporting.cell.paymentUnknown,
};

export const REPORTING_ROW_TONE_LABEL_KEYS: Record<ClientOperationsReportingRowTone, string> = {
  none: CO_UI.reporting.row.none,
  neutral: CO_UI.reporting.row.neutral,
  warning: CO_UI.reporting.row.warning,
  urgent: CO_UI.reporting.row.urgent,
  overdue: CO_UI.reporting.row.overdue,
  payment_outstanding: CO_UI.reporting.row.paymentOutstanding,
  complete: CO_UI.reporting.row.complete,
};

export const REPORTING_KIND_COLUMN_KEY: Record<ClientOperationsReportingObligationKind, string> = {
  vat: 'vat',
  income_tax_advance: 'income_tax_advance',
  payroll: 'payroll',
  national_insurance: 'national_insurance',
  income_tax_deductions: 'income_tax_deductions',
  national_insurance_deductions: 'national_insurance_deductions',
  annual: 'annual_report',
};

export const REPORTING_KPI_KINDS: Record<
  ClientOperationsReportingKpiId,
  readonly ClientOperationsReportingObligationKind[]
> = {
  vat: ['vat'],
  income_tax: ['income_tax_advance'],
  income_tax_deductions: ['income_tax_deductions'],
  national_insurance_deductions: ['national_insurance_deductions'],
  payroll: ['payroll'],
  annual: [],
  capital_declaration: [],
};

const ROW_TONE_PRIORITY: Record<ClientOperationsReportingRowTone, number> = {
  overdue: 0,
  urgent: 1,
  warning: 2,
  payment_outstanding: 3,
  neutral: 4,
  complete: 5,
  none: 6,
};

const REPORTING_OVERLAY_KINDS = new Set<ClientOperationsReportingObligationKind>([
  'vat',
  'income_tax_advance',
  'payroll',
  'annual',
]);

/**
 * TEMPORARY_COUNTRY_PACK_PENDING — Country Pack / Reporting Calendar has no
 * payment_required flag yet. Payroll data filing is not a tax-payment obligation.
 */
export function paymentAppliesForReportingKind(
  kind: ClientOperationsReportingObligationKind,
): boolean {
  return kind !== 'payroll' && kind !== 'national_insurance';
}

/** Self-employed NI is an amount display, not a filing-overdue driver. */
export function reportingKindIsInformational(
  kind: ClientOperationsReportingObligationKind,
): boolean {
  return kind === 'national_insurance';
}

export function reportingKindAffectsRowTone(
  kind: ClientOperationsReportingObligationKind,
): boolean {
  return !reportingKindIsInformational(kind);
}

export function reportingKindAffectsFilingKpi(
  kind: ClientOperationsReportingObligationKind,
): boolean {
  return !reportingKindIsInformational(kind);
}

/** Backend-owned annual / capital KPI facts — not derived from obligation canonical_id. */
export type ReportingKpiClientFacts = {
  annual_required: boolean;
  annual_submitted: boolean;
  capital_required: boolean;
  capital_submitted: boolean;
};

export type ReportingKpiRowInput = {
  client_id?: string | null;
  reporting?: ClientOperationsReportingRowPresentation | null;
  reporting_kpi?: ReportingKpiClientFacts | null;
};

export function reportingKpiClientKey(row: { client_id?: string | null }, fallback: string): string {
  const id = String(row.client_id ?? '').trim();
  return id || fallback;
}

/** Payroll processing complete — not material receipt. */
export function payrollWorkflowCountsAsSubmitted(input: {
  sent_to_employer?: boolean | null;
  no_salaries_this_month?: boolean | null;
}): boolean {
  return Boolean(input.sent_to_employer) || Boolean(input.no_salaries_this_month);
}

export function payrollWorkflowIsNotRelevant(input: { not_relevant?: boolean | null }): boolean {
  return Boolean(input.not_relevant);
}

/**
 * Monthly NI deductions KPI uses periodic 102 + 100 only.
 * Form 126 is H1/annual and must not add extra clients or monthly completion.
 */
export function nationalInsuranceDeductionsPeriodicSubmitted(input: {
  reported_102?: boolean | null;
  reported_100?: boolean | null;
}): boolean {
  return Boolean(input.reported_102) && Boolean(input.reported_100);
}

export function resolveAnnualReportKpiFact(input: { hasSubmissionForTaxYear: boolean }): {
  required: true;
  submitted: boolean;
} {
  return { required: true, submitted: Boolean(input.hasSubmissionForTaxYear) };
}

export function resolveCapitalDeclarationKpiFact(input: {
  open: { operational_target_date: string | null; status: string } | null;
  datedCompleted: ReadonlyArray<{ operational_target_date: string | null; status: string }>;
}): { required: boolean; submitted: boolean } {
  const openDate = String(input.open?.operational_target_date ?? '').trim();
  if (input.open && openDate) {
    return { required: true, submitted: input.open.status === 'completed' };
  }
  const completed = input.datedCompleted.find(
    (row) => String(row.operational_target_date ?? '').trim() && row.status === 'completed',
  );
  if (completed) return { required: true, submitted: true };
  return { required: false, submitted: false };
}

export type ClientOperationsReportingFilingFact = {
  obligation_id: string | null;
  obligation_type: string;
  period_key: string;
  status: string | null;
  due_date: string | null;
  last_reported_at: string | null;
};

export type ClientOperationsFrequencyCellChrome =
  | 'pending'
  | 'action_required'
  | 'filed_unpaid'
  | 'filed_paid'
  | 'not_applicable';

export type ClientOperationsFilingDetail = {
  openable: boolean;
  chrome: ClientOperationsFrequencyCellChrome;
  period_key: string;
  period_display: string;
  filing_status_key: string;
  filed_on_display: string | null;
  submission_reference: string | null;
  payment_classification: TaxObligationPaymentClassification | null;
  payment_state: ClientOperationsReportingPaymentState;
  can_confirm_filing: boolean;
  can_clear_filing: boolean;
  can_record_payment: boolean;
  can_report: boolean;
  can_report_and_pay: boolean;
  can_mark_paid: boolean;
  report_key: string;
  report_and_paid_key: string;
  paid_key: string;
  title_key: string;
  client_key: string;
  period_label_key: string;
  frequency_key: string;
  status_key: string;
  confirm_action_key: string;
  filed_on_key: string;
  reference_key: string;
  payment_status_key: string;
  not_recorded_key: string;
  save_key: string;
  cancel_key: string;
};

export const SELF_EMPLOYED_NI_HANDLING_METHODS = [
  'standing_order',
  'client_pays',
  'manual_monthly',
] as const;

export type SelfEmployedNiHandlingMethod = (typeof SELF_EMPLOYED_NI_HANDLING_METHODS)[number];
export type SelfEmployedNiHandlingMethodSource = 'explicit' | 'standing_until' | 'unresolved';

export type ClientOperationsSelfEmployedNiHandlingOption = {
  id: SelfEmployedNiHandlingMethod;
  label_key: string;
  selected: boolean;
};

export type ClientOperationsSelfEmployedNiOperations = {
  applicable: boolean;
  openable: boolean;
  period_key: string;
  period_display: string;
  handling_method: SelfEmployedNiHandlingMethod | null;
  handling_method_source: SelfEmployedNiHandlingMethodSource;
  handling_options: ClientOperationsSelfEmployedNiHandlingOption[];
  standing_order_active: boolean;
  standing_order_status_key: string;
  standing_order_provenance: 'office_recorded';
  bank_verified: false;
  authority_verified: false;
  statutory_deadline: false;
  office_reminder: boolean;
  reminder_day: number;
  action_resolved: boolean;
  action_status_key: string;
  can_set_standing_order: boolean;
  can_set_handling_method: boolean;
  can_confirm_manual_resolution: boolean;
  can_confirm_month_handled: boolean;
  title_key: string;
  client_details_key: string;
  client_key: string;
  month_key: string;
  amount_key: string;
  handling_title_key: string;
  office_note_key: string;
  resolution_key: string;
  confirm_resolution_key: string;
  month_handled_key: string;
  save_key: string;
  cancel_key: string;
};

export type ClientOperationsReportingCellInput = {
  kind: ClientOperationsReportingObligationKind;
  applicable: boolean;
  submitted: boolean;
  not_applicable_terminal: boolean;
  due_date: string | null;
  canonical_id: string;
  obligation_id: string | null;
  can_mark_submitted: boolean;
  can_mark_not_submitted: boolean;
  last_reported_at: string | null;
  operational_period_key?: string | null;
  payment_classification?: TaxObligationPaymentClassification | null;
  payment_due_date?: string | null;
  payment_applies?: boolean;
};

export type ClientOperationsReportingCellPresentation = {
  kind: ClientOperationsReportingObligationKind;
  column_key: string;
  canonical_id: string;
  tone: ClientOperationsReportingCellTone;
  tone_label_key: string;
  tooltip_key: string;
  applicable: boolean;
  submitted: boolean;
  overdue: boolean;
  due_date: string | null;
  days_until_due: number | null;
  obligation_id: string | null;
  can_mark_submitted: boolean;
  can_mark_not_submitted: boolean;
  last_reported_at: string | null;
  submitted_indicator: boolean;
  display_dash: boolean;
  overlay_visible: boolean;
  display_icon: ClientOperationsReportingDisplayIcon;
  filing_state: 'not_applicable' | 'unfiled' | 'filed';
  payment_applies: boolean;
  payment_question_visible: boolean;
  payment_state: ClientOperationsReportingPaymentState;
  payment_due_date: string | null;
  payment_due_known: boolean;
  payment_overdue: boolean;
  payment_provenance: 'user_attested' | null;
  bank_verified: false;
  allowed_actions: ClientOperationsReportingAllowedAction[];
  payment_modal: ClientOperationsReportingPaymentModal | null;
  filing_detail: ClientOperationsFilingDetail | null;
};

export type ClientOperationsReportingRowPresentation = {
  row_tone: ClientOperationsReportingRowTone;
  row_tone_label_key: string;
  priority_rank: number;
  earliest_open_due_date: string | null;
  open_overdue_count: number;
  open_urgent_count: number;
  open_warning_count: number;
  open_neutral_count: number;
  open_payment_outstanding_count: number;
  applicable_count: number;
  submitted_count: number;
  cells: Record<string, ClientOperationsReportingCellPresentation>;
};

export type ClientOperationsReportingKpiCard = {
  id: ClientOperationsReportingKpiId;
  label_key: string;
  submitted_count: number;
  total_count: number;
  remaining_count: number;
  remaining_tone: 'neutral' | 'warning' | 'urgent' | 'overdue';
};

export type ClientOperationsReportingPreviousPeriodItem = {
  period_key: string;
  navigate_period_key: string;
  display_label: string;
  kind: 'month' | 'year';
  incomplete: true;
  overdue: boolean;
};

export type ClientOperationsReportingPreviousPeriods = {
  incomplete_count: number;
  overdue_count: number;
  periods: ClientOperationsReportingPreviousPeriodItem[];
};

export type ClientOperationsPaymentsOutstandingKpi = {
  id: typeof CLIENT_OPERATIONS_PAYMENTS_OUTSTANDING_KPI_ID;
  label_key: string;
  count: number;
  remaining_tone: 'payment_outstanding';
  tooltip_key: string;
  tooltip_periods: Array<{ period_key: string; display_label: string }>;
};

export type ClientOperationsReportingDashboard = {
  kpi_cards: ClientOperationsReportingKpiCard[];
  payments_outstanding_kpi: ClientOperationsPaymentsOutstandingKpi;
  previous_periods: ClientOperationsReportingPreviousPeriods;
  sort_options: Array<{ id: ClientOperationsReportingSortId; label_key: string }>;
  active_sort: ClientOperationsReportingSortId;
  active_kpi_filter: ClientOperationsReportingFilterId | null;
};

export type ClientOperationsReportingCalendarDue = {
  obligation_key: string;
  reporting_period_key: string;
  filing_due_date: string;
};

export function isClientOperationsReportingKpiId(
  value: string | null | undefined,
): value is ClientOperationsReportingKpiId {
  return (CLIENT_OPERATIONS_REPORTING_KPI_IDS as readonly string[]).includes(String(value ?? ''));
}

export function isClientOperationsReportingFilterId(
  value: string | null | undefined,
): value is ClientOperationsReportingFilterId {
  return (CLIENT_OPERATIONS_REPORTING_FILTER_IDS as readonly string[]).includes(String(value ?? ''));
}

export function isFilingSubmittedStatus(status: string | null | undefined): boolean {
  return SUBMITTED_STATUSES.has(String(status ?? '').trim());
}

export function isFilingNotApplicableStatus(status: string | null | undefined): boolean {
  return NOT_APPLICABLE_STATUSES.has(String(status ?? '').trim());
}

export function canMarkObligationSubmitted(status: string | null | undefined): boolean {
  return READY_TO_MARK_STATUSES.has(String(status ?? '').trim());
}

export function calendarDaysUntilDue(dueDate: string, today: string): number | null {
  const due = dueDate.slice(0, 10);
  const now = today.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(now)) return null;
  const dueUtc = Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, Number(due.slice(8, 10)));
  const nowUtc = Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1, Number(now.slice(8, 10)));
  return Math.round((dueUtc - nowUtc) / 86_400_000);
}

export function resolveReportingCellTone(input: {
  applicable: boolean;
  submitted: boolean;
  not_applicable_terminal?: boolean;
  due_date: string | null;
  today: string;
}): ClientOperationsReportingCellTone {
  if (input.not_applicable_terminal || !input.applicable) return 'not_applicable';
  if (input.submitted) return 'submitted';
  const due = String(input.due_date ?? '').slice(0, 10);
  if (!due) return 'unknown';
  const days = calendarDaysUntilDue(due, input.today);
  if (days == null) return 'unknown';
  if (days < 0) return 'overdue';
  if (days <= 1) return 'urgent';
  if (days <= CLIENT_OPERATIONS_REPORTING_WARNING_DAYS) return 'warning';
  return 'neutral_open';
}

export function resolveReportingPaymentState(input: {
  applicable: boolean;
  submitted: boolean;
  payment_applies: boolean;
  payment_classification: TaxObligationPaymentClassification | null | undefined;
}): ClientOperationsReportingPaymentState {
  if (!input.applicable || !input.payment_applies) return 'not_applicable';
  if (!input.submitted) return 'unfiled';
  if (input.payment_classification === 'paid_in_full') return 'paid_in_full';
  if (input.payment_classification === 'outstanding') return 'outstanding';
  if (input.payment_classification === 'partially_paid') return 'partially_paid';
  if (input.payment_classification === 'not_required') return 'not_required';
  return 'unknown';
}

function paymentOptions(): ClientOperationsReportingPaymentOption[] {
  return [
    { id: 'paid_in_full', label_key: CO_UI.reporting.payment.paidInFull },
    { id: 'outstanding', label_key: CO_UI.reporting.payment.outstanding },
    { id: 'partially_paid', label_key: CO_UI.reporting.payment.partiallyPaid },
    { id: 'not_required', label_key: CO_UI.reporting.payment.notRequired },
  ];
}

function paymentModalFor(
  mode: ClientOperationsReportingPaymentModal['mode'],
): ClientOperationsReportingPaymentModal {
  return {
    mode,
    title_key:
      mode === 'update_payment' ? CO_UI.reporting.payment.updateTitle : CO_UI.reporting.payment.question,
    options: paymentOptions(),
    confirm_key: CO_UI.reporting.payment.confirm,
    cancel_key: CO_UI.reporting.payment.cancel,
  };
}

function cellPaymentComplete(cell: {
  payment_applies: boolean;
  payment_state: ClientOperationsReportingPaymentState;
}): boolean {
  if (!cell.payment_applies) return true;
  return cell.payment_state === 'paid_in_full' || cell.payment_state === 'not_required';
}

export function buildReportingCellPresentation(
  input: ClientOperationsReportingCellInput,
  today: string,
): ClientOperationsReportingCellPresentation {
  const informational = reportingKindIsInformational(input.kind);
  const paymentApplies = informational
    ? false
    : input.payment_applies != null
      ? input.payment_applies
      : paymentAppliesForReportingKind(input.kind);
  const filingTone = resolveReportingCellTone({
    applicable: input.applicable,
    submitted: informational ? false : input.submitted,
    not_applicable_terminal: input.not_applicable_terminal,
    due_date: informational ? null : input.due_date,
    today,
  });
  const applicable = input.applicable && !input.not_applicable_terminal;
  const paymentState = resolveReportingPaymentState({
    applicable,
    submitted: input.submitted,
    payment_applies: paymentApplies,
    payment_classification: input.payment_classification ?? null,
  });
  let tone: ClientOperationsReportingCellTone = informational
    ? applicable
      ? 'unknown'
      : 'not_applicable'
    : filingTone;
  if (!informational && applicable && input.submitted && paymentApplies) {
    if (paymentState === 'outstanding' || paymentState === 'partially_paid') tone = 'payment_outstanding';
    else if (paymentState === 'unknown') tone = 'payment_unknown';
    else tone = 'submitted';
  }
  const days =
    informational ||
    tone === 'not_applicable' ||
    tone === 'submitted' ||
    tone === 'payment_outstanding' ||
    tone === 'payment_unknown' ||
    !input.due_date
      ? null
      : calendarDaysUntilDue(input.due_date, today);
  const paymentDueKnown = Boolean(input.payment_due_date);
  const overlayVisible = !informational && REPORTING_OVERLAY_KINDS.has(input.kind);
  const paymentQuestionVisible = Boolean(applicable && paymentApplies && overlayVisible);
  const allowed_actions: ClientOperationsReportingAllowedAction[] = [];
  if (!informational && input.can_mark_submitted) allowed_actions.push('confirm_filing');
  if (!informational && input.can_mark_not_submitted) allowed_actions.push('unfile');
  if (!informational && applicable && input.submitted && paymentApplies && overlayVisible) {
    allowed_actions.push('update_payment');
  }
  let displayIcon: ClientOperationsReportingDisplayIcon = 'none';
  if (tone === 'submitted') displayIcon = 'check';
  else if (tone === 'overdue') displayIcon = 'bang_overdue';
  else if (tone === 'payment_outstanding') displayIcon = 'bang_payment';
  else if (tone === 'payment_unknown') displayIcon = 'unknown';
  let tooltipKey = informational && applicable ? CO_UI.reporting.cell.informational : REPORTING_CELL_TONE_LABEL_KEYS[tone];
  if (tone === 'payment_outstanding' && paymentState === 'partially_paid') {
    tooltipKey = CO_UI.reporting.cell.paymentPartial;
  }
  const paymentModal =
    paymentQuestionVisible && (input.can_mark_submitted || allowed_actions.includes('update_payment'))
      ? paymentModalFor(input.can_mark_submitted ? 'file_with_payment' : 'update_payment')
      : null;
  return {
    kind: input.kind,
    column_key: REPORTING_KIND_COLUMN_KEY[input.kind],
    canonical_id: input.canonical_id,
    tone,
    tone_label_key: REPORTING_CELL_TONE_LABEL_KEYS[tone],
    tooltip_key: tooltipKey,
    applicable,
    submitted: input.submitted,
    overdue: !informational && tone === 'overdue',
    due_date: informational ? null : input.due_date,
    days_until_due: days,
    obligation_id: informational ? null : input.obligation_id,
    can_mark_submitted: informational ? false : input.can_mark_submitted,
    can_mark_not_submitted: informational ? false : input.can_mark_not_submitted,
    last_reported_at: input.last_reported_at,
    submitted_indicator: tone === 'submitted',
    display_dash: tone === 'not_applicable',
    overlay_visible: overlayVisible,
    display_icon: displayIcon,
    filing_state: !applicable ? 'not_applicable' : input.submitted ? 'filed' : 'unfiled',
    payment_applies: paymentApplies,
    payment_question_visible: paymentQuestionVisible,
    payment_state: paymentState,
    payment_due_date: paymentDueKnown ? String(input.payment_due_date).slice(0, 10) : null,
    payment_due_known: paymentDueKnown,
    payment_overdue: false,
    payment_provenance: input.payment_classification ? 'user_attested' : null,
    bank_verified: false,
    allowed_actions,
    payment_modal: paymentModal,
    filing_detail: buildFilingDetail({
      kind: input.kind,
      applicable,
      submitted: input.submitted,
      tone,
      periodKey: input.operational_period_key ?? '',
      lastReportedAt: input.last_reported_at,
      paymentClassification: input.payment_classification ?? null,
      paymentState,
      paymentApplies,
      canConfirmFiling: Boolean(!informational && input.can_mark_submitted),
      canClearFiling: Boolean(!informational && input.can_mark_not_submitted),
    }),
  };
}

export function resolveReportingRowTone(
  cells: readonly ClientOperationsReportingCellPresentation[],
): ClientOperationsReportingRowTone {
  const applicable = cells.filter((c) => c.applicable && reportingKindAffectsRowTone(c.kind));
  if (applicable.length === 0) return 'none';
  const rowComplete = applicable.every((c) => c.submitted && cellPaymentComplete(c));
  if (rowComplete) return 'complete';
  if (applicable.some((c) => c.tone === 'overdue')) return 'overdue';
  if (applicable.some((c) => c.tone === 'urgent')) return 'urgent';
  if (applicable.some((c) => c.tone === 'warning')) return 'warning';
  if (applicable.some((c) => c.tone === 'payment_outstanding')) return 'payment_outstanding';
  return 'neutral';
}

export function buildReportingRowPresentation(
  cellInputs: readonly ClientOperationsReportingCellInput[],
  today: string,
): ClientOperationsReportingRowPresentation {
  const cells: Record<string, ClientOperationsReportingCellPresentation> = {};
  for (const input of cellInputs) {
    const cell = buildReportingCellPresentation(input, today);
    cells[cell.column_key] = cell;
  }
  const list = Object.values(cells);
  const applicable = list.filter((c) => c.applicable && reportingKindAffectsRowTone(c.kind));
  const rowTone = resolveReportingRowTone(list);
  const open = applicable.filter((c) => !c.submitted);
  const earliest = open
    .map((c) => c.due_date)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;
  return {
    row_tone: rowTone,
    row_tone_label_key: REPORTING_ROW_TONE_LABEL_KEYS[rowTone],
    priority_rank: ROW_TONE_PRIORITY[rowTone],
    earliest_open_due_date: earliest,
    open_overdue_count: open.filter((c) => c.tone === 'overdue').length,
    open_urgent_count: open.filter((c) => c.tone === 'urgent').length,
    open_warning_count: open.filter((c) => c.tone === 'warning').length,
    open_neutral_count: open.filter((c) => c.tone === 'neutral_open' || c.tone === 'unknown' || c.tone === 'payment_unknown').length,
    open_payment_outstanding_count: applicable.filter((c) => c.tone === 'payment_outstanding').length,
    applicable_count: applicable.length,
    submitted_count: applicable.filter((c) => c.submitted).length,
    cells,
  };
}

export function compareReportingPriorityRows(
  a: {
    client_id: string;
    client_name: string | null;
    reporting?: ClientOperationsReportingRowPresentation | null;
  },
  b: {
    client_id: string;
    client_name: string | null;
    reporting?: ClientOperationsReportingRowPresentation | null;
  },
): number {
  const ar = a.reporting;
  const br = b.reporting;
  const aRank = ar?.priority_rank ?? ROW_TONE_PRIORITY.none;
  const bRank = br?.priority_rank ?? ROW_TONE_PRIORITY.none;
  if (aRank !== bRank) return aRank - bRank;
  const urgencyCount = (row: ClientOperationsReportingRowPresentation | null | undefined, tone: ClientOperationsReportingRowTone) => {
    if (!row) return 0;
    if (tone === 'overdue') return row.open_overdue_count;
    if (tone === 'urgent') return row.open_urgent_count;
    if (tone === 'warning') return row.open_warning_count;
    if (tone === 'payment_outstanding') return row.open_payment_outstanding_count;
    if (tone === 'neutral') return row.open_neutral_count;
    return 0;
  };
  const tone = ar?.row_tone ?? 'none';
  const byCount = urgencyCount(br, tone) - urgencyCount(ar, tone);
  if (byCount !== 0) return byCount;
  const aDue = ar?.earliest_open_due_date ?? '9999-12-31';
  const bDue = br?.earliest_open_due_date ?? '9999-12-31';
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  const byName = String(a.client_name ?? '').localeCompare(String(b.client_name ?? ''), 'he');
  if (byName !== 0) return byName;
  return a.client_id.localeCompare(b.client_id);
}

function applyUnsubmittedCellTone(
  remainingTone: ClientOperationsReportingKpiCard['remaining_tone'],
  tone: ClientOperationsReportingCellPresentation['tone'] | undefined,
): ClientOperationsReportingKpiCard['remaining_tone'] {
  if (tone === 'overdue') return 'overdue';
  if (tone === 'urgent' && remainingTone !== 'overdue') return 'urgent';
  if (tone === 'warning' && remainingTone === 'neutral') return 'warning';
  return remainingTone;
}

export function buildReportingKpiCards(rows: ReportingKpiRowInput[]): ClientOperationsReportingKpiCard[] {
  const cards: ClientOperationsReportingKpiCard[] = [];
  for (const id of CLIENT_OPERATIONS_REPORTING_KPI_IDS) {
    let submitted = 0;
    let total = 0;
    let remainingTone: ClientOperationsReportingKpiCard['remaining_tone'] = 'neutral';
    const seen = new Set<string>();

    if (id === 'annual' || id === 'capital_declaration') {
      for (const [index, row] of rows.entries()) {
        const facts = row.reporting_kpi;
        const required = id === 'annual' ? Boolean(facts?.annual_required) : Boolean(facts?.capital_required);
        const done = id === 'annual' ? Boolean(facts?.annual_submitted) : Boolean(facts?.capital_submitted);
        if (!required) continue;
        const clientKey = reportingKpiClientKey(row, `__row_${index}`);
        if (seen.has(clientKey)) continue;
        seen.add(clientKey);
        total += 1;
        if (done) submitted += 1;
      }
    } else {
      const kinds = REPORTING_KPI_KINDS[id].filter((kind) => reportingKindAffectsFilingKpi(kind));
      for (const [index, row] of rows.entries()) {
        const cells = row.reporting?.cells;
        if (!cells) continue;
        const clientKey = reportingKpiClientKey(row, `__row_${index}`);
        if (seen.has(clientKey)) continue;
        let matched = false;
        let rowSubmitted = true;
        for (const kind of kinds) {
          const cell = cells[REPORTING_KIND_COLUMN_KEY[kind]];
          if (!cell?.applicable) continue;
          matched = true;
          if (!cell.submitted) {
            rowSubmitted = false;
            remainingTone = applyUnsubmittedCellTone(remainingTone, cell.tone);
          }
        }
        if (!matched) continue;
        seen.add(clientKey);
        total += 1;
        if (rowSubmitted) submitted += 1;
      }
    }

    cards.push({
      id,
      label_key: REPORTING_KPI_LABEL_KEYS[id],
      submitted_count: submitted,
      total_count: total,
      remaining_count: Math.max(0, total - submitted),
      remaining_tone: remainingTone,
    });
  }
  return cards;
}

export function cellHasPaymentOutstanding(
  cell: ClientOperationsReportingCellPresentation | null | undefined,
): boolean {
  if (!cell?.applicable) return false;
  return cell.payment_state === 'outstanding' || cell.payment_state === 'partially_paid';
}

export function rowMatchesReportingKpiFilter(
  row: ReportingKpiRowInput,
  kpiId: ClientOperationsReportingFilterId | null,
): boolean {
  if (!kpiId) return true;
  if (kpiId === 'annual') return Boolean(row.reporting_kpi?.annual_required);
  if (kpiId === 'capital_declaration') return Boolean(row.reporting_kpi?.capital_required);
  const cells = row.reporting?.cells;
  if (!cells) return false;
  if (kpiId === CLIENT_OPERATIONS_PAYMENTS_OUTSTANDING_KPI_ID) {
    return Object.values(cells).some((cell) => cellHasPaymentOutstanding(cell));
  }
  const kinds =
    kpiId === 'withholding'
      ? (['income_tax_deductions', 'national_insurance_deductions'] as const)
      : isClientOperationsReportingKpiId(kpiId)
        ? REPORTING_KPI_KINDS[kpiId]
        : [];
  return kinds.some((kind) => cells[REPORTING_KIND_COLUMN_KEY[kind]]?.applicable === true);
}

export type PaymentsOutstandingPeriodFact = {
  period_key: string;
  canonical_id: string;
};

export function buildPaymentsOutstandingKpi(input: {
  rows: ReportingKpiRowInput[];
  outstanding_period_facts: readonly PaymentsOutstandingPeriodFact[];
  selected_period_key: string;
}): ClientOperationsPaymentsOutstandingKpi {
  const seen = new Set<string>();
  let count = 0;
  for (const row of input.rows) {
    const cells = row.reporting?.cells;
    if (!cells) continue;
    const clientKey = reportingKpiClientKey(row, '');
    for (const cell of Object.values(cells)) {
      if (!cellHasPaymentOutstanding(cell)) continue;
      const identity = clientKey ? `${clientKey}::${cell.canonical_id}` : cell.canonical_id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      count += 1;
    }
  }
  const periodKeys = new Set<string>();
  if (count > 0) periodKeys.add(input.selected_period_key);
  for (const fact of input.outstanding_period_facts) {
    if (
      fact.period_key === input.selected_period_key ||
      isOperationalPeriodKeyBefore(fact.period_key, input.selected_period_key)
    ) {
      periodKeys.add(fact.period_key);
    }
  }
  const tooltip_periods = [...periodKeys]
    .sort((a, b) => a.localeCompare(b))
    .map((period_key) => ({
      period_key,
      display_label: formatReportingPeriodDisplayLabel(period_key),
    }));
  return {
    id: CLIENT_OPERATIONS_PAYMENTS_OUTSTANDING_KPI_ID,
    label_key: CO_UI.reporting.kpi.paymentsOutstanding,
    count,
    remaining_tone: 'payment_outstanding',
    tooltip_key: CO_UI.reporting.kpi.paymentsOutstandingTooltip,
    tooltip_periods,
  };
}

export function formatReportingPeriodDisplayLabel(periodKey: string): string {
  const month = PERIOD_KEY_RE.exec(periodKey.trim());
  if (month) return `${month[2]}.${month[1]!.slice(2)}`;
  const year = YEAR_KEY_RE.exec(periodKey.trim());
  if (year) return year[1]!;
  return periodKey;
}

function formatReportedOnDisplay(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

function filingPaymentSettled(state: ClientOperationsReportingPaymentState): boolean {
  return state === 'paid_in_full' || state === 'not_required';
}

function buildFilingDetail(input: {
  kind: ClientOperationsReportingObligationKind;
  applicable: boolean;
  submitted: boolean;
  tone: ClientOperationsReportingCellTone;
  periodKey: string;
  lastReportedAt: string | null;
  paymentClassification: TaxObligationPaymentClassification | null;
  paymentState: ClientOperationsReportingPaymentState;
  paymentApplies: boolean;
  canConfirmFiling: boolean;
  canClearFiling: boolean;
}): ClientOperationsFilingDetail | null {
  if (input.kind !== 'vat' && input.kind !== 'income_tax_advance') return null;
  const paid = !input.paymentApplies || filingPaymentSettled(input.paymentState);
  const chrome: ClientOperationsFrequencyCellChrome = !input.applicable
    ? 'not_applicable'
    : !input.submitted
      ? input.tone === 'overdue' || input.tone === 'urgent'
        ? 'action_required'
        : 'pending'
      : paid
        ? 'filed_paid'
        : 'filed_unpaid';
  const canReport = input.applicable && !input.submitted && input.canConfirmFiling;
  return {
    openable: input.applicable,
    chrome,
    period_key: input.periodKey,
    period_display: input.periodKey ? formatReportingPeriodDisplayLabel(input.periodKey) : '',
    filing_status_key: !input.applicable
      ? CO_UI.reporting.cell.notApplicable
      : input.submitted
        ? CO_UI.reporting.cell.submitted
        : CO_UI.reporting.cell.open,
    filed_on_display: input.submitted ? formatReportedOnDisplay(input.lastReportedAt) : null,
    submission_reference: null,
    payment_classification: input.paymentClassification,
    payment_state: input.paymentState,
    can_confirm_filing: input.applicable && input.canConfirmFiling,
    can_clear_filing: input.applicable && input.canClearFiling,
    can_record_payment: input.applicable && input.paymentApplies && input.submitted && !paid,
    can_report: canReport,
    can_report_and_pay: canReport && input.paymentApplies,
    can_mark_paid: input.applicable && input.submitted && input.paymentApplies && !paid,
    report_key: CO_UI.reporting.filing.report,
    report_and_paid_key: CO_UI.reporting.filing.reportAndPaid,
    paid_key: CO_UI.reporting.filing.paid,
    title_key: CO_UI.reporting.filing.title,
    client_key: CO_UI.reporting.filing.client,
    period_label_key: CO_UI.reporting.filing.period,
    frequency_key: CO_UI.reporting.filing.frequency,
    status_key: CO_UI.reporting.filing.status,
    confirm_action_key: CO_UI.reporting.filing.confirmAction,
    filed_on_key: CO_UI.reporting.filing.filedOn,
    reference_key: CO_UI.reporting.filing.reference,
    payment_status_key: CO_UI.reporting.filing.paymentStatus,
    not_recorded_key: CO_UI.reporting.filing.notRecorded,
    save_key: CO_UI.reporting.filing.save,
    cancel_key: CO_UI.reporting.filing.cancel,
  };
}

const NI_ACTION_RESOLVED_STATUSES = new Set([
  'paid_on_time',
  'paid_late',
  'reported_and_paid',
  'not_relevant',
]);

export function standingOrderCoversOperationalMonth(
  until: string | null | undefined,
  periodKey: string,
): boolean {
  const end = String(until ?? '').slice(0, 10);
  const period = String(periodKey ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !PERIOD_KEY_RE.test(period)) return false;
  const monthStart = `${period}-01`;
  const yearStart = `${end.slice(0, 4)}-01-01`;
  return monthStart >= yearStart && monthStart <= end;
}

export function nextSelfEmployedNiStandingOrderUntil(input: {
  active: boolean;
  periodKey: string;
  existingUntil: string | null | undefined;
}): string | null {
  const period = String(input.periodKey ?? '').trim();
  const existingRaw = String(input.existingUntil ?? '').slice(0, 10);
  const existing = /^\d{4}-\d{2}-\d{2}$/.test(existingRaw) ? existingRaw : null;
  if (!PERIOD_KEY_RE.test(period)) return existing;
  if (!input.active) {
    return standingOrderCoversOperationalMonth(existing, period) ? null : existing;
  }
  const yearEnd = `${period.slice(0, 4)}-12-31`;
  if (existing && standingOrderCoversOperationalMonth(existing, period) && existing >= yearEnd) {
    return existing;
  }
  return yearEnd;
}

export function parseSelfEmployedNiHandlingMethod(value: unknown): SelfEmployedNiHandlingMethod | null {
  const raw = String(value ?? '').trim();
  return (SELF_EMPLOYED_NI_HANDLING_METHODS as readonly string[]).includes(raw)
    ? (raw as SelfEmployedNiHandlingMethod)
    : null;
}

export function operationalPeriodYear(periodKey: string): number | null {
  const match = PERIOD_KEY_RE.exec(String(periodKey ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function lastDateOfPreviousOperationalMonth(periodKey: string): string | null {
  const match = PERIOD_KEY_RE.exec(String(periodKey ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const previous = new Date(Date.UTC(year, month - 1, 0));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}

export function truncateStandingOrderUntilBeforePeriod(
  existingUntil: string | null | undefined,
  periodKey: string,
): string | null {
  const existingRaw = String(existingUntil ?? '').slice(0, 10);
  const existing = /^\d{4}-\d{2}-\d{2}$/.test(existingRaw) ? existingRaw : null;
  if (!existing) return null;
  if (!standingOrderCoversOperationalMonth(existing, periodKey)) return existing;
  return lastDateOfPreviousOperationalMonth(periodKey);
}

export function nextSelfEmployedNiStandingOrderUntilForMethod(input: {
  method: SelfEmployedNiHandlingMethod;
  periodKey: string;
  existingUntil: string | null | undefined;
}): string | null {
  if (input.method === 'standing_order') {
    return nextSelfEmployedNiStandingOrderUntil({
      active: true,
      periodKey: input.periodKey,
      existingUntil: input.existingUntil,
    });
  }
  return truncateStandingOrderUntilBeforePeriod(input.existingUntil, input.periodKey);
}

export function resolveSelfEmployedNiHandlingMethod(input: {
  storedMethod: unknown;
  storedYear: unknown;
  standingOrderUntil: string | null | undefined;
  periodKey: string;
}): {
  method: SelfEmployedNiHandlingMethod | null;
  source: SelfEmployedNiHandlingMethodSource;
  standing_order_active: boolean;
} {
  const year = operationalPeriodYear(input.periodKey);
  const stored = parseSelfEmployedNiHandlingMethod(input.storedMethod);
  const storedYear = Number(input.storedYear);
  const yearMatches = year != null && Number.isInteger(storedYear) && storedYear === year;
  const untilCovers = standingOrderCoversOperationalMonth(input.standingOrderUntil, input.periodKey);
  if (untilCovers) {
    return {
      method: 'standing_order',
      source: yearMatches && stored === 'standing_order' ? 'explicit' : 'standing_until',
      standing_order_active: true,
    };
  }
  if (yearMatches && stored) {
    return {
      method: stored,
      source: 'explicit',
      standing_order_active: stored === 'standing_order',
    };
  }
  return { method: null, source: 'unresolved', standing_order_active: false };
}

function selfEmployedNiMonthlyStatusKey(
  method: SelfEmployedNiHandlingMethod | null,
  resolved: boolean,
): string {
  if (!method) return CO_UI.reporting.ni.methodUnresolved;
  if (method === 'standing_order') return CO_UI.reporting.ni.standingActive;
  if (method === 'client_pays') return CO_UI.reporting.ni.clientPays;
  return resolved ? CO_UI.reporting.ni.resolutionDone : CO_UI.reporting.ni.resolutionOpen;
}

function selfEmployedNiHandlingLabelKey(method: SelfEmployedNiHandlingMethod): string {
  if (method === 'standing_order') return CO_UI.reporting.ni.standingActive;
  if (method === 'client_pays') return CO_UI.reporting.ni.clientPays;
  return CO_UI.reporting.ni.manualMonthly;
}

export function selfEmployedNiActionResolved(status: string | null | undefined): boolean {
  return NI_ACTION_RESOLVED_STATUSES.has(String(status ?? '').trim());
}

export function selfEmployedNiOfficeReminderActive(input: {
  applicable: boolean;
  standingOrderUntil: string | null | undefined;
  periodKey: string;
  today: string;
  obligationStatus: string | null | undefined;
  handlingMethod?: unknown;
  handlingYear?: unknown;
}): boolean {
  if (!input.applicable) return false;
  const handling = resolveSelfEmployedNiHandlingMethod({
    storedMethod: input.handlingMethod,
    storedYear: input.handlingYear,
    standingOrderUntil: input.standingOrderUntil,
    periodKey: input.periodKey,
  });
  if (handling.method !== 'manual_monthly') return false;
  if (selfEmployedNiActionResolved(input.obligationStatus)) return false;
  const period = String(input.periodKey ?? '').trim();
  const today = String(input.today ?? '').slice(0, 10);
  if (!PERIOD_KEY_RE.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const threshold = `${period}-${String(SELF_EMPLOYED_NI_OFFICE_REMINDER_DAY).padStart(2, '0')}`;
  return today >= threshold;
}

export function selfEmployedNiStorageDate(periodKey: string): string | null {
  const match = PERIOD_KEY_RE.exec(String(periodKey ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`;
}

export function buildSelfEmployedNiOperations(input: {
  applicable: boolean;
  standingOrderUntil: string | null | undefined;
  periodKey: string;
  today: string;
  obligationStatus: string | null | undefined;
  handlingMethod?: unknown;
  handlingYear?: unknown;
}): ClientOperationsSelfEmployedNiOperations {
  const applicable = input.applicable;
  const handling = resolveSelfEmployedNiHandlingMethod({
    storedMethod: input.handlingMethod,
    storedYear: input.handlingYear,
    standingOrderUntil: input.standingOrderUntil,
    periodKey: input.periodKey,
  });
  const resolved = selfEmployedNiActionResolved(input.obligationStatus);
  const canConfirmMonthHandled = applicable && handling.method === 'manual_monthly' && !resolved;
  return {
    applicable,
    openable: applicable,
    period_key: input.periodKey,
    period_display: input.periodKey ? formatReportingPeriodDisplayLabel(input.periodKey) : '',
    handling_method: handling.method,
    handling_method_source: handling.source,
    handling_options: SELF_EMPLOYED_NI_HANDLING_METHODS.map((id) => ({
      id,
      label_key: selfEmployedNiHandlingLabelKey(id),
      selected: handling.method === id,
    })),
    standing_order_active: handling.standing_order_active,
    standing_order_status_key: handling.standing_order_active
      ? CO_UI.reporting.ni.standingActive
      : handling.method
        ? selfEmployedNiHandlingLabelKey(handling.method)
        : CO_UI.reporting.ni.methodUnresolved,
    standing_order_provenance: 'office_recorded',
    bank_verified: false,
    authority_verified: false,
    statutory_deadline: false,
    office_reminder: selfEmployedNiOfficeReminderActive(input),
    reminder_day: SELF_EMPLOYED_NI_OFFICE_REMINDER_DAY,
    action_resolved: resolved,
    action_status_key: selfEmployedNiMonthlyStatusKey(handling.method, resolved),
    can_set_standing_order: applicable,
    can_set_handling_method: applicable,
    can_confirm_manual_resolution: canConfirmMonthHandled,
    can_confirm_month_handled: canConfirmMonthHandled,
    title_key: CO_UI.reporting.ni.title,
    client_details_key: CO_UI.reporting.ni.clientDetails,
    client_key: CO_UI.reporting.ni.client,
    month_key: CO_UI.reporting.ni.month,
    amount_key: CO_UI.reporting.ni.amount,
    handling_title_key: CO_UI.reporting.ni.handlingTitle,
    office_note_key: CO_UI.reporting.ni.standingOffice,
    resolution_key: CO_UI.reporting.ni.resolution,
    confirm_resolution_key: CO_UI.reporting.ni.monthHandled,
    month_handled_key: CO_UI.reporting.ni.monthHandled,
    save_key: CO_UI.reporting.ni.save,
    cancel_key: CO_UI.reporting.ni.cancel,
  };
}

export function isAuthoritativeLegalOverdue(dueDate: string | null | undefined, today: string): boolean {
  const due = String(dueDate ?? '').slice(0, 10);
  if (!due) return false;
  const days = calendarDaysUntilDue(due, today);
  return days != null && days < 0;
}

export function formatReportingCalendarDueDisplay(input: {
  vat_due_type: string | null | undefined;
  filing_due_date: string | null | undefined;
}): string | null {
  const dueType = String(input.vat_due_type ?? '')
    .trim()
    .toLowerCase();
  if (dueType === 'not_relevant' || dueType === '') return null;
  if (dueType === 'pcn') return 'PCN';
  const due = String(input.filing_due_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  return `${due.slice(8, 10)}.${due.slice(5, 7)}.${due.slice(0, 4)}`;
}

export function isOperationalPeriodKeyBefore(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (PERIOD_KEY_RE.test(a) && PERIOD_KEY_RE.test(b)) return a < b;
  if (YEAR_KEY_RE.test(a) && PERIOD_KEY_RE.test(b)) return a < b.slice(0, 4) || (a === b.slice(0, 4) && false);
  if (PERIOD_KEY_RE.test(a) && YEAR_KEY_RE.test(b)) return a.slice(0, 4) < b;
  return a < b;
}

export function vatBimonthlyObligationMatchesOperationalPeriod(
  obligationPeriodKey: string,
  operationalPeriodKey: string,
): boolean {
  const m = BIMONTHLY_VAT_PERIOD_RE.exec(obligationPeriodKey.trim());
  if (!m) return obligationPeriodKey === operationalPeriodKey;
  const endKey = `${m[1]}-${m[3]}`;
  return endKey === operationalPeriodKey;
}

export function obligationIdentityKey(obligationType: string, periodKey: string): string {
  return `${obligationType}::${periodKey}`;
}

/** Identities outside the current relevant set must remain untouched by recompute. */
export function historicalObligationIdentitiesToPreserve(input: {
  existingKeys: readonly string[];
  currentRelevantKeys: ReadonlySet<string>;
}): string[] {
  return input.existingKeys.filter((key) => !input.currentRelevantKeys.has(key));
}

function normalizeVatFrequency(vatFrequency: string | null | undefined): 'monthly' | 'bi_monthly' | null {
  const freq = String(vatFrequency ?? '').trim().toLowerCase();
  if (freq === 'monthly' || freq === 'חודשי') return 'monthly';
  if (freq === 'bi_monthly' || freq === 'bimonthly' || freq === 'דו חודשי' || freq === 'דו-חודשי') return 'bi_monthly';
  return null;
}

export function pickVatObligationFactForFrequency<T extends { obligation_type: string; period_key: string }>(
  facts: readonly T[],
  operationalPeriodKey: string,
  vatFrequency?: string | null,
): T | null {
  const matches = facts.filter((f) => f.obligation_type === 'vat_report');
  const freq = normalizeVatFrequency(vatFrequency);
  if (freq === 'monthly') {
    return matches.find((f) => f.period_key === operationalPeriodKey) ?? null;
  }
  if (freq === 'bi_monthly') {
    return (
      matches.find((f) =>
        BIMONTHLY_VAT_PERIOD_RE.test(f.period_key) &&
        vatBimonthlyObligationMatchesOperationalPeriod(f.period_key, operationalPeriodKey),
      ) ?? null
    );
  }
  return (
    matches.find((f) => f.period_key === operationalPeriodKey) ??
    matches.find((f) =>
      BIMONTHLY_VAT_PERIOD_RE.test(f.period_key) &&
      vatBimonthlyObligationMatchesOperationalPeriod(f.period_key, operationalPeriodKey),
    ) ??
    null
  );
}

export function vatFilingPeriodIdentityForOperationalPeriod(input: {
  vat_frequency: string | null | undefined;
  operational_period_key: string;
}): { period_key: string } | null {
  const freq = String(input.vat_frequency ?? '').trim().toLowerCase();
  const parsed = parseReportingPeriodKey(input.operational_period_key);
  if (!parsed) return null;
  if (freq === 'monthly') return { period_key: input.operational_period_key };
  if (freq === 'bi_monthly') {
    if (parsed.month % 2 !== 0) return null;
    const startMonth = parsed.month - 1;
    return {
      period_key: `${parsed.year}-${String(startMonth).padStart(2, '0')}-${String(parsed.month).padStart(2, '0')}`,
    };
  }
  return null;
}

export function canonicalVatObligationId(input: {
  obligationPeriodKey: string | null;
  operationalPeriodKey: string;
  vatFrequency: string | null | undefined;
}): string {
  if (input.obligationPeriodKey && BIMONTHLY_VAT_PERIOD_RE.test(input.obligationPeriodKey)) {
    return `vat_report::${input.obligationPeriodKey}`;
  }
  const identity = vatFilingPeriodIdentityForOperationalPeriod({
    vat_frequency: input.vatFrequency,
    operational_period_key: input.operationalPeriodKey,
  });
  if (identity) return `vat_report::${identity.period_key}`;
  return `vat_report::${input.operationalPeriodKey}`;
}

export function resolveVatCalendarLookupPeriodKey(input: {
  vat_frequency: string | null | undefined;
  operational_period_key: string;
}): string | null {
  const freq = String(input.vat_frequency ?? '').trim().toLowerCase();
  if (freq === 'monthly') return input.operational_period_key;
  if (freq === 'bi_monthly') {
    const parsed = parseReportingPeriodKey(input.operational_period_key);
    if (!parsed || parsed.month % 2 !== 0) return null;
    return input.operational_period_key;
  }
  return null;
}

export function resolveVatCalendarObligationKey(input: {
  vat_type: string | null | undefined;
  vat_due_type: string | null | undefined;
}): string | null {
  return resolveVatObligationKeyFromClientTaxSettings({
    vat_type: input.vat_type,
    vat_due_type: input.vat_due_type,
  });
}

export function lookupCalendarDueDate(
  entries: ReadonlyMap<string, string>,
  obligationKey: string | null,
  reportingPeriodKey: string | null,
): string | null {
  if (!obligationKey || !reportingPeriodKey) return null;
  return entries.get(`${obligationKey}::${reportingPeriodKey}`) ?? null;
}

export function calendarDueMapKey(obligationKey: string, reportingPeriodKey: string): string {
  return `${obligationKey}::${reportingPeriodKey}`;
}

export function incomeTaxAdvancesCalendarKey(): string {
  return incomeTaxAdvancesObligationKey();
}

export function incomeTaxDeductionsCalendarKey(): string {
  return incomeTaxDeductionsObligationKey();
}

export function annualAppliesToOperationalPeriod(input: {
  due_date: string | null;
  operational_period_key: string;
}): boolean {
  const due = String(input.due_date ?? '').slice(0, 7);
  return Boolean(due) && due === input.operational_period_key;
}

export function pickObligationForKind(
  facts: readonly ClientOperationsReportingFilingFact[],
  kind: ClientOperationsReportingObligationKind,
  operationalPeriodKey: string,
  vatFrequency?: string | null,
): ClientOperationsReportingFilingFact | null {
  const types = obligationTypesForKind(kind);
  const matches = facts.filter((f) => types.includes(f.obligation_type));
  if (kind === 'vat') {
    return pickVatObligationFactForFrequency(matches, operationalPeriodKey, vatFrequency);
  }
  if (kind === 'annual') {
    return (
      matches.find((f) => annualAppliesToOperationalPeriod({ due_date: f.due_date, operational_period_key: operationalPeriodKey })) ??
      null
    );
  }
  return matches.find((f) => f.period_key === operationalPeriodKey) ?? null;
}

export function obligationTypesForKind(kind: ClientOperationsReportingObligationKind): string[] {
  switch (kind) {
    case 'vat':
      return ['vat_report'];
    case 'income_tax_advance':
      return ['income_tax_advance'];
    case 'payroll':
      return ['payroll_data', 'payroll_submission'];
    case 'national_insurance':
      return ['national_insurance_self_employed_payment'];
    case 'income_tax_deductions':
      return ['income_tax_deductions'];
    case 'national_insurance_deductions':
      return [];
    case 'annual':
      return ['annual_report'];
  }
}

export function buildReportingCellInputFromFacts(input: {
  kind: ClientOperationsReportingObligationKind;
  applicable: boolean;
  submittedOverride?: boolean | null;
  notApplicableOverride?: boolean;
  operationalPeriodKey: string;
  vatFrequency?: string | null;
  facts: readonly ClientOperationsReportingFilingFact[];
  calendarDueDate: string | null;
  paymentClassification?: TaxObligationPaymentClassification | null;
  paymentDueDate?: string | null;
}): ClientOperationsReportingCellInput {
  const fact = pickObligationForKind(input.facts, input.kind, input.operationalPeriodKey, input.vatFrequency);
  const notApplicable =
    input.notApplicableOverride === true || isFilingNotApplicableStatus(fact?.status);
  const applicable = input.applicable && !notApplicable;
  const submitted =
    input.submittedOverride != null
      ? Boolean(input.submittedOverride)
      : isFilingSubmittedStatus(fact?.status);
  const dueDate = reportingKindIsInformational(input.kind)
    ? null
    : input.calendarDueDate
      ? String(input.calendarDueDate).slice(0, 10)
      : null;
  const canonicalId =
    input.kind === 'vat'
      ? canonicalVatObligationId({
          obligationPeriodKey: fact?.period_key ?? null,
          operationalPeriodKey: input.operationalPeriodKey,
          vatFrequency: input.vatFrequency,
        })
      : input.kind === 'annual'
        ? `annual_report::${(fact?.period_key || dueDate?.slice(0, 4) || input.operationalPeriodKey.slice(0, 4))}`
        : `${input.kind}::${input.operationalPeriodKey}`;
  return {
    kind: input.kind,
    applicable,
    submitted: applicable && submitted,
    not_applicable_terminal: notApplicable,
    due_date: applicable ? dueDate : null,
    canonical_id: canonicalId,
    obligation_id: fact?.obligation_id ?? null,
    can_mark_submitted: Boolean(applicable && fact?.obligation_id && canMarkObligationSubmitted(fact.status) && !submitted),
    can_mark_not_submitted: Boolean(applicable && fact?.obligation_id && submitted),
    last_reported_at: fact?.last_reported_at ?? null,
    operational_period_key: input.operationalPeriodKey,
    payment_classification: input.paymentClassification ?? null,
    payment_due_date: input.paymentDueDate ?? null,
    payment_applies: paymentAppliesForReportingKind(input.kind),
  };
}

export function resolvePreviousPeriodVatCalendarDue(input: {
  vat_frequency: string | null | undefined;
  vat_type: string | null | undefined;
  vat_due_type: string | null | undefined;
  operational_period_key: string;
  calendarDueByKey: ReadonlyMap<string, string>;
}): string | null {
  const lookup = resolveVatCalendarLookupPeriodKey({
    vat_frequency: input.vat_frequency,
    operational_period_key: input.operational_period_key,
  });
  const obligationKey = resolveVatCalendarObligationKey({
    vat_type: input.vat_type,
    vat_due_type: input.vat_due_type,
  });
  return lookupCalendarDueDate(input.calendarDueByKey, obligationKey, lookup);
}

export type ClientOperationsPreviousPeriodFact = {
  period_key: string;
  navigate_period_key: string;
  kind: 'month' | 'year';
  applicable_incomplete: boolean;
  overdue: boolean;
};

export function buildPreviousIncompletePeriods(input: {
  selected_period_key: string;
  facts: readonly ClientOperationsPreviousPeriodFact[];
}): ClientOperationsReportingPreviousPeriods {
  const byKey = new Map<string, ClientOperationsReportingPreviousPeriodItem>();
  for (const fact of input.facts) {
    if (!fact.applicable_incomplete) continue;
    if (!isOperationalPeriodKeyBefore(fact.period_key, input.selected_period_key) && fact.kind === 'month') {
      continue;
    }
    if (fact.kind === 'year') {
      const year = Number(fact.period_key);
      const selectedYear = Number(input.selected_period_key.slice(0, 4));
      if (!Number.isFinite(year) || year > selectedYear) continue;
      if (year === selectedYear && PERIOD_KEY_RE.test(input.selected_period_key)) {
        // Year-identity still open is previous only when its navigate month is before the selected tab.
        if (!isOperationalPeriodKeyBefore(fact.navigate_period_key, input.selected_period_key)) continue;
      }
    }
    const existing = byKey.get(fact.period_key);
    if (existing) {
      existing.overdue = existing.overdue || fact.overdue;
      continue;
    }
    byKey.set(fact.period_key, {
      period_key: fact.period_key,
      navigate_period_key: fact.navigate_period_key,
      display_label: formatReportingPeriodDisplayLabel(fact.period_key),
      kind: fact.kind,
      incomplete: true,
      overdue: fact.overdue,
    });
  }
  const periods = [...byKey.values()].sort((a, b) => {
    if (a.period_key === b.period_key) return 0;
    return a.period_key.localeCompare(b.period_key);
  });
  return {
    incomplete_count: periods.length,
    overdue_count: periods.filter((p) => p.overdue).length,
    periods,
  };
}

export function reportingSortIdFromQuery(sortBy: string | null | undefined): ClientOperationsReportingSortId {
  const raw = String(sortBy ?? '').trim();
  if (raw === 'client_name') return 'client_name';
  if (raw === 'period_created' || raw === 'folder') return 'period_created';
  return 'priority';
}

export function buildReportingSortOptions(): Array<{
  id: ClientOperationsReportingSortId;
  label_key: string;
}> {
  return [
    { id: 'priority', label_key: CO_UI.reporting.sortPriority },
    { id: 'client_name', label_key: CO_UI.reporting.sortClientName },
  ];
}

export function buildReportingDashboard(input: {
  rows: ReportingKpiRowInput[];
  previous_periods: ClientOperationsReportingPreviousPeriods;
  sort_by: string | null | undefined;
  kpi_filter: string | null | undefined;
  selected_period_key?: string | null;
  outstanding_period_facts?: readonly PaymentsOutstandingPeriodFact[];
}): ClientOperationsReportingDashboard {
  return {
    kpi_cards: buildReportingKpiCards(input.rows),
    payments_outstanding_kpi: buildPaymentsOutstandingKpi({
      rows: input.rows,
      outstanding_period_facts: input.outstanding_period_facts ?? [],
      selected_period_key: input.selected_period_key ?? '',
    }),
    previous_periods: input.previous_periods,
    sort_options: buildReportingSortOptions(),
    active_sort: reportingSortIdFromQuery(input.sort_by),
    active_kpi_filter: isClientOperationsReportingFilterId(input.kpi_filter) ? input.kpi_filter : null,
  };
}
