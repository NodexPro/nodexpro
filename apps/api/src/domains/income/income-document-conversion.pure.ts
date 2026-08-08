/**
 * Quote / Deal Invoice → target draft conversion rules (backend-owned).
 * UI must not invent eligibility.
 */

import { randomUUID } from 'node:crypto';
import type { IncomeDocumentType } from './income.types.js';
import {
  normalizeDraftLines,
  serializeDraftLines,
  type IncomeDraftLineRecord,
} from './income-document-draft-lines.pure.js';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  parseDocumentSettingsJson,
  serializeDocumentSettingsJson,
  type IncomeDocumentSettings,
} from './income-document-draft-totals.pure.js';

/**
 * Cancel source Quote/Deal after conversion:
 * - status → cancelled_future (מבוטל), document kept in type history
 * - conversion rows are NEVER deleted
 * - open target drafts remain editable/issuable
 * - cancelled source cannot convert again
 */
export const CANCEL_SOURCE_CONVERSION_LINEAGE_RULE =
  'cancel_source_keeps_conversion_rows_and_open_target_drafts' as const;

export const INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT =
  'convert_income_document_to_draft' as const;
export const INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT =
  'cancel_income_preliminary_document' as const;

export type IncomeConversionSourceType = 'quote' | 'deal_invoice';
export type IncomeConversionTargetType = 'deal_invoice' | 'tax_invoice' | 'tax_invoice_receipt';

export type IncomeConversionTargetOption = {
  document_type: IncomeConversionTargetType;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
};

const TARGET_LABELS: Record<IncomeConversionTargetType, string> = {
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
};

export function isIncomeConversionSourceType(value: string): value is IncomeConversionSourceType {
  return value === 'quote' || value === 'deal_invoice';
}

export function isIncomeConversionTargetType(value: string): value is IncomeConversionTargetType {
  return value === 'deal_invoice' || value === 'tax_invoice' || value === 'tax_invoice_receipt';
}

export function conversionTypeKey(
  source: IncomeConversionSourceType,
  target: IncomeConversionTargetType,
): string {
  return `${source}_to_${target}`;
}

/** Allowed conversion matrix (V1). */
export function allowedConversionTargetsForSource(
  sourceType: string,
): IncomeConversionTargetType[] {
  if (sourceType === 'quote') return ['deal_invoice', 'tax_invoice', 'tax_invoice_receipt'];
  if (sourceType === 'deal_invoice') return ['tax_invoice', 'tax_invoice_receipt'];
  return [];
}

export function buildConversionTargetOptions(params: {
  sourceType: string;
  sourceStatus: string;
  canEdit: boolean;
}): IncomeConversionTargetOption[] {
  const targets = allowedConversionTargetsForSource(params.sourceType);
  return targets.map((document_type) => {
    let enabled = true;
    let disabled_reason: string | null = null;
    if (params.sourceStatus !== 'issued') {
      enabled = false;
      disabled_reason = 'ניתן להמיר רק מסמך פעיל';
    } else if (!params.canEdit) {
      enabled = false;
      disabled_reason = 'אין הרשאת עריכה';
    }
    return {
      document_type,
      label: TARGET_LABELS[document_type],
      enabled,
      disabled_reason,
    };
  });
}

/**
 * V1 conversion_state:
 * - cancelled source → null (not convertible)
 * - no children → active
 * - open draft child and/or issued child → converted when no further open slots? 
 *   Safer product: active while convertible; converted when ≥1 child; partially_converted unused for V1
 *   Spec asks: active / converted / partially_converted
 *   V1: active = no conversion rows; converted = has any conversion; partially_converted unused (=converted)
 */
export function resolveConversionStateKey(params: {
  sourceStatus: string;
  conversionCount: number;
}): 'active' | 'converted' | 'partially_converted' | 'cancelled' {
  if (params.sourceStatus === 'cancelled_future') return 'cancelled';
  if (params.conversionCount <= 0) return 'active';
  return 'converted';
}

/** Map issued lines snapshot → draft lines (new line_ids). */
export function draftLinesFromIssuedSnapshot(
  linesSnapshot: unknown,
  documentCurrency: string,
): IncomeDraftLineRecord[] {
  const arr = Array.isArray(linesSnapshot) ? linesSnapshot : [];
  const mapped = arr.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    return {
      line_id: randomUUID(),
      sort_index: index,
      description: String(o.description ?? o.name ?? o.title ?? '').trim(),
      quantity: Number(o.quantity),
      unit_price_reference: Number(o.unit_price_reference ?? o.unit_price),
      currency: o.currency ?? documentCurrency ?? 'ILS',
      exchange_rate_to_ils_override: o.exchange_rate_to_ils_override ?? null,
      price_includes_vat: o.price_includes_vat,
      vat_rate_code: o.vat_rate_code,
      amount_reference: Number(o.amount_reference ?? o.amount),
    };
  });
  return normalizeDraftLines(mapped.filter(Boolean));
}

