import type { IncomeDraftLineRecord } from './income-document-draft-lines.pure.js';
import { formatMoneyReference } from './income-document-draft-lines.pure.js';

/** TEMPORARY_COUNTRY_PACK_PENDING — IL standard VAT rate fallback for draft preview only. */
export const IL_DRAFT_VAT_RATE = 0.17;

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

export function computeDraftTotalsPreview(
  lines: IncomeDraftLineRecord[],
  currency: string,
  settings: IncomeDocumentSettings,
): DraftTotalsPreview {
  let subtotal = 0;
  for (const line of lines) {
    if (line.amount_reference != null && Number.isFinite(line.amount_reference)) {
      subtotal += line.amount_reference;
    }
  }
  subtotal = roundAmount(subtotal, settings.amount_rounding);

  let vat: number | null = null;
  let vatLabel: string | null = null;
  if (settings.vat_mode === 'standard' && subtotal > 0) {
    vat = roundAmount(subtotal * IL_DRAFT_VAT_RATE, settings.amount_rounding);
    vatLabel = '17%';
  } else if (settings.vat_mode === 'zero') {
    vat = 0;
    vatLabel = '0%';
  }

  const grand =
    subtotal > 0
      ? roundAmount(subtotal + (vat ?? 0), settings.amount_rounding)
      : subtotal === 0
        ? 0
        : null;

  return {
    preview: true,
    not_financial_truth: true,
    currency,
    line_count: lines.length,
    subtotal_reference: subtotal > 0 ? subtotal : subtotal === 0 ? 0 : null,
    vat_reference: vat,
    grand_total_reference: grand,
    subtotal_display: formatMoneyReference(subtotal > 0 || subtotal === 0 ? subtotal : null, currency),
    vat_display: vat != null ? formatMoneyReference(vat, currency) : null,
    grand_total_display: formatMoneyReference(grand, currency),
    vat_rate_label: vatLabel,
  };
}
