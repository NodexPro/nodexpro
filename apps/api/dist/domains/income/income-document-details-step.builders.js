import { formatMoneyReference, normalizeDraftLines, } from './income-document-draft-lines.pure.js';
import { allowedCurrencyOptions } from './income-draft-exchange-rate.pure.js';
import { computeDraftLineAmounts, recomputeDraftLineAmounts, resolveFxMapForDraftLines, resolveLineFx, } from './income-draft-line-compute.pure.js';
import { computeDraftTotalsPreview, parseDocumentSettingsJson, } from './income-document-draft-totals.pure.js';
import { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';
import { compactVatSelectLabel, readVatResolutionFromDraftPreview, } from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import { loadIncomeRecipientById } from './income-recipient.service.js';
const DOCUMENT_TYPE_LABELS = {
    receipt: 'קבלה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס קבלה',
    credit_tax_invoice: 'חשבונית מס זיכוי',
    deal_invoice: 'חשבונית עסקה',
    quote: 'הצעת מחיר',
};
const CURRENCY_OPTIONS = [
    { value: 'ILS', label: '₪' },
    { value: 'USD', label: '$' },
    { value: 'EUR', label: '€' },
];
function effectiveVatModeForUi(vatMode) {
    return vatMode === 'standard' ? 'standard' : 'exempt';
}
function buildDocumentLineTableFields(row, settings, vatResolution, canEdit) {
    const vatUi = effectiveVatModeForUi(settings.vat_mode);
    return {
        currency: {
            input_type: 'select',
            value: row.currency,
            options: [...CURRENCY_OPTIONS],
            editable: canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
        vat_mode: {
            input_type: 'select',
            value: vatUi,
            options: [
                { value: 'standard', label: compactVatSelectLabel(vatResolution) },
                { value: 'exempt', label: 'פטור' },
            ],
            editable: canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
    };
}
function readWizardUiCacheFromDraftPreview(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { document_number_preview: null, recipient_display_name: null };
    }
    const o = raw;
    return {
        document_number_preview: typeof o.document_number_preview === 'string' ? o.document_number_preview : null,
        recipient_display_name: typeof o.recipient_display_name === 'string' ? o.recipient_display_name : null,
    };
}
function recipientDisplayNameFromRow(row) {
    const snap = row.one_time_customer_snapshot_json;
    if (snap && typeof snap.display_name === 'string' && snap.display_name.trim()) {
        return snap.display_name.trim();
    }
    return null;
}
async function resolveRecipientDisplayName(scope, row) {
    if (row.income_customer_id) {
        const customer = await loadIncomeRecipientById(scope, row.income_customer_id);
        if (customer?.display_name?.trim())
            return customer.display_name.trim();
    }
    const snap = row.one_time_customer_snapshot_json;
    if (snap && typeof snap.display_name === 'string' && snap.display_name.trim()) {
        return snap.display_name.trim();
    }
    return '—';
}
export { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';
function buildSettingsSchema(row, docType, canEdit, vatResolution) {
    const settings = parseDocumentSettingsJson(row.document_settings_json);
    const paymentNote = row.payment_received_json && typeof row.payment_received_json.note === 'string'
        ? row.payment_received_json.note
        : '';
    const fields = [
        {
            key: 'document_date',
            label: 'תאריך מסמך',
            input_type: 'date',
            value: row.document_date,
            required: true,
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
        {
            key: 'currency',
            label: 'מטבע',
            input_type: 'select',
            value: row.currency,
            required: true,
            options: [
                { value: 'ILS', label: '₪ שקל' },
                { value: 'USD', label: '$ דולר' },
                { value: 'EUR', label: '€ אירו' },
            ],
            visible: false,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
        {
            key: 'language',
            label: 'שפה',
            input_type: 'select',
            value: row.language,
            required: true,
            options: [
                { value: 'he', label: 'עברית' },
                { value: 'en', label: 'English' },
            ],
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
        {
            key: 'vat_mode',
            label: 'מע״מ מסמך',
            input_type: 'select',
            value: effectiveVatModeForUi(settings.vat_mode),
            required: true,
            options: [
                { value: 'standard', label: vatResolution.standard_vat_mode_option_label },
                { value: 'exempt', label: 'פטור ממע״מ' },
            ],
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
        {
            key: 'amount_rounding',
            label: 'עיגול סכום',
            input_type: 'select',
            value: settings.amount_rounding,
            required: false,
            options: [
                { value: 'none', label: 'ללא עיגול' },
                { value: 'nearest_agora', label: 'עיגול לאגורה' },
            ],
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        },
    ];
    if (docType?.requires_due_date) {
        fields.push({
            key: 'due_date',
            label: 'תאריך לתשלום',
            input_type: 'date',
            value: row.due_date,
            required: false,
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        });
    }
    if (docType?.requires_payment_received) {
        fields.push({
            key: 'payment_received_note',
            label: 'פרטי תשלום',
            input_type: 'text',
            value: paymentNote || null,
            required: false,
            visible: true,
            disabled: !canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
        });
    }
    return fields;
}
const PRICE_MODE_OPTIONS = [
    { value: false, label: 'לפני מע״מ' },
    { value: true, label: 'כולל מע״מ' },
];
function lineAllowedVatRates(settings, vatResolution) {
    if (settings.vat_mode === 'exempt') {
        return [{ value: 'exempt', label: 'פטור' }];
    }
    return [
        { value: 'standard', label: compactVatSelectLabel(vatResolution) },
        { value: 'exempt', label: 'פטור' },
    ];
}
async function buildLineRows(lines, settings, vatResolution, documentDate, canEdit) {
    const currencyOptions = allowedCurrencyOptions();
    const allowedVatRates = lineAllowedVatRates(settings, vatResolution);
    const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);
    return lines.map((line, index) => {
        const fx = resolveLineFx(line, documentDate, officialByCurrency);
        const field_errors = [];
        let amounts = {
            line_total_ils: null,
            exchange_rate_effective: 1,
        };
        if (!fx && line.currency !== 'ILS') {
            field_errors.push({
                code: 'exchange_rate_unavailable',
                message: 'לא ניתן לטעון שער יציג מבנק ישראל לתאריך המסמך',
            });
        }
        else if (fx) {
            const computed = computeDraftLineAmounts(line, settings, vatResolution, fx);
            amounts = {
                line_total_ils: computed.line_total_ils,
                exchange_rate_effective: computed.exchange_rate_effective,
            };
        }
        const vatLabel = allowedVatRates.find((o) => o.value === line.vat_rate_code)?.label ??
            (line.vat_rate_code === 'exempt' ? 'פטור' : compactVatSelectLabel(vatResolution));
        const lineTotalDisplay = formatMoneyReference(amounts.line_total_ils, 'ILS');
        const showFx = line.currency !== 'ILS';
        return {
            id: line.line_id,
            line_id: line.line_id,
            row_number: index + 1,
            can_drag: canEdit && lines.length > 1,
            description: {
                value: line.description,
                editable: canEdit,
                placeholder: 'תיאור שירות או מוצר',
            },
            quantity: { value: String(line.quantity), editable: canEdit },
            unit_price: {
                value: line.unit_price_reference != null ? String(line.unit_price_reference) : '',
                editable: canEdit,
            },
            currency: {
                value: line.currency,
                editable: canEdit,
                options: currencyOptions.map((o) => ({ value: o.value, label: o.label })),
            },
            allowed_currencies: currencyOptions.map((o) => ({ value: o.value, label: o.label })),
            vat_rate_code: line.vat_rate_code,
            vat_rate_label: vatLabel,
            allowed_vat_rates: allowedVatRates,
            price_includes_vat: line.price_includes_vat,
            price_mode_options: PRICE_MODE_OPTIONS,
            exchange_rate_official: showFx ? (fx?.rate_official_display ?? null) : null,
            exchange_rate_effective: showFx ? fx?.rate_display ?? null : '1.0000',
            exchange_rate_default: showFx ? (fx?.rate_official_display ?? null) : null,
            exchange_rate_override: showFx
                ? {
                    value: line.exchange_rate_to_ils_override != null
                        ? String(line.exchange_rate_to_ils_override)
                        : '',
                    editable: canEdit,
                }
                : null,
            exchange_rate_date: showFx ? (fx?.exchange_rate_date ?? documentDate) : null,
            exchange_rate_source_label: showFx ? (fx?.source_label ?? null) : null,
            exchange_rate_editable: showFx && canEdit,
            line_total_display: lineTotalDisplay,
            line_total: { display: lineTotalDisplay },
            field_errors,
            allowed_actions: canEdit
                ? [
                    'update_income_document_line',
                    'delete_income_document_line',
                    'reorder_income_document_lines',
                ]
                : [],
        };
    });
}
export async function buildIncomeDocumentDetailsStep(scope, row, docType, canEdit, options = {}) {
    const settings = parseDocumentSettingsJson(row.document_settings_json);
    const documentDate = row.document_date ?? new Date().toISOString().slice(0, 10);
    const vatResolution = options.vatResolution ??
        readVatResolutionFromDraftPreview(row.draft_totals_preview_json, documentDate) ??
        (await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate));
    const lines = await recomputeDraftLineAmounts(normalizeDraftLines(row.draft_lines_json), settings, vatResolution, documentDate);
    const totals = options.totalsPreview ??
        (await computeDraftTotalsPreview(lines, 'ILS', settings, vatResolution, documentDate));
    const uiCache = readWizardUiCacheFromDraftPreview(row.draft_totals_preview_json);
    const docTypeLabel = row.document_type && DOCUMENT_TYPE_LABELS[row.document_type]
        ? DOCUMENT_TYPE_LABELS[row.document_type]
        : 'מסמך';
    let numberPreview = uiCache.document_number_preview;
    if (!numberPreview && row.document_type != null) {
        numberPreview = await previewNextIncomeDocumentNumber(scope, row.document_type);
    }
    let recipientName = uiCache.recipient_display_name ?? recipientDisplayNameFromRow(row);
    if (!recipientName) {
        recipientName = await resolveRecipientDisplayName(scope, row);
    }
    const headerTitle = buildDocumentDetailsHeaderTitle(scope, docTypeLabel, numberPreview, recipientName);
    const warnings = Array.isArray(row.validation_warnings_json)
        ? row.validation_warnings_json
            .filter((w) => w && typeof w === 'object')
            .map((w) => ({
            code: String(w.code ?? 'warning'),
            message: String(w.message ?? ''),
        }))
            .filter((w) => w.message)
        : [];
    const deliveryEmail = row.delivery_contact_json && typeof row.delivery_contact_json.email === 'string'
        ? row.delivery_contact_json.email
        : null;
    const lineActions = canEdit
        ? [
            'add_income_document_line',
            'update_income_document_line',
            'delete_income_document_line',
            'reorder_income_document_lines',
        ]
        : [];
    return {
        draft_id: row.id,
        document_type_key: row.document_type ?? null,
        draft_state_display: {
            status: 'draft',
            label: 'טיוטה',
            tone: 'neutral',
            last_saved_at: typeof row.updated_at === 'string' ? row.updated_at : null,
            saved_by_label: null,
            allowed_actions: canEdit ? ['save_income_document_draft'] : [],
        },
        header: {
            title: headerTitle,
            subtitle: docType?.legal_hint ?? null,
            document_number_preview: numberPreview,
        },
        settings_schema: buildSettingsSchema(row, docType, canEdit, vatResolution),
        line_items: {
            columns: [
                { key: 'drag', label: '' },
                { key: 'row_number', label: '#' },
                { key: 'description', label: 'פירוט *' },
                { key: 'quantity', label: 'כמות *' },
                { key: 'unit_price', label: "מחיר ליח'" },
                { key: 'currency', label: 'מטבע' },
                { key: 'vat', label: 'מע״מ' },
                { key: 'confirm', label: '' },
                { key: 'line_total', label: 'סה״כ' },
                { key: 'delete', label: '' },
            ],
            document_fields: buildDocumentLineTableFields(row, settings, vatResolution, canEdit),
            rows: await buildLineRows(lines, settings, vatResolution, documentDate, canEdit),
            allowed_actions: lineActions,
            add_row_label: '+ הוסף שורה',
            empty_state: {
                visible: lines.length === 0,
                message: 'הוסף שורה ראשונה למסמך',
            },
            totals: {
                subtotal: { label: 'סכום ביניים', display: totals.subtotal_display },
                vat: totals.vat_display != null
                    ? {
                        label: settings.vat_mode === 'standard'
                            ? `מע״מ (${vatResolution.standard_rate_percent_label})`
                            : 'מע״מ',
                        display: totals.vat_display,
                    }
                    : null,
                grand_total: { label: 'סה״כ לתשלום', display: totals.grand_total_display },
                currency: totals.currency,
                not_financial_truth: true,
            },
        },
        notes: {
            value: row.notes ?? '',
            label: 'הערות שיופיעו במסמך',
            editable: canEdit,
        },
        delivery_contact: {
            email: deliveryEmail,
            label: 'אימייל למשלוח המסמך',
            editable: canEdit,
            hint: 'נשמר כצילום למסמך — לא מעדכן את כרטיס הלקוח במערכת',
        },
        validation_warnings: warnings,
    };
}
