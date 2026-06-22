/**
 * Retainer — next document projection (read-model only, not a draft / not issued).
 */

import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type IncomeDocumentSettings,
} from '../income/income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import type { IncomeDraftVatResolution } from '../income/income-draft-vat-fallback.pure.js';
import { computeDraftLineAmounts, resolveLineFx, resolveFxMapForDraftLines } from '../income/income-draft-line-compute.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import {
  computeDueDateFromPaymentTerms,
  isIncomeCustomerPaymentTermsKey,
} from '../income/income-customer-payment-terms.pure.js';
import {
  computeDraftCreationDateIso,
  computeNextUnitPriceBeforeVat,
  formatHebrewDateDisplay,
  type RecurringPriceIncreaseType,
} from './work-engine-invoice-retainer.pure.js';
import type {
  WorkEngineInvoiceRetainerNextDocumentPreview,
  WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock,
  WorkEngineInvoiceRetainerSettings,
  WorkEngineInvoiceRetainerSetupTab,
} from './work-engine-invoice-retainer.types.js';

type RawProfile = {
  id: string;
  next_document_date: string;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | null;
  price_increase_value: number | null;
  document_template_snapshot: { document_settings_json?: Record<string, unknown> } | null;
};

const DOCUMENT_TYPE_LABELS: Record<'quote' | 'deal_invoice' | 'tax_invoice', string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
};

function resolvePreviewDocumentTypeLabel(
  retainerSettings: WorkEngineInvoiceRetainerSettings | null,
  step: IncomeDocumentDetailsStep | null,
): string | null {
  const fromStep = step?.document_type_key;
  if (fromStep === 'quote' || fromStep === 'deal_invoice' || fromStep === 'tax_invoice') {
    return DOCUMENT_TYPE_LABELS[fromStep];
  }
  return retainerSettings?.document_type_label ?? null;
}

function cloneStep(step: IncomeDocumentDetailsStep): IncomeDocumentDetailsStep {
  return structuredClone(step);
}

