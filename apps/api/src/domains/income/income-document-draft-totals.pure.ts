import type { IncomeDraftLineRecord } from './income-document-draft-lines.pure.js';
import { formatMoneyReference } from './income-document-draft-lines.pure.js';
import {
  computeDraftLineAmounts,
  resolveFxMapForDraftLines,
  resolveLineFx,
} from './income-draft-line-compute.pure.js';
import type { IncomeDraftVatResolution } from './income-draft-vat-fallback.pure.js';
import { IL_DRAFT_VAT_FALLBACK_RATE } from './income-draft-vat-fallback.pure.js';

/** @deprecated use IL_DRAFT_VAT_FALLBACK_RATE — kept for tests importing legacy name */
export const IL_DRAFT_VAT_RATE = IL_DRAFT_VAT_FALLBACK_RATE;

export type IncomeDocumentSettings = {
  vat_mode: 'standard' | 'exempt' | 'zero';
  amount_rounding: 'none' | 'nearest_agora';
};

export const DEFAULT_DOCUMENT_SETTINGS: IncomeDocumentSettings = {
  vat_mode: 'standard',
  amount_rounding: 'none',
};

export function parseDocumentSettingsJson(raw: unknown): IncomeDocumentSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_DOCUMENT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const vat_mode =
    o.vat_mode === 'exempt' || o.vat_mode === 'zero' || o.vat_mode === 'standard'
      ? o.vat_mode
      : DEFAULT_DOCUMENT_SETTINGS.vat_mode;
  const amount_rounding =
    o.amount_rounding === 'nearest_agora' ? 'nearest_agora' : DEFAULT_DOCUMENT_SETTINGS.amount_rounding;
  return { vat_mode, amount_rounding };
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
  subtotal_reference: number | null;
  vat_reference: number | null;
  grand_total_reference: number | null;
  subtotal_display: string;
  vat_display: string | null;
  grand_total_display: string;
  vat_rate_label: string | null;
};

export async function computeDraftTotalsPreview(
  lines: IncomeDraftLineRecord[],
  currency: string,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate?: string,
): Promise<DraftTotalsPreview> {
  const asOf = documentDate?.trim() || new Date().toISOString().slice(0, 10);
  const officialByCurrency = await resolveFxMapForDraftLines(lines, asOf);

  let subtotal = 0;
  let vat = 0;
  let hasAmount = false;
  for (const line of lines) {
    const fx = resolveLineFx(line, asOf, officialByCurrency);
    if (!fx) continue;
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, fx);
    if (amounts.line_net_ils != null) {
      subtotal += amounts.line_net_ils;
      hasAmount = true;
    }
    if (amounts.line_vat_ils != null) {
      vat += amounts.line_vat_ils;
    }
  }

  subtotal = roundAmount(subtotal, settings.amount_rounding);
  vat = roundAmount(vat, settings.amount_rounding);

  const displayCurrency = 'ILS';
  let vatLabel: string | null = null;
  if (settings.vat_mode === 'standard' && vat > 0) {
    vatLabel = vatResolution.standard_rate_percent_label;
  } else if (settings.vat_mode === 'zero') {
    vatLabel = '0%';
  }

  const grand = hasAmount
    ? roundAmount(subtotal + vat, settings.amount_rounding)
    : subtotal === 0 && lines.length > 0
      ? 0
      : null;

  const showVat =
    settings.vat_mode === 'standard' && (vat > 0 || (hasAmount && subtotal > 0));

  return {
    preview: true,
    not_financial_truth: true,
    currency: displayCurrency,
    line_count: lines.length,
    subtotal_reference: hasAmount ? subtotal : subtotal === 0 && lines.length > 0 ? 0 : null,
    vat_reference: showVat ? vat : settings.vat_mode === 'zero' ? 0 : null,
    grand_total_reference: grand,
    subtotal_display: formatMoneyReference(
      hasAmount ? subtotal : subtotal === 0 && lines.length > 0 ? 0 : null,
      displayCurrency,
    ),
    vat_display: showVat ? formatMoneyReference(vat, displayCurrency) : null,
    grand_total_display: formatMoneyReference(grand, displayCurrency),
    vat_rate_label: vatLabel,
  };
}
