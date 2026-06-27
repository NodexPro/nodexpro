/**
 * Retainer — schedule tab projection (read-model only).
 */
import { normalizeDraftLines, formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { computeDraftTotalsPreview, parseDocumentSettingsJson, } from '../income/income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import { recurringProfileWorkPeriodKey, } from './work-engine-invoice-retainer.pure.js';
import { todayIsoDate } from '../income/income-retainer-template-document-date.pure.js';
import { resolveScheduleRowStatus, } from './work-engine-invoice-retainer-schedule-row-status.pure.js';
import { resolveScheduleRowMachineState } from './work-engine-invoice-retainer-schedule-row-machine.pure.js';
import { resolveScheduleRowPrimaryAction } from './work-engine-invoice-retainer-schedule-row-primary-action.pure.js';
import { countCompletedRecurringGenerations, formatScheduleProjectionKey, formatScheduleRowDateDisplay, formatScheduleYearDocumentsCountLabel, generateProjectedScheduleDates, groupScheduleDatesByYear, mergeScheduleDates, resolveNextScheduleSummaryDocumentDate, resolveProjectedNextScheduleDate, resolveScheduleEndDate, resolveScheduleProjectionBaseUnitPrice, resolveScheduleStartDate, unitPriceForScheduleCycleIndex, } from './work-engine-invoice-retainer-schedule-projection.pure.js';
const SKIP_PERSISTENCE_DISABLED_REASON = 'שמירת דילוג תתווסף בשלב הבא';
const FUTURE_ACTION_DISABLED_REASON = 'יתווסף בשלב הבא';
const DOCUMENT_TYPE_LABELS = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
};
function buildRowMenuActions(statusKey, scheduledDate, today, workItemHref, hasPrimaryAction) {
    const actionBase = {
        disabled: false,
        disabled_reason: null,
        href: null,
        income_command: null,
        income_command_payload: null,
    };
    const openDocument = {
        key: 'open_document',
        label: 'פתח מסמך',
        disabled: true,
        disabled_reason: FUTURE_ACTION_DISABLED_REASON,
        href: null,
        income_command: null,
        income_command_payload: null,
    };
    const viewHistory = {
        key: 'view_history',
        label: 'הצג היסטוריה',
        disabled: true,
        disabled_reason: FUTURE_ACTION_DISABLED_REASON,
        href: null,
        income_command: null,
        income_command_payload: null,
    };
    if (statusKey === 'waiting_review' && hasPrimaryAction) {
        return [
            {
                key: 'open_recurring_cycle_draft_for_review',
                label: 'פתח טיוטה לבדיקה',
                ...actionBase,
            },
            openDocument,
            viewHistory,
        ];
    }
    if (statusKey === 'waiting_review' && workItemHref) {
        return [
            {
                key: 'open_work_engine_task',
                label: 'פתח משימה במכונה',
                ...actionBase,
                href: workItemHref,
            },
            openDocument,
            viewHistory,
        ];
    }
    if (statusKey === 'skipped') {
        return [
            {
                key: 'unskip_cycle',
                label: 'בטל דילוג',
                disabled: true,
                disabled_reason: SKIP_PERSISTENCE_DISABLED_REASON,
                href: null,
                income_command: null,
                income_command_payload: null,
            },
            openDocument,
            viewHistory,
        ];
    }
    if (statusKey === 'issued') {
        return [openDocument, viewHistory];
    }
    if (statusKey === 'failed') {
        if (workItemHref) {
            return [
                {
                    key: 'open_work_engine_task',
                    label: 'פתח משימה במכונה',
                    ...actionBase,
                    href: workItemHref,
                },
                viewHistory,
            ];
        }
        return [viewHistory];
    }
    if (statusKey === 'scheduled' && scheduledDate > today) {
        return [
            {
                key: 'skip_cycle',
                label: 'דלג',
                disabled: true,
                disabled_reason: SKIP_PERSISTENCE_DISABLED_REASON,
                href: null,
                income_command: null,
                income_command_payload: null,
            },
            openDocument,
            viewHistory,
        ];
    }
    return [];
}
function buildRowActions(statusKey, scheduledDate, today, workItemHref, hasPrimaryAction) {
    return buildRowMenuActions(statusKey, scheduledDate, today, workItemHref, hasPrimaryAction);
}
function buildRecurrenceRuleDisplay(frequency, startDisplay) {
    const from = `החל מ־${startDisplay}`;
    if (frequency === 'days_30')
        return `כל 30 ימים ${from}`;
    if (frequency === 'days_45')
        return `כל 45 ימים ${from}`;
    if (frequency === 'days_60')
        return `כל 60 ימים ${from}`;
    if (frequency === 'days_90')
        return `כל 90 ימים ${from}`;
    if (frequency === 'monthly')
        return `כל חודש ${from}`;
    if (frequency === 'semi_annual')
        return `פעמיים בשנה ${from}`;
    if (frequency === 'yearly')
        return `אחת לשנה ${from}`;
    if (frequency === 'biennial')
        return `אחת לשנתיים ${from}`;
    return from;
}
async function computeScheduleAmount(params) {
    params.profiling && (params.profiling.computeAmountCalls += 1);
    if (params.cycleIndex > 0 &&
        params.nextDocumentPreview?.status === 'ready' &&
        params.projectedNextDocumentDate === params.documentDate &&
        params.nextDocumentPreview.document_details_step?.totals_block?.grand_total_display) {
        params.profiling && (params.profiling.previewShortcutCalls += 1);
        const display = params.nextDocumentPreview.document_details_step.totals_block.grand_total_display;
        const parsed = Number(String(display).replace(/[^\d.-]/g, ''));
        return {
            amount_display: display,
            grand_total_reference: Number.isFinite(parsed) ? parsed : 0,
        };
    }
    const snapshot = params.profile.document_template_snapshot;
    const settings = parseDocumentSettingsJson(snapshot?.document_settings_json ?? null);
    const unitPrice = unitPriceForScheduleCycleIndex({
        base_unit_price_before_vat: params.baseUnitPriceBeforeVat,
        cycle_index: params.cycleIndex,
        price_increase_enabled: params.profile.price_increase_enabled,
        price_increase_type: params.profile.price_increase_type,
        price_increase_value: params.profile.price_increase_value,
    });
    const baseLines = normalizeDraftLines(snapshot?.draft_lines_json ?? []);
    const lines = baseLines.length > 0
        ? baseLines.map((line, index) => ({
            ...line,
            quantity: index === 0 ? params.profile.quantity : line.quantity,
            unit_price_reference: index === 0 ? unitPrice : line.unit_price_reference,
            currency: (index === 0 ? params.profile.currency : line.currency),
        }))
        : normalizeDraftLines([
            {
                description: '—',
                quantity: params.profile.quantity,
                unit_price_reference: unitPrice,
                currency: params.profile.currency,
            },
        ]);
    const vatStartMs = Date.now();
    const vatResolution = await resolveIncomeDraftVatForOrg(params.orgId, 'IL', params.documentDate);
    if (params.profiling) {
        params.profiling.vatResolveCalls += 1;
        params.profiling.vatResolveMs += Date.now() - vatStartMs;
    }
    const totalsStartMs = Date.now();
    const totalsPreview = await computeDraftTotalsPreview(lines, params.profile.currency, settings, vatResolution, params.documentDate);
    if (params.profiling) {
        params.profiling.totalsPreviewCalls += 1;
        params.profiling.totalsPreviewMs += Date.now() - totalsStartMs;
    }
    return {
        amount_display: totalsPreview.grand_total_display,
        grand_total_reference: totalsPreview.grand_total_reference ?? 0,
    };
}
function mergeScheduleDatesFromCycles(params) {
    return mergeScheduleDates({
        projectedDates: params.projectedDates,
        cycles: params.cycles.map((cycle) => ({
            scheduled_document_date: cycle.scheduled_document_date,
            status: cycle.status,
            generated_document_id: cycle.generated_document_id,
        })),
    });
}
export function buildScheduleSetupTab(profileId) {
    const enabled = Boolean(profileId);
    return {
        key: 'schedule',
        label: 'לוח זמנים',
        enabled,
        disabled_reason: enabled ? null : 'שמור ריטיינר כדי לראות את לוח הזמנים.',
    };
}
export async function buildRetainerScheduleProjection(params) {
    if (!params.profile || !params.retainerSettings?.profile_id) {
        return {
            status: 'unavailable',
            unavailable_message: 'שמור ריטיינר כדי לראות את לוח הזמנים.',
            summary: null,
            recurrence_rule_display: null,
            default_expanded_year: null,
            years: [],
        };
    }
    const today = params.todayIso ?? todayIsoDate();
    const dateProjectionStartMs = Date.now();
    const scheduleStartDate = resolveScheduleStartDate({
        templateDocumentDate: params.profile.document_template_snapshot?.document_date ?? null,
        servicePeriodStart: params.profile.service_period_start,
        nextDocumentDate: params.profile.next_document_date,
    });
    if (!scheduleStartDate) {
        return {
            status: 'unavailable',
            unavailable_message: 'לא ניתן לחשב לוח זמנים ללא תאריך התחלה.',
            summary: null,
            recurrence_rule_display: null,
            default_expanded_year: null,
            years: [],
        };
    }
    const scheduleStartDisplay = formatScheduleRowDateDisplay(scheduleStartDate);
    const recurrenceRuleDisplay = buildRecurrenceRuleDisplay(params.profile.frequency, scheduleStartDisplay);
    const currentYear = Number(today.slice(0, 4));
    const scheduleEndDate = resolveScheduleEndDate({
        scheduleStartDate,
        servicePeriodEnd: params.profile.service_period_end,
    });
    const includeFutureProjections = params.profile.status !== 'cancelled';
    const projectedDates = generateProjectedScheduleDates({
        scheduleStartDate,
        scheduleEndDate,
        frequency: params.profile.frequency,
        includeFutureProjections,
    });
    const allDates = mergeScheduleDatesFromCycles({
        projectedDates,
        cycles: params.cycles,
    }).filter((iso) => iso >= scheduleStartDate && iso <= scheduleEndDate);
    const projectedNextDocumentDate = params.projectedNextDocumentDate !== undefined
        ? params.projectedNextDocumentDate
        : resolveProjectedNextScheduleDate({
            templateDocumentDate: params.profile.document_template_snapshot?.document_date ?? null,
            servicePeriodStart: params.profile.service_period_start,
            nextDocumentDate: params.profile.next_document_date,
            servicePeriodEnd: params.profile.service_period_end,
            frequency: params.profile.frequency,
            profileStatus: params.profile.status,
            cycles: params.cycles.map((cycle) => ({
                scheduled_document_date: cycle.scheduled_document_date,
                status: cycle.status,
                generated_document_id: cycle.generated_document_id,
            })),
            todayIso: today,
        });
    const cycleByDate = new Map(params.cycles.map((cycle) => [cycle.scheduled_document_date, cycle]));
    const dateCycleIndex = new Map();
    allDates.forEach((iso, index) => dateCycleIndex.set(iso, index));
    const documentTypeLabel = params.retainerSettings.document_type_label ??
        DOCUMENT_TYPE_LABELS[params.profile.document_type];
    const baseUnitPriceBeforeVat = resolveScheduleProjectionBaseUnitPrice({
        unit_price_before_vat_reference: params.profile.unit_price_before_vat_reference,
        price_increase_enabled: params.profile.price_increase_enabled,
        price_increase_type: params.profile.price_increase_type,
        price_increase_value: params.profile.price_increase_value,
        document_template_snapshot: params.profile.document_template_snapshot,
        completed_generation_count: countCompletedRecurringGenerations(params.cycles),
    });
    const grouped = groupScheduleDatesByYear(allDates);
    params.onTiming?.(`schedule_projection date_math_ms=${Date.now() - dateProjectionStartMs} projected_dates=${projectedDates.length} all_dates=${allDates.length} projection_years=${grouped.length}`);
    const years = [];
    const amountProfiling = {
        computeAmountCalls: 0,
        previewShortcutCalls: 0,
        vatResolveCalls: 0,
        vatResolveMs: 0,
        totalsPreviewCalls: 0,
        totalsPreviewMs: 0,
    };
    const rowLoopStartMs = Date.now();
    let projectionRows = 0;
    for (const group of grouped) {
        const rows = [];
        let yearTotalReference = 0;
        for (const scheduledDate of group.dates) {
            const cycle = cycleByDate.get(scheduledDate) ?? null;
            const periodKey = recurringProfileWorkPeriodKey(params.profile.id, scheduledDate);
            const workItem = params.workItemsByPeriodKey?.get(periodKey) ?? null;
            const status = resolveScheduleRowStatus({
                cycle: cycle
                    ? {
                        status: cycle.status,
                        generated_draft_id: cycle.generated_draft_id,
                        generated_document_id: cycle.generated_document_id,
                    }
                    : null,
                workItem,
            });
            const linkedWorkItemId = workItem?.work_item_id ?? null;
            const rowInteraction = resolveScheduleRowPrimaryAction({
                status_key: status.status_key,
                represented_client_id: params.representedClientId,
                profile_id: params.profile.id,
                cycle_id: cycle?.id ?? null,
                generated_draft_id: cycle?.generated_draft_id ?? null,
                period_key: periodKey,
                linked_work_item_id: linkedWorkItemId,
            });
            const machine = resolveScheduleRowMachineState({
                workItem,
                waitingReviewWithGeneratedDraft: status.status_key === 'waiting_review' && rowInteraction.primary_action != null,
            });
            const cycleIndex = dateCycleIndex.get(scheduledDate) ?? 0;
            const amount = await computeScheduleAmount({
                orgId: params.orgId,
                profile: params.profile,
                documentDate: scheduledDate,
                cycleIndex,
                baseUnitPriceBeforeVat,
                nextDocumentPreview: params.nextDocumentPreview,
                projectedNextDocumentDate,
                profiling: amountProfiling,
            });
            projectionRows += 1;
            yearTotalReference += amount.grand_total_reference;
            const actions = buildRowActions(status.status_key, scheduledDate, today, status.work_item_href, rowInteraction.primary_action != null);
            const showStatusText = !(status.status_key === 'waiting_review' &&
                machine.machine_has_task &&
                rowInteraction.primary_action != null);
            rows.push({
                projection_key: formatScheduleProjectionKey(params.profile.id, scheduledDate),
                cycle_id: cycle?.id ?? null,
                generated_draft_id: cycle?.generated_draft_id ?? null,
                linked_work_item_id: machine.machine_task_id ?? workItem?.work_item_id ?? null,
                period_key: periodKey,
                scheduled_document_date: scheduledDate,
                scheduled_document_date_display: formatScheduleRowDateDisplay(scheduledDate),
                document_type_label: documentTypeLabel,
                amount_display: amount.amount_display,
                status_key: status.status_key,
                status_label: status.status_label,
                show_status_text: showStatusText,
                status_tone: status.status_tone,
                icon_key: status.icon_key,
                icon_display: status.icon_display,
                work_state_label: status.work_state_label,
                has_open_task: status.has_open_task,
                work_item_href: status.work_item_href,
                machine_state: machine.machine_state,
                machine_state_label: machine.machine_state_label,
                machine_state_tone: machine.machine_state_tone,
                machine_has_task: machine.machine_has_task,
                machine_task_id: machine.machine_task_id,
                machine_task_url: machine.machine_task_url,
                machine_task_title: machine.machine_task_title,
                row_interaction_kind: rowInteraction.row_interaction_kind,
                primary_action: rowInteraction.primary_action,
                allowed_actions: actions.map((action) => action.key),
                actions,
            });
        }
        years.push({
            year: group.year,
            label: String(group.year),
            total_count: rows.length,
            total_count_label: formatScheduleYearDocumentsCountLabel(rows.length),
            yearly_total_amount_display: formatMoneyReference(yearTotalReference, params.profile.currency),
            expanded_by_default: group.year === currentYear,
            rows,
        });
    }
    params.onTiming?.(`schedule_projection cycles_loaded=${params.cycles.length} rows_generated=${projectionRows} row_loop_ms=${Date.now() - rowLoopStartMs}`);
    params.onTiming?.(`schedule_projection compute_amount_calls=${amountProfiling.computeAmountCalls} preview_shortcut=${amountProfiling.previewShortcutCalls} vat_db_queries=${amountProfiling.vatResolveCalls} vat_db_ms=${amountProfiling.vatResolveMs} totals_preview_calls=${amountProfiling.totalsPreviewCalls} totals_preview_ms=${amountProfiling.totalsPreviewMs}`);
    const documentsInHorizonCount = years.reduce((sum, year) => sum + year.total_count, 0);
    const nextSummaryDocumentDate = projectedNextDocumentDate ??
        resolveNextScheduleSummaryDocumentDate({
            allDates,
            today,
            cyclesByDate: new Map(params.cycles.map((cycle) => [
                cycle.scheduled_document_date,
                {
                    status: cycle.status,
                    generated_document_id: cycle.generated_document_id,
                },
            ])),
        });
    const nextSummaryDocumentDateDisplay = nextSummaryDocumentDate
        ? formatScheduleRowDateDisplay(nextSummaryDocumentDate)
        : '—';
    return {
        status: 'ready',
        unavailable_message: null,
        summary: {
            title: 'לוח זמנים',
            cycle_label: 'מחזור',
            cycle_display: recurrenceRuleDisplay,
            status_label: params.retainerSettings.status_label,
            documents_in_horizon_label: 'מסמכים ב־5 השנים הקרובות',
            documents_in_horizon_count: documentsInHorizonCount,
            next_document_label: 'המסמך הבא',
            next_document_date_display: nextSummaryDocumentDateDisplay,
            next_document_date_source: 'schedule_projection',
        },
        recurrence_rule_display: recurrenceRuleDisplay,
        default_expanded_year: Number.isFinite(currentYear) ? currentYear : null,
        years,
    };
}