function parseUnitPrice(value: string): number {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

function formatUnitPrice(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

function applyPriceIncreaseToLines(
  step: IncomeDocumentDetailsStep,
  profile: RawProfile,
): IncomeDocumentDetailsStep {
  if (!profile.price_increase_enabled) return step;
  const rows = step.line_items.rows.map((row, index) => {
    const current = parseUnitPrice(row.unit_price.value);
    const next =
      profile.price_increase_type === 'amount' && index > 0
        ? current
        : computeNextUnitPriceBeforeVat({
            current_unit_price_before_vat_reference: current,
            price_increase_enabled: profile.price_increase_enabled,
            price_increase_type: profile.price_increase_type,
            price_increase_value: profile.price_increase_value,
          });
    return {
      ...row,
      unit_price: { ...row.unit_price, value: formatUnitPrice(next) },
    };
  });
  return {
    ...step,
    line_items: { ...step.line_items, rows },
  };
}

function resolveProjectionSettings(
  step: IncomeDocumentDetailsStep,
  profile: RawProfile,
): IncomeDocumentSettings {
  const fromSnapshot = profile.document_template_snapshot?.document_settings_json ?? null;
  if (fromSnapshot) return parseDocumentSettingsJson(fromSnapshot);
  const vatMode = step.line_items.document_fields?.vat_mode?.value ?? 'standard';
  return parseDocumentSettingsJson({ vat_mode: vatMode, discount: { enabled: false, type: 'percent', value: 0 } });
}

function buildTotalsBlock(
  totals: Awaited<ReturnType<typeof computeDraftTotalsPreview>>,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): IncomeDocumentDetailsStep['totals_block'] {
  const rows: IncomeDocumentDetailsStep['totals_block']['rows'] = [
    {
      key: 'subtotal_before_discount',
      label: 'סכום ביניים',
      amount_display: totals.subtotal_before_discount_display,
      tone: 'neutral',
      emphasized: false,
    },
  ];
  if (totals.discount_enabled && totals.discount_amount_display) {
    rows.push({
      key: 'discount',
      label: 'הנחה לפני מע״מ',
      amount_display: `−${totals.discount_amount_display.replace(/^−/, '')}`,
      tone: 'neutral',
      emphasized: false,
    });
    rows.push({
      key: 'subtotal_after_discount',
      label: 'סכום לאחר הנחה',
      amount_display: totals.subtotal_after_discount_display,
      tone: 'neutral',
      emphasized: false,
    });
  }
  if (totals.vat_display != null) {
    rows.push({
      key: 'vat',
      label:
        settings.vat_mode === 'standard'
          ? `מע״מ (${vatResolution.standard_rate_percent_label})`
          : 'מע״מ',
      amount_display: totals.vat_display,
      tone: 'neutral',
      emphasized: false,
    });
  }
  rows.push({
    key: 'grand_total',
    label: 'סה״כ לתשלום',
    amount_display: totals.grand_total_display,
    tone: 'good',
    emphasized: true,
  });
  return {
    rows,
    grand_total_display: totals.grand_total_display,
    currency: totals.currency,
  };
}

async function rebuildProjectedLineTotals(
  step: IncomeDocumentDetailsStep,
  orgId: string,
  documentDate: string,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): Promise<IncomeDocumentDetailsStep> {
  const lines = normalizeDraftLines(
    step.line_items.rows.map((row) => ({
      line_id: row.line_id,
      sort_index: row.row_number,
      description: row.description.value,
      quantity: Number(row.quantity.value) || 1,
      unit_price_reference: parseUnitPrice(row.unit_price.value) || null,
      currency: row.currency.value,
      exchange_rate_to_ils_override: row.exchange_rate_override?.value
        ? Number(row.exchange_rate_override.value)
        : null,
      price_includes_vat: row.price_includes_vat,
      vat_rate_code: row.vat_rate_code,
    })),
  );
  const currency = step.line_items.document_fields?.currency?.value ?? step.totals_block.currency ?? 'ILS';
  const totalsPreview = await computeDraftTotalsPreview(
    lines,
    currency,
    settings,
    vatResolution,
    documentDate,
  );
  const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);
  const rows = step.line_items.rows.map((row) => {
    const line = lines.find((item) => item.line_id === row.line_id);
    if (!line) return row;
    const fx = resolveLineFx(line, documentDate, officialByCurrency);
    if (!fx) return row;
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, fx);
    const display =
      amounts.line_net_ils != null
        ? formatMoneyReference(amounts.line_net_ils, totalsPreview.currency)
        : row.line_total_display;
    return {
      ...row,
      line_total_display: display,
      line_total: { display },
    };
  });
  const totalsBlock = buildTotalsBlock(totalsPreview, settings, vatResolution);
  return {
    ...step,
    totals_block: totalsBlock,
    line_items: {
      ...step.line_items,
      rows,
      totals: {
        subtotal: { label: 'סכום ביניים', display: totalsPreview.subtotal_before_discount_display },
        vat: totalsPreview.vat_display
          ? { label: 'מע״מ', display: totalsPreview.vat_display }
          : null,
        grand_total: { label: 'סה״כ לתשלום', display: totalsPreview.grand_total_display },
        currency: totalsPreview.currency,
        not_financial_truth: true,
      },
    },
    document_discount: {
      ...step.document_discount,
      calculated_discount_amount_display: totalsPreview.discount_amount_display,
    },
  };
}