export function serializeConvertedDraftLines(lines: IncomeDraftLineRecord[]): unknown[] {
  return serializeDraftLines(lines);
}

export function documentTypeLabelHe(type: IncomeDocumentType | string): string {
  switch (type) {
    case 'quote':
      return 'הצעת מחיר';
    case 'deal_invoice':
      return 'חשבון עסקה';
    case 'tax_invoice':
      return 'חשבונית מס';
    case 'tax_invoice_receipt':
      return 'חשבונית מס/קבלה';
    case 'receipt':
      return 'קבלה';
    case 'credit_tax_invoice':
      return 'חשבונית מס זיכוי';
    default:
      return String(type);
  }
}

export function isPreliminaryCancellableType(type: string): boolean {
  return type === 'quote' || type === 'deal_invoice';
}

export function isTaxDocumentDirectCancelForbidden(type: string): boolean {
  return type === 'tax_invoice' || type === 'tax_invoice_receipt';
}

/**
 * Canonical document-level discount lives in draft document_settings_json.discount.
 * Prefer source draft settings; if missing, recover fixed amount from issued totals snapshot
 * so converted draft totals can reconcile (same settings contract — no new discount field).
 */
export function resolveDocumentSettingsForConversion(params: {
  sourceDraftSettingsJson: unknown;
  sourceTotalsSnapshotJson: unknown;
}): IncomeDocumentSettings {
  const fromDraft = parseDocumentSettingsJson(params.sourceDraftSettingsJson);
  const hasDraftDiscountShape =
    params.sourceDraftSettingsJson != null &&
    typeof params.sourceDraftSettingsJson === 'object' &&
    !Array.isArray(params.sourceDraftSettingsJson) &&
    'discount' in (params.sourceDraftSettingsJson as Record<string, unknown>);

  if (hasDraftDiscountShape || fromDraft.discount.enabled) {
    return {
      ...fromDraft,
      // Conversion must not inherit retainer template markers.
      retainer_template: undefined,
    };
  }

  const totals =
    params.sourceTotalsSnapshotJson &&
    typeof params.sourceTotalsSnapshotJson === 'object' &&
    !Array.isArray(params.sourceTotalsSnapshotJson)
      ? (params.sourceTotalsSnapshotJson as Record<string, unknown>)
      : null;
  if (totals?.discount_enabled === true) {
    const amount = Number(totals.discount_amount_reference);
    const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    return {
      ...DEFAULT_DOCUMENT_SETTINGS,
      vat_mode: fromDraft.vat_mode,
      amount_rounding: fromDraft.amount_rounding,
      discount: {
        enabled: true,
        type: 'fixed_amount',
        value: safeAmount,
      },
    };
  }

  return {
    ...fromDraft,
    retainer_template: undefined,
  };
}

export function serializeConversionDocumentSettings(
  settings: IncomeDocumentSettings,
): Record<string, unknown> {
  return serializeDocumentSettingsJson({
    ...settings,
    retainer_template: undefined,
  });
}

export type ConversionIssueLinkDecision =
  | { action: 'noop' }
  | { action: 'link' }
  | { action: 'idempotent' }
  | { action: 'conflict'; reason: string };

/** Issue-path decision for income_document_conversions.target_document_id. */
export function decideConversionTargetDocumentLink(params: {
  conversionRow: { target_document_id: string | null } | null;
  issuedDocumentId: string;
}): ConversionIssueLinkDecision {
  if (!params.conversionRow) return { action: 'noop' };
  const existing = params.conversionRow.target_document_id;
  if (!existing) return { action: 'link' };
  if (existing === params.issuedDocumentId) return { action: 'idempotent' };
  return {
    action: 'conflict',
    reason: 'Conversion already linked to a different issued document',
  };
}

/** Walk explicit conversion IDs: start issued doc → linked issued targets. */
export function resolveIssuedConversionChain(params: {
  startDocumentId: string;
  conversions: Array<{
    source_document_id: string;
    target_document_id: string | null;
  }>;
}): string[] {
  const bySource = new Map<string, string[]>();
  for (const row of params.conversions) {
    if (!row.target_document_id) continue;
    const list = bySource.get(row.source_document_id) ?? [];
    list.push(row.target_document_id);
    bySource.set(row.source_document_id, list);
  }
  const chain: string[] = [params.startDocumentId];
  const seen = new Set<string>([params.startDocumentId]);
  let cursor = params.startDocumentId;
  while (true) {
    const next = bySource.get(cursor)?.[0];
    if (!next || seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    cursor = next;
  }
  return chain;
}
