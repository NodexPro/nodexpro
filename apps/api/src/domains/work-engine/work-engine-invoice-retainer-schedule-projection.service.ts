/**
 * Retainer — schedule tab projection (read-model only).
 */

import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
} from '../income/income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import type { RecurringCycleStatus } from './work-engine-invoice-retainer-cycles.service.js';
import {
  computeNextUnitPriceBeforeVat,
  type RecurringDocumentFrequency,
  type RecurringPriceIncreaseType,
  type RecurringProfileStatus,
} from './work-engine-invoice-retainer.pure.js';
import { todayIsoDate } from '../income/income-retainer-template-document-date.pure.js';
import type { RecurringDocumentTemplateSnapshot } from './work-engine-invoice-retainer-draft.service.js';
import type {
  WorkEngineInvoiceRetainerNextDocumentPreview,
  WorkEngineInvoiceRetainerScheduleProjection,
  WorkEngineInvoiceRetainerScheduleProjectionAction,
  WorkEngineInvoiceRetainerScheduleProjectionRow,
  WorkEngineInvoiceRetainerScheduleProjectionYear,
  WorkEngineInvoiceRetainerSettings,
  WorkEngineInvoiceRetainerSetupTab,
} from './work-engine-invoice-retainer.types.js';
import {
  formatScheduleProjectionKey,
  formatScheduleRowDateDisplay,
  formatScheduleYearDocumentsCountLabel,
  generateProjectedScheduleDates,
  groupScheduleDatesByYear,
  resolveScheduleEndDate,
  resolveScheduleStartDate,
} from './work-engine-invoice-retainer-schedule-projection.pure.js';

const SKIP_PERSISTENCE_DISABLED_REASON = 'שמירת דילוג תתווסף בשלב הבא';

const DOCUMENT_TYPE_LABELS: Record<'quote' | 'deal_invoice' | 'tax_invoice', string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
};

type ScheduleCycleRow = {
  id: string;
  scheduled_document_date: string;
  status: RecurringCycleStatus;
  generated_document_id: string | null;
};

type ScheduleProfile = {
  id: string;
  document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
  frequency: RecurringDocumentFrequency;
  next_document_date: string;
  service_period_start: string;
  service_period_end: string;
  status: RecurringProfileStatus;
  quantity: number;
  unit_price_before_vat_reference: number;
  currency: string;
  discount_percent_reference: number | null;
  discount_amount_reference: number | null;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | null;
  price_increase_value: number | null;
  document_template_snapshot: RecurringDocumentTemplateSnapshot | null;
};

function statusDescriptorForCycle(
  cycle: ScheduleCycleRow | null,
  scheduledDate: string,
  today: string,
): Pick<
  WorkEngineInvoiceRetainerScheduleProjectionRow,
  'status_key' | 'status_label' | 'status_tone' | 'icon_key'
> {
  if (cycle?.status === 'issued' || cycle?.generated_document_id) {
    return {
      status_key: 'issued',
      status_label: 'אושר',
      status_tone: 'success',
      icon_key: 'check',
    };
  }
  if (cycle?.status === 'cancelled') {
    return {
      status_key: 'skipped',
      status_label: 'דולג',
      status_tone: 'warning',
      icon_key: 'pause',
    };
  }
  if (cycle?.status === 'failed') {
    return {
      status_key: 'failed',
      status_label: 'נכשל',
      status_tone: 'danger',
      icon_key: 'alert',
    };
  }
  return {
    status_key: 'scheduled',
    status_label: 'מתוכנן',
    status_tone: 'neutral',
    icon_key: 'clock',
  };
}

function buildRowActions(
  statusKey: string,
  scheduledDate: string,
  today: string,
): WorkEngineInvoiceRetainerScheduleProjectionAction[] {
  if (statusKey === 'skipped') {
    return [
      {
        key: 'unskip_cycle',
        label: 'בטל דילוג',
        disabled: true,
        disabled_reason: SKIP_PERSISTENCE_DISABLED_REASON,
      },
    ];
  }
  if (statusKey === 'scheduled' && scheduledDate > today) {
    return [
      {
        key: 'skip_cycle',
        label: 'דלג על המסמך הזה',
        disabled: true,
        disabled_reason: SKIP_PERSISTENCE_DISABLED_REASON,
      },
    ];
  }
  return [];
}

function unitPriceForCycleIndex(profile: ScheduleProfile, cycleIndex: number): number {
  let unitPrice = profile.unit_price_before_vat_reference;
  if (!profile.price_increase_enabled || cycleIndex <= 0) return unitPrice;
  for (let i = 0; i < cycleIndex; i += 1) {
    unitPrice = computeNextUnitPriceBeforeVat({
      current_unit_price_before_vat_reference: unitPrice,
      price_increase_enabled: profile.price_increase_enabled,
      price_increase_type: profile.price_increase_type,
      price_increase_value: profile.price_increase_value,
    });
  }
  return unitPrice;
}