function buildPreviewInfoBlock(
  retainerSettings: WorkEngineInvoiceRetainerSettings | null,
  nextDocumentDate: string | null,
  nextDocumentDateDisplay: string | null,
  projectedStep: IncomeDocumentDetailsStep | null = null,
): WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock {
  const advanceDays = retainerSettings?.advance_days ?? null;
  const draftReviewDateDisplay =
    nextDocumentDate != null && advanceDays != null
      ? formatHebrewDateDisplay(computeDraftCreationDateIso(nextDocumentDate, advanceDays))
      : null;
  return {
    title: 'המסמך הבא',
    document_type_label: resolvePreviewDocumentTypeLabel(retainerSettings, projectedStep),
    next_document_date_display: nextDocumentDateDisplay,
    draft_review_date_label: 'טיוטה תיווצר לבדיקה',
    draft_review_date_display: draftReviewDateDisplay,
    draft_review_advance_note:
      advanceDays != null ? `(${advanceDays} ימים לפני מועד המסמך)` : null,
    profile_status_label: retainerSettings?.status_label ?? null,
  };
}

function stripProjectionDocumentNumbers(step: IncomeDocumentDetailsStep): IncomeDocumentDetailsStep {
  return {
    ...step,
    header: {
      ...step.header,
      document_number_preview: null,
      subtitle: null,
    },
    document_preview: null,
  };
}

function applyNextDocumentDate(step: IncomeDocumentDetailsStep, nextDocumentDate: string): IncomeDocumentDetailsStep {
  const paymentTermsRaw = step.settings_schema.find((field) => field.key === 'payment_terms')?.value;
  const paymentTermsKey =
    paymentTermsRaw && isIncomeCustomerPaymentTermsKey(paymentTermsRaw) ? paymentTermsRaw : null;
  const computedDueDate =
    paymentTermsKey && step.document_type_key === 'tax_invoice'
      ? computeDueDateFromPaymentTerms(nextDocumentDate, paymentTermsKey)
      : null;
  const settingsSchema = step.settings_schema.map((field) => {
    if (field.key === 'document_date') {
      return { ...field, value: nextDocumentDate, disabled: true };
    }
    if (field.key === 'due_date' && computedDueDate) {
      return { ...field, value: computedDueDate };
    }
    return field;
  });
  return {
    ...step,
    settings_schema: settingsSchema,
    header: {
      ...step.header,
      title: 'המסמך הבא',
      subtitle: null,
      document_number_preview: null,
    },
    draft_state_display: undefined,
    document_preview: step.document_preview
      ? {
          ...step.document_preview,
          dates: {
            ...step.document_preview.dates,
            document_date: nextDocumentDate,
            due_date: computedDueDate ?? step.document_preview.dates.due_date,
          },
        }
      : null,
  };
}

function buildSaveAction(
  visible: boolean,
): WorkEngineInvoiceRetainerNextDocumentPreview['save_action'] {
  return {
    visible,
    label: 'שמירה',
    disabled_reason: visible ? null : 'אין תצוגת מסמך הבא זמינה',
    apply_scope_dialog: visible
      ? {
          title: 'להחיל על',
          prompt: 'בחר כיצד לשמור את השינויים במסמך הבא:',
          option_next_cycle_only: {
            key: 'next_cycle_only',
            label: 'המסמך הבא בלבד',
            description: 'שמירת שינוי חד-פעמי למחזור הבא בלבד.',
          },
          option_all_future_cycles: {
            key: 'all_future_cycles',
            label: 'כל המחזורים הבאים',
            description: 'עדכון תבנית הריטיינר לכל המחזורים הבאים.',
          },
          confirm_label: 'שמירה',
          cancel_label: 'ביטול',
          persistence_note: 'שמירת השינויים תתווסף בשלב הבא — כרגע אין שמירה לשרת.',
        }
      : null,
  };
}

function buildUnavailablePreview(
  message: string,
  retainerSettings: WorkEngineInvoiceRetainerSettings | null = null,
): WorkEngineInvoiceRetainerNextDocumentPreview {
  const nextDocumentDate = retainerSettings?.next_document_date ?? null;
  const nextDocumentDateDisplay =
    retainerSettings?.next_document_date_display ??
    (nextDocumentDate ? formatHebrewDateDisplay(nextDocumentDate) : null);
  return {
    status: 'unavailable',
    unavailable_message: message,
    projection_id: null,
    next_document_date: nextDocumentDate,
    next_document_date_display: nextDocumentDateDisplay,
    price_increase_applied: false,
    price_increase_note: null,
    info_block: buildPreviewInfoBlock(retainerSettings, nextDocumentDate, nextDocumentDateDisplay),
    document_details_step: null,
    save_action: buildSaveAction(false),
    allowed_actions: [],
  };
}

