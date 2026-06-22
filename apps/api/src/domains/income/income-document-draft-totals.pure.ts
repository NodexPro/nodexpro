import type { IncomeDraftLineRecord } from './income-document-draft-lines.pure.js';
import { formatMoneyReference } from './income-document-draft-lines.pure.js';
import {
  computeDraftLineAmounts,
  resolveFxMapForDraftLines,
  resolveLineFx,
  type LineVatRateCode,
} from './income-draft-line-compute.pure.js';
import { computeDiscountAmountIls } from './income-document-discount.pure.js';
import type { IncomeDraftVatResolution } from './income-draft-vat-fallback.pure.js';
import { IL_DRAFT_VAT_FALLBACK_RATE } from './income-draft-vat-fallback.pure.js';

/** @deprecated use IL_DRAFT_VAT_FALLBACK_RATE — kept for tests importing legacy name */
export const IL_DRAFT_VAT_RATE = IL_DRAFT_VAT_FALLBACK_RATE;

export type IncomeDocumentDiscountType = 'percent' | 'fixed_amount';

export type IncomeDocumentDiscount = {
  enabled: boolean;
  type: IncomeDocumentDiscountType;
  value: number;
};

export type IncomeDocumentSettings = {
  vat_mode: 'standard' | 'exempt' | 'zero';
  amount_rounding: 'none' | 'nearest_agora';
  discount: IncomeDocumentDiscount;
  /** When true, tax-invoice due date was manually overridden and should not auto-recalculate. */
  due_date_manual_override?: boolean;
};

export const DEFAULT_DOCUMENT_DISCOUNT: IncomeDocumentDiscount = {
  enabled: false,
  type: 'percent',
  value: 0,
};

export const DEFAULT_DOCUMENT_SETTINGS: IncomeDocumentSettings = {
  vat_mode: 'standard',
  amount_rounding: 'none',
  discount: { ...DEFAULT_DOCUMENT_DISCOUNT },
};

function parseDiscountJson(raw: unknown): IncomeDocumentDiscount {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_DOCUMENT_DISCOUNT };
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  const type = o.type === 'fixed_amount' ? 'fixed_amount' : 'percent';
  const num = Number(o.value);
  const value = Number.isFinite(num) ? Math.max(0, num) : 0;
  return { enabled, type, value: enabled ? value : 0 };
}

export function parseDocumentSettingsJson(raw: unknown): IncomeDocumentSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_DOCUMENT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const vat_mode =
    o.vat_mode === 'exempt' || o.vat_mode === 'zero' || o.vat_mode === 'standard'
      ? o.vat_mode
      : DEFAULT_DOCUMENT_SETTINGS.vat_mode;
  const amount_rounding =
    o.amount_rounding === 'nearest_agora' ? 'nearest_agora' : DEFAULT_DOCUMENT_SETTINGS.amount_rounding;
  const discount = parseDiscountJson(o.discount);
  const due_date_manual_override = o.due_date_manual_override === true;
  return { vat_mode, amount_rounding, discount, due_date_manual_override };
}

export function serializeDocumentSettingsJson(settings: IncomeDocumentSettings): Record<string, unknown> {
  return {
    vat_mode: settings.vat_mode,
    amount_rounding: settings.amount_rounding,
    discount: settings.discount,
    due_date_manual_override: settings.due_date_manual_override === true,
  };
}

function roundAmount(value: number, rounding: IncomeDocumentSettings['amount_rounding']): number {
  if (rounding === 'nearest_agora') return Math.round(value * 100) / 100;
  return Math.round(value * 100) / 100;
}

export type DraftTotalsPreview = {
  preview: true;
  not_financial_truth: true;
  currency: string;
  line_count: number;
  subtotal_before_discount_reference: number | null;
  discount_amount_reference: number | null;
  subtotal_after_discount_reference: number | null;
  /** @deprecated use subtotal_before_discount_reference */
  subtotal_reference: number | null;
  vat_reference: number | null;
  grand_total_reference: number | null;
  subtotal_before_discount_display: string;
  discount_amount_display: string | null;
  subtotal_after_discount_display: string;
  /** @deprecated use subtotal_before_discount_display — kept for legacy readers */
  subtotal_display: string;
  vat_display: string | null;
  grand_total_display: string;
  vat_rate_label: string | null;
  discount_enabled: boolean;
  exchange_context: { display_currency: string; document_date: string };
};