async function computeScheduleAmountDisplay(params: {
  orgId: string;
  profile: ScheduleProfile;
  documentDate: string;
  cycleIndex: number;
  nextDocumentPreview: WorkEngineInvoiceRetainerNextDocumentPreview | null;
}): Promise<string> {
  if (
    params.nextDocumentPreview?.status === 'ready' &&
    params.profile.next_document_date === params.documentDate &&
    params.nextDocumentPreview.document_details_step?.totals_block?.grand_total_display
  ) {
    return params.nextDocumentPreview.document_details_step.totals_block.grand_total_display;
  }

  const snapshot = params.profile.document_template_snapshot;
  const settings = parseDocumentSettingsJson(snapshot?.document_settings_json ?? null);
  const unitPrice = unitPriceForCycleIndex(params.profile, params.cycleIndex);
  const baseLines = normalizeDraftLines(snapshot?.draft_lines_json ?? []);
  const lines =
    baseLines.length > 0
      ? baseLines.map((line, index) => ({
          ...line,
          quantity: index === 0 ? params.profile.quantity : line.quantity,
          unit_price_reference: index === 0 ? unitPrice : line.unit_price_reference,
          currency: (index === 0 ? params.profile.currency : line.currency) as typeof line.currency,
        }))
      : normalizeDraftLines([
          {
            description: '—',
            quantity: params.profile.quantity,
            unit_price_reference: unitPrice,
            currency: params.profile.currency,
          },
        ]);

  const vatResolution = await resolveIncomeDraftVatForOrg(params.orgId, 'IL', params.documentDate);
  const totalsPreview = await computeDraftTotalsPreview(
    lines,
    params.profile.currency,
    settings,
    vatResolution,
    params.documentDate,
  );
  return totalsPreview.grand_total_display;
}

function mergeScheduleDates(params: {
  projectedDates: string[];
  cycles: ScheduleCycleRow[];
  includeFutureProjections: boolean;
}): string[] {
  const merged = new Set<string>(params.projectedDates);
  for (const cycle of params.cycles) {
    merged.add(cycle.scheduled_document_date);
  }
  return [...merged].sort();
}

export function buildScheduleSetupTab(profileId: string | null): WorkEngineInvoiceRetainerSetupTab {
  const enabled = Boolean(profileId);
  return {
    key: 'schedule',
    label: 'לוח זמנים',
    enabled,
    disabled_reason: enabled ? null : 'שמור ריטיינר כדי לראות את לוח הזמנים.',
  };
}

export async function buildRetainerScheduleProjection(params: {
  orgId: string;
  profile: ScheduleProfile | null;
  retainerSettings: WorkEngineInvoiceRetainerSettings | null;
  cycles: ScheduleCycleRow[];
  nextDocumentPreview: WorkEngineInvoiceRetainerNextDocumentPreview | null;
  todayIso?: string;
}): Promise<WorkEngineInvoiceRetainerScheduleProjection> {
  if (!params.profile || !params.retainerSettings?.profile_id) {
    return {
      status: 'unavailable',
      unavailable_message: 'שמור ריטיינר כדי לראות את לוח הזמנים.',
      years: [],
    };
  }

  const today = params.todayIso ?? todayIsoDate();
  const scheduleStartDate = resolveScheduleStartDate({
    templateDocumentDate: params.profile.document_template_snapshot?.document_date ?? null,
    servicePeriodStart: params.profile.service_period_start,
    nextDocumentDate: params.profile.next_document_date,
  });

  if (!scheduleStartDate) {
    return {
      status: 'unavailable',
      unavailable_message: 'לא ניתן לחשב לוח זמנים ללא תאריך התחלה.',
      years: [],
    };
  }

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

  const allDates = mergeScheduleDates({
    projectedDates,
    cycles: params.cycles,
    includeFutureProjections,
  }).filter((iso) => iso >= scheduleStartDate && iso <= scheduleEndDate);

  const cycleByDate = new Map(params.cycles.map((cycle) => [cycle.scheduled_document_date, cycle]));
  const dateCycleIndex = new Map<string, number>();
  allDates.forEach((iso, index) => dateCycleIndex.set(iso, index));

  const documentTypeLabel =
    params.retainerSettings.document_type_label ??
    DOCUMENT_TYPE_LABELS[params.profile.document_type];

  const grouped = groupScheduleDatesByYear(allDates);
  const years: WorkEngineInvoiceRetainerScheduleProjectionYear[] = [];

  for (const group of grouped) {
    const rows: WorkEngineInvoiceRetainerScheduleProjectionRow[] = [];
    for (const scheduledDate of group.dates) {
      const cycle = cycleByDate.get(scheduledDate) ?? null;
      const status = statusDescriptorForCycle(cycle, scheduledDate, today);
      const amountDisplay = await computeScheduleAmountDisplay({
        orgId: params.orgId,
        profile: params.profile,
        documentDate: scheduledDate,
        cycleIndex: dateCycleIndex.get(scheduledDate) ?? 0,
        nextDocumentPreview: params.nextDocumentPreview,
      });
      const actions = buildRowActions(status.status_key, scheduledDate, today);
      rows.push({
        projection_key: formatScheduleProjectionKey(params.profile.id, scheduledDate),
        scheduled_document_date: scheduledDate,
        scheduled_document_date_display: formatScheduleRowDateDisplay(scheduledDate),
        document_type_label: documentTypeLabel,
        amount_display: amountDisplay,
        status_key: status.status_key,
        status_label: status.status_label,
        status_tone: status.status_tone,
        icon_key: status.icon_key,
        allowed_actions: actions.map((action) => action.key),
        actions,
      });
    }
    years.push({
      year: group.year,
      label: String(group.year),
      total_count: rows.length,
      total_count_label: formatScheduleYearDocumentsCountLabel(rows.length),
      rows,
    });
  }

  return {
    status: 'ready',
    unavailable_message: null,
    years,
  };
}