export function buildSetupTabs(
  preview: WorkEngineInvoiceRetainerNextDocumentPreview,
): { default_tab_key: 'retainer'; tabs: WorkEngineInvoiceRetainerSetupTab[] } {
  const nextEnabled = preview.status === 'ready';
  return {
    default_tab_key: 'retainer',
    tabs: [
      { key: 'retainer', label: 'ריטיינר', enabled: true, disabled_reason: null },
      {
        key: 'next_document',
        label: 'המסמך הבא',
        enabled: nextEnabled,
        disabled_reason: nextEnabled ? null : preview.unavailable_message,
      },
    ],
  };
}

export async function buildNextDocumentPreview(params: {
  orgId: string;
  profile: RawProfile | null;
  retainerSettings: WorkEngineInvoiceRetainerSettings | null;
  baseStep: IncomeDocumentDetailsStep | null | undefined;
}): Promise<WorkEngineInvoiceRetainerNextDocumentPreview> {
  if (!params.profile || !params.retainerSettings?.profile_id) {
    return buildUnavailablePreview('שמור ריטיינר כדי לצפות במסמך הבא.', params.retainerSettings);
  }
  if (!params.baseStep) {
    return buildUnavailablePreview('אין תבנית מסמך זמינה לתצוגת המסמך הבא.', params.retainerSettings);
  }

  const nextDocumentDate = params.profile.next_document_date;
  const nextDocumentDateDisplay = formatHebrewDateDisplay(nextDocumentDate);
  let step = stripProjectionDocumentNumbers(cloneStep(params.baseStep));
  const projectedDocumentType =
    step.document_type_key === 'quote' ||
    step.document_type_key === 'deal_invoice' ||
    step.document_type_key === 'tax_invoice'
      ? step.document_type_key
      : (params.retainerSettings.document_type ?? 'deal_invoice');
  step.draft_id = `projection:${params.profile.id}:${nextDocumentDate}:${projectedDocumentType}`;
  step = applyNextDocumentDate(step, nextDocumentDate);
  step = applyPriceIncreaseToLines(step, params.profile);
  step = stripProjectionDocumentNumbers(step);

  const settings = resolveProjectionSettings(step, params.profile);
  const vatResolution = await resolveIncomeDraftVatForOrg(params.orgId, 'IL', nextDocumentDate);
  step = await rebuildProjectedLineTotals(step, params.orgId, nextDocumentDate, settings, vatResolution);

  const priceIncreaseApplied = params.profile.price_increase_enabled;
  const priceIncreaseNote = priceIncreaseApplied
    ? params.retainerSettings.next_cycle_unit_price_before_vat_display
      ? `מחירי יחידה מוצגים לאחר העלאת מחיר (${params.retainerSettings.next_cycle_unit_price_before_vat_display}).`
      : 'מחירי יחידה מוצגים לאחר העלאת מחיר מוגדרת.'
    : null;

  return {
    status: 'ready',
    unavailable_message: null,
    projection_id: step.draft_id,
    next_document_date: nextDocumentDate,
    next_document_date_display: nextDocumentDateDisplay,
    price_increase_applied: priceIncreaseApplied,
    price_increase_note: priceIncreaseNote,
    info_block: buildPreviewInfoBlock(
      params.retainerSettings,
      nextDocumentDate,
      nextDocumentDateDisplay,
      step,
    ),
    document_details_step: step,
    save_action: buildSaveAction(true),
    allowed_actions: ['view_retainer_next_document_projection'],
  };
}
