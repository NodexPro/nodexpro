/**
 * Retainer — next document projection (read-model only, not a draft / not issued).
 */
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import { computeDraftTotalsPreview, parseDocumentSettingsJson, } from '../income/income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import { computeDraftLineAmounts, resolveLineFx, resolveFxMapForDraftLines } from '../income/income-draft-line-compute.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { computeNextUnitPriceBeforeVat, formatHebrewDateDisplay, } from './work-engine-invoice-retainer.pure.js';
function cloneStep(step) {
    return structuredClone(step);
}
function parseUnitPrice(value) {
    const num = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(num) ? num : 0;
}
function formatUnitPrice(value) {
    if (!Number.isFinite(value))
        return '';
    return String(value);
}
function applyPriceIncreaseToLines(step, profile) {
    if (!profile.price_increase_enabled)
        return step;
    const rows = step.line_items.rows.map((row, index) => {
        const current = parseUnitPrice(row.unit_price.value);
        const next = profile.price_increase_type === 'amount' && index > 0
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
function resolveProjectionSettings(step, profile) {
    const fromSnapshot = profile.document_template_snapshot?.document_settings_json ?? null;
    if (fromSnapshot)
        return parseDocumentSettingsJson(fromSnapshot);
    const vatMode = step.line_items.document_fields?.vat_mode?.value ?? 'standard';
    return parseDocumentSettingsJson({ vat_mode: vatMode, discount: { enabled: false, type: 'percent', value: 0 } });
}
function buildTotalsBlock(totals, settings, vatResolution) {
    const rows = [
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
            label: settings.vat_mode === 'standard'
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
async function rebuildProjectedLineTotals(step, orgId, documentDate, settings, vatResolution) {
    const lines = normalizeDraftLines(step.line_items.rows.map((row) => ({
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
    })));
    const currency = step.line_items.document_fields?.currency?.value ?? step.totals_block.currency ?? 'ILS';
    const totalsPreview = await computeDraftTotalsPreview(lines, currency, settings, vatResolution, documentDate);
    const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);
    const rows = step.line_items.rows.map((row) => {
        const line = lines.find((item) => item.line_id === row.line_id);
        if (!line)
            return row;
        const fx = resolveLineFx(line, documentDate, officialByCurrency);
        if (!fx)
            return row;
        const amounts = computeDraftLineAmounts(line, settings, vatResolution, fx);
        const display = amounts.line_net_ils != null
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
function buildPreviewInfoBlock(retainerSettings, nextDocumentDateDisplay) {
    const advanceDays = retainerSettings?.advance_days ?? null;
    return {
        title: 'המסמך הבא',
        document_type_label: retainerSettings?.document_type_label ?? null,
        next_document_date_display: nextDocumentDateDisplay,
        draft_review_date_label: 'טיוטה תיווצר לבדיקה',
        draft_review_date_display: retainerSettings?.draft_creation_date_display ?? null,
        draft_review_advance_note: advanceDays != null ? `(${advanceDays} ימים לפני מועד המסמך)` : null,
        profile_status_label: retainerSettings?.status_label ?? null,
    };
}
function stripProjectionDocumentNumbers(step) {
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
function applyNextDocumentDate(step, nextDocumentDate) {
    const settingsSchema = step.settings_schema.map((field) => field.key === 'document_date' ? { ...field, value: nextDocumentDate } : field);
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
        document_preview: null,
    };
}
function buildSaveAction(visible) {
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
function buildUnavailablePreview(message, retainerSettings = null) {
    const nextDocumentDateDisplay = retainerSettings?.next_document_date_display ??
        (retainerSettings?.next_document_date
            ? formatHebrewDateDisplay(retainerSettings.next_document_date)
            : null);
    return {
        status: 'unavailable',
        unavailable_message: message,
        projection_id: null,
        next_document_date: retainerSettings?.next_document_date ?? null,
        next_document_date_display: nextDocumentDateDisplay,
        price_increase_applied: false,
        price_increase_note: null,
        info_block: buildPreviewInfoBlock(retainerSettings, nextDocumentDateDisplay),
        document_details_step: null,
        save_action: buildSaveAction(false),
        allowed_actions: [],
    };
}
export function buildSetupTabs(preview) {
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
export async function buildNextDocumentPreview(params) {
    if (!params.profile || !params.retainerSettings?.profile_id) {
        return buildUnavailablePreview('שמור ריטיינר כדי לצפות במסמך הבא.', params.retainerSettings);
    }
    if (!params.baseStep) {
        return buildUnavailablePreview('אין תבנית מסמך זמינה לתצוגת המסמך הבא.', params.retainerSettings);
    }
    const nextDocumentDate = params.profile.next_document_date;
    const nextDocumentDateDisplay = formatHebrewDateDisplay(nextDocumentDate);
    let step = stripProjectionDocumentNumbers(cloneStep(params.baseStep));
    step.draft_id = `projection:${params.profile.id}:${nextDocumentDate}`;
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
        info_block: buildPreviewInfoBlock(params.retainerSettings, nextDocumentDateDisplay),
        document_details_step: step,
        save_action: buildSaveAction(true),
        allowed_actions: ['view_retainer_next_document_projection'],
    };
}
