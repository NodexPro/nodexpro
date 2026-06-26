/**
 * Retainer schedule tab — projected future invoice dates (read-model only).
 */

import {
  addDaysToDate,
  addMonthsToDate,
  formatHebrewDateDisplay,
  type RecurringDocumentFrequency,
} from './work-engine-invoice-retainer.pure.js';

export const SCHEDULE_PROJECTION_YEARS_FORWARD = 5;

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

export function advanceScheduledDocumentDate(
  current: string,
  frequency: RecurringDocumentFrequency,
): string {
  const dayStep = frequencyAdvanceDays(frequency);
  if (dayStep != null) return addDaysToDate(current, dayStep);
  return addMonthsToDate(current, frequencyAdvanceMonths(frequency));
}

export function resolveScheduleStartDate(params: {
  templateDocumentDate: string | null;
  servicePeriodStart: string | null;
  nextDocumentDate: string | null;
}): string | null {
  const raw =
    params.templateDocumentDate ?? params.servicePeriodStart ?? params.nextDocumentDate ?? null;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

export function resolveScheduleHorizonEndDate(scheduleStartDate: string): string {
  return addMonthsToDate(scheduleStartDate, 12 * SCHEDULE_PROJECTION_YEARS_FORWARD);
}

export function resolveScheduleEndDate(params: {
  scheduleStartDate: string;
  servicePeriodEnd: string | null;
}): string {
  const horizonEnd = resolveScheduleHorizonEndDate(params.scheduleStartDate);
  const end = params.servicePeriodEnd;
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return horizonEnd;
  return end < horizonEnd ? end : horizonEnd;
}

export function generateProjectedScheduleDates(params: {
  scheduleStartDate: string;
  scheduleEndDate: string;
  frequency: RecurringDocumentFrequency;
  includeFutureProjections: boolean;
}): string[] {
  if (!params.includeFutureProjections) return [];

  const dates: string[] = [];
  let current = params.scheduleStartDate;
  const maxIterations = 500;
  let iterations = 0;

  while (current <= params.scheduleEndDate && iterations < maxIterations) {
    dates.push(current);
    const next = advanceScheduledDocumentDate(current, params.frequency);
    if (next <= current) break;
    current = next;
    iterations += 1;
  }

  return dates;
}

export function groupScheduleDatesByYear(dates: string[]): Array<{ year: number; dates: string[] }> {
  const byYear = new Map<number, string[]>();
  for (const iso of dates) {
    const year = Number(iso.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const bucket = byYear.get(year) ?? [];
    bucket.push(iso);
    byYear.set(year, bucket);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, yearDates]) => ({ year, dates: yearDates.sort() }));
}

export function formatScheduleYearDocumentsCountLabel(count: number): string {
  if (count === 1) return 'מסמך אחד';
  return `${count} מסמכים`;
}

export function formatScheduleProjectionKey(profileId: string, scheduledDocumentDate: string): string {
  return `${profileId}:${scheduledDocumentDate}`;
}

export function formatScheduleRowDateDisplay(iso: string): string {
  return formatHebrewDateDisplay(iso);
}
