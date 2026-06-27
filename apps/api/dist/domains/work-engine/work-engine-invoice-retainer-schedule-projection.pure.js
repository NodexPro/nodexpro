/**
 * Retainer schedule tab — projected future invoice dates (read-model only).
 */
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import { todayIsoDate } from '../income/income-retainer-template-document-date.pure.js';
import { addDaysToDate, addMonthsToDate, computeNextUnitPriceBeforeVat, formatHebrewDateDisplay, } from './work-engine-invoice-retainer.pure.js';
export const SCHEDULE_PROJECTION_YEARS_FORWARD = 5;
function frequencyAdvanceDays(frequency) {
    if (frequency === 'days_30')
        return 30;
    if (frequency === 'days_45')
        return 45;
    if (frequency === 'days_60')
        return 60;
    if (frequency === 'days_90')
        return 90;
    return null;
}
function frequencyAdvanceMonths(frequency) {
    if (frequency === 'monthly')
        return 1;
    if (frequency === 'semi_annual')
        return 6;
    if (frequency === 'biennial')
        return 24;
    return 12;
}
export function advanceScheduledDocumentDate(current, frequency) {
    const dayStep = frequencyAdvanceDays(frequency);
    if (dayStep != null)
        return addDaysToDate(current, dayStep);
    return addMonthsToDate(current, frequencyAdvanceMonths(frequency));
}
export function resolveScheduleStartDate(params) {
    const raw = params.templateDocumentDate ?? params.servicePeriodStart ?? params.nextDocumentDate ?? null;
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
        return null;
    return raw;
}
export function resolveScheduleHorizonEndDate(scheduleStartDate) {
    return addMonthsToDate(scheduleStartDate, 12 * SCHEDULE_PROJECTION_YEARS_FORWARD);
}
export function resolveScheduleEndDate(params) {
    const horizonEnd = resolveScheduleHorizonEndDate(params.scheduleStartDate);
    const end = params.servicePeriodEnd;
    if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end))
        return horizonEnd;
    return end < horizonEnd ? end : horizonEnd;
}
export function generateProjectedScheduleDates(params) {
    if (!params.includeFutureProjections)
        return [];
    const dates = [];
    let current = params.scheduleStartDate;
    const maxIterations = 500;
    let iterations = 0;
    while (current <= params.scheduleEndDate && iterations < maxIterations) {
        dates.push(current);
        const next = advanceScheduledDocumentDate(current, params.frequency);
        if (next <= current)
            break;
        current = next;
        iterations += 1;
    }
    return dates;
}
export function groupScheduleDatesByYear(dates) {
    const byYear = new Map();
    for (const iso of dates) {
        const year = Number(iso.slice(0, 4));
        if (!Number.isFinite(year))
            continue;
        const bucket = byYear.get(year) ?? [];
        bucket.push(iso);
        byYear.set(year, bucket);
    }
    return [...byYear.entries()]
        .sort(([a], [b]) => a - b)
        .map(([year, yearDates]) => ({ year, dates: yearDates.sort() }));
}
export function formatScheduleYearDocumentsCountLabel(count) {
    if (count === 1)
        return 'מסמך אחד';
    return `${count} מסמכים`;
}
export function formatScheduleProjectionKey(profileId, scheduledDocumentDate) {
    return `${profileId}:${scheduledDocumentDate}`;
}
export function formatScheduleRowDateDisplay(iso) {
    return formatHebrewDateDisplay(iso);
}
function reverseOneUnitPriceIncrease(params) {
    if (params.price_increase_type === 'percent') {
        const factor = 1 + params.price_increase_value / 100;
        if (!Number.isFinite(factor) || factor <= 0)
            return params.increasedUnitPrice;
        return Math.round((params.increasedUnitPrice / factor) * 100) / 100;
    }
    return Math.round((params.increasedUnitPrice - params.price_increase_value) * 100) / 100;
}
/** Immutable template anchor — scheduler may advance profile.unit_price_before_vat_reference after generation. */
export function resolveScheduleProjectionBaseUnitPrice(params) {
    const lines = normalizeDraftLines(params.document_template_snapshot?.draft_lines_json ?? []);
    if (lines.length > 0) {
        const fromSnapshot = lines[0].unit_price_reference;
        if (fromSnapshot != null && Number.isFinite(fromSnapshot) && fromSnapshot >= 0) {
            return fromSnapshot;
        }
    }
    let price = params.unit_price_before_vat_reference;
    if (!params.price_increase_enabled ||
        !params.price_increase_type ||
        params.price_increase_value == null ||
        params.completed_generation_count <= 0) {
        return price;
    }
    for (let i = 0; i < params.completed_generation_count; i += 1) {
        price = reverseOneUnitPriceIncrease({
            increasedUnitPrice: price,
            price_increase_type: params.price_increase_type,
            price_increase_value: params.price_increase_value,
        });
    }
    return price;
}
/** cycleIndex 0 = first/generated cycle (no increase); 1 = first +2%, etc. */
export function unitPriceForScheduleCycleIndex(params) {
    let unitPrice = params.base_unit_price_before_vat;
    if (!params.price_increase_enabled || params.cycle_index <= 0)
        return unitPrice;
    for (let i = 0; i < params.cycle_index; i += 1) {
        unitPrice = computeNextUnitPriceBeforeVat({
            current_unit_price_before_vat_reference: unitPrice,
            price_increase_enabled: params.price_increase_enabled,
            price_increase_type: params.price_increase_type,
            price_increase_value: params.price_increase_value,
        });
    }
    return unitPrice;
}
export function countCompletedRecurringGenerations(cycles) {
    return cycles.filter((cycle) => cycle.status === 'draft_created' || cycle.status === 'issued').length;
}
export function mergeScheduleDates(params) {
    const merged = new Set(params.projectedDates);
    for (const cycle of params.cycles) {
        merged.add(cycle.scheduled_document_date);
    }
    return [...merged].sort();
}
function isFutureScheduledScheduleRow(cycle) {
    if (!cycle)
        return true;
    if (cycle.status === 'issued' || cycle.generated_document_id)
        return false;
    if (cycle.status === 'cancelled' || cycle.status === 'failed')
        return false;
    return true;
}
/** First projected row after today that is still scheduled (not issued/failed/skipped). */
export function resolveNextScheduleSummaryDocumentDate(params) {
    for (const scheduledDate of params.allDates) {
        if (scheduledDate <= params.today)
            continue;
        if (!isFutureScheduledScheduleRow(params.cyclesByDate.get(scheduledDate)))
            continue;
        return scheduledDate;
    }
    return null;
}
/** Shared read-model source for "המסמך הבא" across Schedule + Next Document tabs. */
export function resolveProjectedNextScheduleDate(params) {
    const today = params.todayIso ?? todayIsoDate();
    const scheduleStartDate = resolveScheduleStartDate({
        templateDocumentDate: params.templateDocumentDate,
        servicePeriodStart: params.servicePeriodStart,
        nextDocumentDate: params.nextDocumentDate,
    });
    if (!scheduleStartDate)
        return null;
    const scheduleEndDate = resolveScheduleEndDate({
        scheduleStartDate,
        servicePeriodEnd: params.servicePeriodEnd,
    });
    const includeFutureProjections = params.profileStatus !== 'cancelled';
    const projectedDates = generateProjectedScheduleDates({
        scheduleStartDate,
        scheduleEndDate,
        frequency: params.frequency,
        includeFutureProjections,
    });
    const allDates = mergeScheduleDates({
        projectedDates,
        cycles: params.cycles,
    }).filter((iso) => iso >= scheduleStartDate && iso <= scheduleEndDate);
    const cyclesByDate = new Map(params.cycles.map((cycle) => [
        cycle.scheduled_document_date,
        {
            status: cycle.status,
            generated_document_id: cycle.generated_document_id,
        },
    ]));
    return resolveNextScheduleSummaryDocumentDate({
        allDates,
        today,
        cyclesByDate,
    });
}
