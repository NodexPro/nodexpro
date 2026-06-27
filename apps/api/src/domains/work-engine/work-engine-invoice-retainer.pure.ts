/**
 * Pure helpers for income recurring document profiles (retainer templates).
 * TEMPORARY_ACCOUNTING_BASE_PENDING — amounts are reference templates until draft issue/posting.
 */

export type RecurringDocumentFrequency =
  | 'days_30'
  | 'days_45'
  | 'days_60'
  | 'days_90'
  | 'monthly'
  | 'semi_annual'
  | 'yearly'
  | 'biennial';

export const RECURRING_FREQUENCY_OPTIONS: ReadonlyArray<{
  key: RecurringDocumentFrequency;
  label: string;
}> = [
  { key: 'days_30', label: '30 ימים' },
  { key: 'days_45', label: '45 ימים' },
  { key: 'days_60', label: '60 ימים' },
  { key: 'days_90', label: '90 ימים' },
  { key: 'monthly', label: 'חודשי' },
  { key: 'semi_annual', label: 'חצי שנתי' },
  { key: 'yearly', label: 'שנתי' },
  { key: 'biennial', label: 'שנתיים' },
] as const;

export const RECURRING_FREQUENCY_LABELS: Record<RecurringDocumentFrequency, string> =
  Object.fromEntries(RECURRING_FREQUENCY_OPTIONS.map((o) => [o.key, o.label])) as Record<
    RecurringDocumentFrequency,
    string
  >;
export type RecurringProfileStatus = 'active' | 'paused' | 'cancelled';
export type RecurringPriceIncreaseType = 'percent' | 'amount';

export function parseIsoDateOnly(raw: string): { y: number; m: number; d: number } {
  const s = String(raw ?? '').trim().slice(0, 10);
  const [y, m, d] = s.split('-').map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error('invalid date');
  }
  return { y, m, d };
}

export function formatIsoDateOnly(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatHebrewDateDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const { y, m, d } = parseIsoDateOnly(iso);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

export function addDaysToDate(iso: string, days: number): string {
  const { y, m, d } = parseIsoDateOnly(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIsoDateOnly(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonthsToDate(iso: string, months: number): string {
  const { y, m, d } = parseIsoDateOnly(iso);
  let total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = clampDay(ny, nm, d);
  return formatIsoDateOnly(ny, nm, nd);
}

function frequencyAdvanceDays(frequency: RecurringDocumentFrequency): number | null {
  if (frequency === 'days_30') return 30;
  if (frequency === 'days_45') return 45;
  if (frequency === 'days_60') return 60;
  if (frequency === 'days_90') return 90;
  return null;
}

function frequencyAdvanceMonths(frequency: RecurringDocumentFrequency): number {
  if (frequency === 'monthly') return 1;
  if (frequency === 'semi_annual') return 6;
  if (frequency === 'biennial') return 24;
  return 12;
}

export function advanceServicePeriod(params: {
  service_period_start: string;
  service_period_end: string;
  frequency: RecurringDocumentFrequency;
}): { service_period_start: string; service_period_end: string; next_document_date: string } {
  const dayStep = frequencyAdvanceDays(params.frequency);
  if (dayStep != null) {
    const nextStart = addDaysToDate(params.service_period_start, dayStep);
    const nextEnd = addDaysToDate(params.service_period_end, dayStep);
    return {
      service_period_start: nextStart,
      service_period_end: nextEnd,
      next_document_date: nextStart,
    };
  }
  const months = frequencyAdvanceMonths(params.frequency);
  const nextStart = addMonthsToDate(params.service_period_start, months);
  const nextEnd = addMonthsToDate(params.service_period_end, months);
  return {
    service_period_start: nextStart,
    service_period_end: nextEnd,
    next_document_date: nextStart,
  };
}

export function computeDraftCreationDateIso(nextDocumentDate: string, advanceDays: number): string {
  const { y, m, d } = parseIsoDateOnly(nextDocumentDate);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - advanceDays);
  return formatIsoDateOnly(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function computeNextUnitPriceBeforeVat(params: {
  current_unit_price_before_vat_reference: number;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | null;
  price_increase_value: number | null;
}): number {
  const current = params.current_unit_price_before_vat_reference;
  if (!params.price_increase_enabled || !params.price_increase_type || params.price_increase_value == null) {
    return current;
  }
  if (params.price_increase_type === 'percent') {
    return Math.round((current * (1 + params.price_increase_value / 100)) * 100) / 100;
  }
  return Math.round((current + params.price_increase_value) * 100) / 100;
}

export const RECURRING_SCHEDULER_STATUS_PENDING = 'scheduler_pending' as const;
export const RECURRING_SCHEDULER_STATUS_ACTIVE = 'active' as const;
export const RECURRING_SCHEDULER_STATUS_FAILED = 'failed' as const;
export type RecurringSchedulerStatus =
  | typeof RECURRING_SCHEDULER_STATUS_PENDING
  | typeof RECURRING_SCHEDULER_STATUS_ACTIVE
  | typeof RECURRING_SCHEDULER_STATUS_FAILED;

/** @deprecated use RECURRING_SCHEDULER_STATUS_PENDING */
export const RECURRING_SCHEDULER_STATUS = RECURRING_SCHEDULER_STATUS_PENDING;

export const RECURRING_WORK_EVENT_TYPE = 'recurring_document_draft_created' as const;
export const RECURRING_WORK_TYPE = 'recurring_invoice_review' as const;
export const RECURRING_FAILURE_EVENT_TYPE = 'recurring_generation_failed' as const;
export const RECURRING_FAILURE_WORK_TYPE = 'recurring_generation_failed' as const;

export const RECURRING_APPROVED_EVENT_TYPE = 'recurring_document_approved' as const;
export const RECURRING_SEND_FOLLOWUP_EVENT_TYPE = 'recurring_document_send_followup_due' as const;
export const RECURRING_SEND_FOLLOWUP_WORK_TYPE = 'recurring_document_send_followup' as const;

export const RECURRING_SEND_FOLLOWUP_DELAY_DAYS = 2;

export const RECURRING_WORK_ENGINE_SOURCE_MODULE = 'work_engine' as const;
export const RECURRING_WORK_ENGINE_ENTITY_TYPE = 'income_recurring_document_profile' as const;
export const RECURRING_WORK_ENGINE_SCHEMA_VERSION = 1;

export function isRecurringProfileDueForDraftGeneration(params: {
  today_iso: string;
  next_document_date: string;
  advance_days: number;
}): boolean {
  const draftCreationDate = computeDraftCreationDateIso(params.next_document_date, params.advance_days);
  return params.today_iso >= draftCreationDate;
}

export function buildRecurringSchedulerCycleKey(profileId: string, scheduledDocumentDate: string): string {
  return `${profileId}:${scheduledDocumentDate}`;
}

/** Synthetic workflow bucket per profile cycle — satisfies work_items.period_key regex. */
export function recurringProfileWorkPeriodKey(profileId: string, scheduledDocumentDate: string): string {
  return `retainer:profile:${profileId}:cycle:${scheduledDocumentDate}`;
}
