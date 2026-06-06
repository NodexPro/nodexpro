/**
 * Pure helpers for income recurring document profiles (retainer templates).
 * TEMPORARY_ACCOUNTING_BASE_PENDING — amounts are reference templates until draft issue/posting.
 */

export type RecurringDocumentFrequency = 'monthly' | 'semi_annual' | 'yearly';
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

export function addMonthsToDate(iso: string, months: number): string {
  const { y, m, d } = parseIsoDateOnly(iso);
  let total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = clampDay(ny, nm, d);
  return formatIsoDateOnly(ny, nm, nd);
}

export function advanceServicePeriod(params: {
  service_period_start: string;
  service_period_end: string;
  frequency: RecurringDocumentFrequency;
}): { service_period_start: string; service_period_end: string; next_document_date: string } {
  const months =
    params.frequency === 'monthly' ? 1 : params.frequency === 'semi_annual' ? 6 : 12;
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

export const RECURRING_SCHEDULER_STATUS = 'scheduler_pending' as const;

export const RECURRING_WORK_EVENT_TYPE = 'recurring_document_draft_created' as const;
export const RECURRING_WORK_TYPE = 'recurring_invoice_review' as const;