export async function computeDraftTotalsPreview(
  lines: IncomeDraftLineRecord[],
  currency: string,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate?: string,
): Promise<DraftTotalsPreview> {
  const effectiveSettings: IncomeDocumentSettings = {
    ...settings,
    discount: settings.discount ?? { ...DEFAULT_DOCUMENT_DISCOUNT },
  };
  const asOf = documentDate?.trim() || new Date().toISOString().slice(0, 10);
  const officialByCurrency = await resolveFxMapForDraftLines(lines, asOf);
  const displayCurrency = 'ILS';

  type LineNet = { netIls: number; vatRate: number };
  const lineNets: LineNet[] = [];
  let hasAmount = false;

  for (const line of lines) {
    const fx = resolveLineFx(line, asOf, officialByCurrency);
    if (!fx) continue;
    const amounts = computeDraftLineAmounts(line, effectiveSettings, vatResolution, fx);
    if (amounts.line_net_ils == null) continue;
    hasAmount = true;
    const netIls = amounts.line_net_ils;
    const vatRate =
      netIls > 0 && amounts.line_vat_ils != null ? amounts.line_vat_ils / netIls : 0;
    lineNets.push({ netIls, vatRate });
  }

  let subtotalBefore = 0;
  for (const ln of lineNets) {
    subtotalBefore += ln.netIls;
  }
  subtotalBefore = roundAmount(subtotalBefore, effectiveSettings.amount_rounding);

  const discountAmount = computeDiscountAmountIls(
    effectiveSettings.discount,
    subtotalBefore,
    effectiveSettings.amount_rounding,
  );
  const subtotalAfter =
    hasAmount || (subtotalBefore === 0 && lines.length > 0)
      ? roundAmount(Math.max(0, subtotalBefore - discountAmount), effectiveSettings.amount_rounding)
      : 0;

  const discountFactor =
    subtotalBefore > 0 && effectiveSettings.discount.enabled && discountAmount > 0
      ? subtotalAfter / subtotalBefore
      : 1;

  let vat = 0;
  for (const ln of lineNets) {
    if (ln.netIls <= 0) continue;
    const discountedNet = roundAmount(ln.netIls * discountFactor, effectiveSettings.amount_rounding);
    vat += roundAmount(discountedNet * ln.vatRate, effectiveSettings.amount_rounding);
  }
  vat = roundAmount(vat, effectiveSettings.amount_rounding);

  let vatLabel: string | null = null;
  if (effectiveSettings.vat_mode === 'standard' && vat > 0) {
    vatLabel = vatResolution.standard_rate_percent_label;
  } else if (effectiveSettings.vat_mode === 'zero') {
    vatLabel = '0%';
  }

  const grand = hasAmount
    ? roundAmount(subtotalAfter + vat, effectiveSettings.amount_rounding)
    : subtotalBefore === 0 && lines.length > 0
      ? 0
      : null;

  const showVat =
    effectiveSettings.vat_mode === 'standard' && (vat > 0 || (hasAmount && subtotalAfter > 0));

  const subtotalBeforeRef = hasAmount
    ? subtotalBefore
    : subtotalBefore === 0 && lines.length > 0
      ? 0
      : null;
  const discountRef =
    effectiveSettings.discount.enabled && discountAmount > 0
      ? discountAmount
      : effectiveSettings.discount.enabled
        ? 0
        : null;
  const subtotalAfterRef = hasAmount
    ? subtotalAfter
    : subtotalBefore === 0 && lines.length > 0
      ? 0
      : null;

  return {
    preview: true,
    not_financial_truth: true,
    currency: displayCurrency,
    line_count: lines.length,
    subtotal_before_discount_reference: subtotalBeforeRef,
    discount_amount_reference: discountRef,
    subtotal_after_discount_reference: subtotalAfterRef,
    subtotal_reference: subtotalBeforeRef,
    vat_reference: showVat ? vat : effectiveSettings.vat_mode === 'zero' ? 0 : null,
    grand_total_reference: grand,
    subtotal_before_discount_display: formatMoneyReference(subtotalBeforeRef, displayCurrency),
    discount_amount_display:
      discountRef != null && discountRef > 0
        ? formatMoneyReference(discountRef, displayCurrency)
        : effectiveSettings.discount.enabled
          ? formatMoneyReference(0, displayCurrency)
          : null,
    subtotal_after_discount_display: formatMoneyReference(subtotalAfterRef, displayCurrency),
    subtotal_display: formatMoneyReference(subtotalBeforeRef, displayCurrency),
    vat_display: showVat ? formatMoneyReference(vat, displayCurrency) : null,
    grand_total_display: formatMoneyReference(grand, displayCurrency),
    vat_rate_label: vatLabel,
    discount_enabled: effectiveSettings.discount.enabled,
    exchange_context: { display_currency: displayCurrency, document_date: asOf },
  };
}
