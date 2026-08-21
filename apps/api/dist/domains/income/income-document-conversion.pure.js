/**
 * Quote / Deal Invoice → target draft conversion rules (backend-owned).
 * UI must not invent eligibility.
 */
import { randomUUID } from 'node:crypto';
import { normalizeDraftLines, serializeDraftLines, } from './income-document-draft-lines.pure.js';
import { DEFAULT_DOCUMENT_SETTINGS, parseDocumentSettingsJson, serializeDocumentSettingsJson, } from './income-document-draft-totals.pure.js';
/**
 * Cancel source Quote/Deal after conversion:
 * - status → cancelled_future (מבוטל), document kept in type history
 * - conversion rows are NEVER deleted
 * - open target drafts remain editable/issuable
 * - cancelled source cannot convert again
 */
export const CANCEL_SOURCE_CONVERSION_LINEAGE_RULE = 'cancel_source_keeps_conversion_rows_and_open_target_drafts';
export const INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT = 'convert_income_document_to_draft';
export const INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT = 'cancel_income_preliminary_document';
export const INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT = 'begin_edit_income_preliminary_document';
/** Stored in draft document_settings_json to reuse one open edit draft per source. */
export const PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY = 'preliminary_edit_source_document_id';
/** Stable backend reason when Issue is attempted on a preliminary-edit staging draft. */
export const PRELIMINARY_EDIT_CANNOT_ISSUE_CODE = 'preliminary_edit_cannot_issue';
export const PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE = 'זהו עריכת מסמך קיים (הצעת מחיר / חשבון עסקה). יש לשמור את השינויים — לא להפיק מסמך חדש.';
/** Stable backend reason when preliminary-edit document_date is before original issue_date. */
export const PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE = 'preliminary_edit_date_before_original';
export const PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE = 'לא ניתן להקדים את תאריך המסמך לפני התאריך המקורי.';
function isBlankDate(value) {
    return value == null || String(value).trim() === '';
}
function isIsoDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/**
 * Null-only heal for preliminary-edit staging drafts on Pencil replay.
 * Preserves any already-entered staging dates.
 */
