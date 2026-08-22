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
export const INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT =
  'begin_edit_income_preliminary_document' as const;

/** Stored in draft document_settings_json to reuse one open edit draft per source. */
export const PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY =
  'preliminary_edit_source_document_id' as const;

/** Stable backend reason when Issue is attempted on a preliminary-edit staging draft. */
export const PRELIMINARY_EDIT_CANNOT_ISSUE_CODE = 'preliminary_edit_cannot_issue' as const;

export const PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE =
  'זהו עריכת מסמך קיים (הצעת מחיר / חשבון עסקה). יש לשמור את השינויים — לא להפיק מסמך חדש.' as const;

/** Stable backend reason when preliminary-edit document_date is before original issue_date. */
export const PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE =
  'preliminary_edit_date_before_original' as const;

export const PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE =
  'לא ניתן להקדים את תאריך המסמך לפני התאריך המקורי.' as const;

function isBlankDate(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === '';
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Null-only heal for preliminary-edit staging drafts on Pencil replay.
 * Preserves any already-entered staging dates.
 */
export function decidePreliminaryEditStagingDateHeal(params: {
  stagingDocumentDate: string | null | undefined;
  stagingDueDate: string | null | undefined;
  sourceIssueDate: string | null | undefined;
  sourceDueDate: string | null | undefined;
}): {
  document_date?: string;
  due_date?: string;
} {
  const patch: { document_date?: string; due_date?: string } = {};
  const sourceIssue =
    typeof params.sourceIssueDate === 'string' && isIsoDateOnly(params.sourceIssueDate.trim())
      ? params.sourceIssueDate.trim()
      : null;
  const sourceDue =
    typeof params.sourceDueDate === 'string' && isIsoDateOnly(params.sourceDueDate.trim())
      ? params.sourceDueDate.trim()
      : null;

  if (isBlankDate(params.stagingDocumentDate) && sourceIssue) {
    patch.document_date = sourceIssue;
  }
  if (isBlankDate(params.stagingDueDate) && sourceDue) {
    patch.due_date = sourceDue;
  }
  return patch;
}

/**
 * Canonical preliminary-edit document_date floor decision (pure).
 * Caller must reject before mutating staging / source.
 */
export function decidePreliminaryEditDocumentDateGuard(params: {
  documentSettingsJson: unknown;
  originalIssueDate: string | null | undefined;
  requestedDocumentDate: string | null | undefined;
}):
  | { action: 'allow' }
  | {
      action: 'reject';
      code: typeof PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE;
      message: typeof PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE;
      original_issue_date: string;
      requested_document_date: string;
    }
  | { action: 'noop' } {
  const sourceDocumentId = readPreliminaryEditSourceDocumentId(params.documentSettingsJson);
  if (!sourceDocumentId) return { action: 'noop' };

  const original =
    typeof params.originalIssueDate === 'string' && isIsoDateOnly(params.originalIssueDate.trim())
      ? params.originalIssueDate.trim()
      : null;
  const requested =
    typeof params.requestedDocumentDate === 'string' &&
    isIsoDateOnly(params.requestedDocumentDate.trim())
      ? params.requestedDocumentDate.trim()
      : null;
  if (!original || !requested) return { action: 'allow' };
  if (requested < original) {
    return {
      action: 'reject',
      code: PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE,
      message: PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE,
      original_issue_date: original,
      requested_document_date: requested,
    };
  }
  return { action: 'allow' };
}

export type PreliminaryDocumentEditMode = {
  type: 'preliminary_document_edit';
  source_document_id: string;
  source_document_number: string | null;
  source_document_type: string;
};

export type WizardSessionAction = {
  enabled: boolean;
  command: string | null;
  label: string;
  disabled_reason: string | null;
  presentation?: 'button' | 'icon';
  icon?: 'eye' | null;
};

export type WizardSessionFooterMode = 'preliminary_edit' | 'wizard' | 'credit_note' | 'conversion';

export type WizardSessionFooterPresentation = {
  mode: WizardSessionFooterMode;
  show_back: boolean;
  show_next: boolean;
  show_save: boolean;
  show_preview: boolean;
  show_issue: boolean;
  close_after_save: boolean;
  close_control: 'icon' | 'text';
};

/** Backend-owned conversion lineage display for a converted draft (from income_document_conversions). */
export type ConversionDraftSourceRef = {
  source_document_id: string;
  source_document_number: string | null;
  source_document_type: string;
  source_document_type_label: string;
  /** Ready-to-render Hebrew line, e.g. הופק בגין הצעת מחיר מספר 2000 */
  display_line: string;
};

export function buildConversionSourceDisplayLine(params: {
  sourceDocumentTypeLabel: string;
  sourceDocumentNumber: string | null;
}): string {
  const typeLabel = params.sourceDocumentTypeLabel.trim() || 'מסמך';
  const number = (params.sourceDocumentNumber ?? '').trim();
  if (number) return `הופק בגין ${typeLabel} מספר ${number}`;
  return `הופק בגין ${typeLabel}`;
}

export function buildConversionDraftSourceRef(params: {
  sourceDocumentId: string;
  sourceDocumentType: string;
  sourceDocumentNumber: string | null;
}): ConversionDraftSourceRef {
  const source_document_type_label = documentTypeLabelHe(params.sourceDocumentType);
  return {
    source_document_id: params.sourceDocumentId,
    source_document_number: params.sourceDocumentNumber,
    source_document_type: params.sourceDocumentType,
    source_document_type_label,
    display_line: buildConversionSourceDisplayLine({
      sourceDocumentTypeLabel: source_document_type_label,
      sourceDocumentNumber: params.sourceDocumentNumber,
    }),
  };
}

export type WizardSessionActions = {
  save: WizardSessionAction;
  preview: WizardSessionAction;
  issue: WizardSessionAction;
  issue_and_send: WizardSessionAction;
  footer: WizardSessionFooterPresentation;
};

export function readPreliminaryEditSourceDocumentId(
  documentSettingsJson: unknown,
): string | null {
  if (
    !documentSettingsJson ||
    typeof documentSettingsJson !== 'object' ||
    Array.isArray(documentSettingsJson)
  ) {
    return null;
  }
  const sourceId = (documentSettingsJson as Record<string, unknown>)[
    PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY
  ];
  return typeof sourceId === 'string' && sourceId.trim() ? sourceId.trim() : null;
}

/**
 * Canonical Issue guard decision (pure). Caller must reject before numbering / insert.
 */
export function decidePreliminaryEditIssueGuard(documentSettingsJson: unknown):
  | { action: 'allow' }
  | {
      action: 'reject';
      code: typeof PRELIMINARY_EDIT_CANNOT_ISSUE_CODE;
      message: typeof PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE;
      source_document_id: string;
    } {
  const sourceDocumentId = readPreliminaryEditSourceDocumentId(documentSettingsJson);
  if (!sourceDocumentId) return { action: 'allow' };
  return {
    action: 'reject',
    code: PRELIMINARY_EDIT_CANNOT_ISSUE_CODE,
    message: PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE,
    source_document_id: sourceDocumentId,
  };
}

export function buildPreliminaryDocumentEditMode(params: {
  documentSettingsJson: unknown;
  documentType: string | null;
  documentNumberPreview: string | null;
}): PreliminaryDocumentEditMode | null {
  const sourceDocumentId = readPreliminaryEditSourceDocumentId(params.documentSettingsJson);
  if (!sourceDocumentId || !params.documentType) return null;
  return {
    type: 'preliminary_document_edit',
    source_document_id: sourceDocumentId,
    source_document_number: params.documentNumberPreview,
    source_document_type: params.documentType,
  };
}

export function buildWizardSessionActions(params: {
  canEdit: boolean;
  canIssue: boolean;
  editMode: PreliminaryDocumentEditMode | null;
  documentType?: string | null;
  conversionSource?: ConversionDraftSourceRef | null;
}): WizardSessionActions {
  const isPreliminaryEdit = params.editMode?.type === 'preliminary_document_edit';
  const isConversionDraft = !isPreliminaryEdit && Boolean(params.conversionSource);
  const isCreditNote =
    !isPreliminaryEdit && !isConversionDraft && params.documentType === 'credit_tax_invoice';
  return {
    save: {
      enabled: isCreditNote ? params.canIssue : params.canEdit,
      command: isCreditNote
        ? params.canIssue
          ? 'issue_income_document'
          : null
        : params.canEdit
          ? 'save_income_document_draft'
          : null,
      label: isPreliminaryEdit || isCreditNote || isConversionDraft ? 'שמירה' : 'שמירת טיוטה',
      disabled_reason: isCreditNote
        ? params.canIssue
          ? null
          : 'נדרשת הרשאת הפקה'
        : params.canEdit
          ? null
          : 'נדרשת הרשאת עריכה',
    },
    preview: {
      enabled: params.canEdit,
      command: params.canEdit ? 'generate_income_document_preview' : null,
      label: 'תצוגה מקדימה',
      disabled_reason: params.canEdit ? null : 'נדרשת הרשאת עריכה',
      presentation: isCreditNote ? 'icon' : 'button',
      icon: isCreditNote ? 'eye' : null,
    },
    issue: {
      enabled: params.canIssue && !isPreliminaryEdit,
      command: params.canIssue && !isPreliminaryEdit ? 'issue_income_document' : null,
      label: 'הפק מסמך',
      disabled_reason: isPreliminaryEdit
        ? PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE
        : params.canIssue
          ? null
          : 'נדרשת הרשאת הפקה',
    },
    issue_and_send: {
      enabled: params.canIssue && !isPreliminaryEdit,
      command:
        params.canIssue && !isPreliminaryEdit ? 'issue_and_send_income_document' : null,
      label: 'הפק ושלח',
      disabled_reason: isPreliminaryEdit
        ? PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE
        : params.canIssue
          ? null
          : 'נדרשת הרשאת הפקה',
    },
    footer: isPreliminaryEdit
      ? {
          mode: 'preliminary_edit',
          show_back: false,
          show_next: false,
          show_save: true,
          show_preview: true,
          show_issue: false,
          close_after_save: true,
          close_control: 'icon',
        }
      : isConversionDraft
        ? {
            mode: 'conversion',
            show_back: false,
            show_next: false,
            // Converted draft: produce via issue only — no footer שמירה.
            show_save: false,
            show_preview: true,
            show_issue: true,
            close_after_save: false,
            close_control: 'icon',
          }
      : isCreditNote
        ? {
            mode: 'credit_note',
            show_back: false,
            show_next: false,
            show_save: true,
            show_preview: true,
            show_issue: false,
            close_after_save: true,
            close_control: 'icon',
          }
        : {
            mode: 'wizard',
            show_back: true,
            show_next: true,
            show_save: true,
            show_preview: true,
            show_issue: true,
            close_after_save: false,
            close_control: 'text',
          },
  };
}

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

/** Quote / Deal Invoice may open an edit draft while active (not cancelled). */
export function isPreliminaryEditableType(type: string): boolean {
  return type === 'quote' || type === 'deal_invoice';
}

export function buildPreliminaryEditAction(params: {
  sourceStatus: string;
  canEdit: boolean;
}): {
  enabled: boolean;
  label: string;
  command: typeof INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT;
  disabled_reason: string | null;
} {
  let enabled = true;
  let disabled_reason: string | null = null;
  if (params.sourceStatus === 'cancelled_future') {
    enabled = false;
    disabled_reason = 'המסמך מבוטל ואינו ניתן לעריכה';
  } else if (params.sourceStatus !== 'issued') {
    enabled = false;
    disabled_reason = 'ניתן לערוך רק מסמך פעיל';
  } else if (!params.canEdit) {
    enabled = false;
    disabled_reason = 'אין הרשאת עריכה';
  }
  return {
    enabled,
    label: 'עריכה',
    command: INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
    disabled_reason,
  };
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