export function decidePreliminaryEditStagingDateHeal(params) {
    const patch = {};
    const sourceIssue = typeof params.sourceIssueDate === 'string' && isIsoDateOnly(params.sourceIssueDate.trim())
        ? params.sourceIssueDate.trim()
        : null;
    const sourceDue = typeof params.sourceDueDate === 'string' && isIsoDateOnly(params.sourceDueDate.trim())
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
export function decidePreliminaryEditDocumentDateGuard(params) {
    const sourceDocumentId = readPreliminaryEditSourceDocumentId(params.documentSettingsJson);
    if (!sourceDocumentId)
        return { action: 'noop' };
    const original = typeof params.originalIssueDate === 'string' && isIsoDateOnly(params.originalIssueDate.trim())
        ? params.originalIssueDate.trim()
        : null;
    const requested = typeof params.requestedDocumentDate === 'string' &&
        isIsoDateOnly(params.requestedDocumentDate.trim())
        ? params.requestedDocumentDate.trim()
        : null;
    if (!original || !requested)
        return { action: 'allow' };
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
export function readPreliminaryEditSourceDocumentId(documentSettingsJson) {
    if (!documentSettingsJson ||
        typeof documentSettingsJson !== 'object' ||
        Array.isArray(documentSettingsJson)) {
        return null;
    }
    const sourceId = documentSettingsJson[PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY];
    return typeof sourceId === 'string' && sourceId.trim() ? sourceId.trim() : null;
}
/**
 * Canonical Issue guard decision (pure). Caller must reject before numbering / insert.
 */
export function decidePreliminaryEditIssueGuard(documentSettingsJson) {
    const sourceDocumentId = readPreliminaryEditSourceDocumentId(documentSettingsJson);
    if (!sourceDocumentId)
        return { action: 'allow' };
    return {
        action: 'reject',
        code: PRELIMINARY_EDIT_CANNOT_ISSUE_CODE,
        message: PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE,
        source_document_id: sourceDocumentId,
    };
}
export function buildPreliminaryDocumentEditMode(params) {
    const sourceDocumentId = readPreliminaryEditSourceDocumentId(params.documentSettingsJson);
    if (!sourceDocumentId || !params.documentType)
        return null;
    return {
        type: 'preliminary_document_edit',
        source_document_id: sourceDocumentId,
        source_document_number: params.documentNumberPreview,
        source_document_type: params.documentType,
    };
}
export function buildWizardSessionActions(params) {
    const isPreliminaryEdit = params.editMode?.type === 'preliminary_document_edit';
    const isCreditNote = !isPreliminaryEdit && params.documentType === 'credit_tax_invoice';
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
            label: isPreliminaryEdit || isCreditNote ? 'שמירה' : 'שמירת טיוטה',
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
            command: params.canIssue && !isPreliminaryEdit ? 'issue_and_send_income_document' : null,
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
const TARGET_LABELS = {
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס/קבלה',
};
export function isIncomeConversionSourceType(value) {
    return value === 'quote' || value === 'deal_invoice';
}
export function isIncomeConversionTargetType(value) {
    return value === 'deal_invoice' || value === 'tax_invoice' || value === 'tax_invoice_receipt';
}
export function conversionTypeKey(source, target) {
    return `${source}_to_${target}`;
}
/** Allowed conversion matrix (V1). */
export function allowedConversionTargetsForSource(sourceType) {
    if (sourceType === 'quote')
        return ['deal_invoice', 'tax_invoice', 'tax_invoice_receipt'];
    if (sourceType === 'deal_invoice')
        return ['tax_invoice', 'tax_invoice_receipt'];
    return [];
}
export function buildConversionTargetOptions(params) {
    const targets = allowedConversionTargetsForSource(params.sourceType);
    return targets.map((document_type) => {
        let enabled = true;
        let disabled_reason = null;
        if (params.sourceStatus !== 'issued') {
            enabled = false;
            disabled_reason = 'ניתן להמיר רק מסמך פעיל';
        }
        else if (!params.canEdit) {
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
export function resolveConversionStateKey(params) {
    if (params.sourceStatus === 'cancelled_future')
        return 'cancelled';
    if (params.conversionCount <= 0)
        return 'active';
    return 'converted';
}
/** Map issued lines snapshot → draft lines (new line_ids). */
export function draftLinesFromIssuedSnapshot(linesSnapshot, documentCurrency) {
    const arr = Array.isArray(linesSnapshot) ? linesSnapshot : [];
    const mapped = arr.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return null;
        const o = raw;
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
export function serializeConvertedDraftLines(lines) {
    return serializeDraftLines(lines);
}
export function documentTypeLabelHe(type) {
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
export function isPreliminaryCancellableType(type) {
    return type === 'quote' || type === 'deal_invoice';
}
/** Quote / Deal Invoice may open an edit draft while active (not cancelled). */
export function isPreliminaryEditableType(type) {
    return type === 'quote' || type === 'deal_invoice';
}
export function buildPreliminaryEditAction(params) {
    let enabled = true;
    let disabled_reason = null;
    if (params.sourceStatus === 'cancelled_future') {
        enabled = false;
        disabled_reason = 'המסמך מבוטל ואינו ניתן לעריכה';
    }
    else if (params.sourceStatus !== 'issued') {
        enabled = false;
        disabled_reason = 'ניתן לערוך רק מסמך פעיל';
    }
    else if (!params.canEdit) {
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
export function isTaxDocumentDirectCancelForbidden(type) {
    return type === 'tax_invoice' || type === 'tax_invoice_receipt';
}
/**
 * Canonical document-level discount lives in draft document_settings_json.discount.
 * Prefer source draft settings; if missing, recover fixed amount from issued totals snapshot
 * so converted draft totals can reconcile (same settings contract — no new discount field).
 */
export function resolveDocumentSettingsForConversion(params) {
    const fromDraft = parseDocumentSettingsJson(params.sourceDraftSettingsJson);
    const hasDraftDiscountShape = params.sourceDraftSettingsJson != null &&
        typeof params.sourceDraftSettingsJson === 'object' &&
        !Array.isArray(params.sourceDraftSettingsJson) &&
        'discount' in params.sourceDraftSettingsJson;
    if (hasDraftDiscountShape || fromDraft.discount.enabled) {
        return {
            ...fromDraft,
            // Conversion must not inherit retainer template markers.
            retainer_template: undefined,
        };
    }
    const totals = params.sourceTotalsSnapshotJson &&
        typeof params.sourceTotalsSnapshotJson === 'object' &&
        !Array.isArray(params.sourceTotalsSnapshotJson)
        ? params.sourceTotalsSnapshotJson
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
export function serializeConversionDocumentSettings(settings) {
    return serializeDocumentSettingsJson({
        ...settings,
        retainer_template: undefined,
    });
}
/** Issue-path decision for income_document_conversions.target_document_id. */
export function decideConversionTargetDocumentLink(params) {
    if (!params.conversionRow)
        return { action: 'noop' };
    const existing = params.conversionRow.target_document_id;
    if (!existing)
        return { action: 'link' };
    if (existing === params.issuedDocumentId)
        return { action: 'idempotent' };
    return {
        action: 'conflict',
        reason: 'Conversion already linked to a different issued document',
    };
}
/** Walk explicit conversion IDs: start issued doc → linked issued targets. */
export function resolveIssuedConversionChain(params) {
    const bySource = new Map();
    for (const row of params.conversions) {
        if (!row.target_document_id)
            continue;
        const list = bySource.get(row.source_document_id) ?? [];
        list.push(row.target_document_id);
        bySource.set(row.source_document_id, list);
    }
    const chain = [params.startDocumentId];
    const seen = new Set([params.startDocumentId]);
    let cursor = params.startDocumentId;
    while (true) {
        const next = bySource.get(cursor)?.[0];
        if (!next || seen.has(next))
            break;
        chain.push(next);
        seen.add(next);
        cursor = next;
    }
    return chain;
}
