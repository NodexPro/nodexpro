import { formatMoneyReference, normalizeDraftLines, } from './income-document-draft-lines.pure.js';
import { allowedCurrencyOptions } from './income-draft-exchange-rate.pure.js';
import { computeDraftLineAmounts, recomputeDraftLineAmounts, resolveFxMapForDraftLines, resolveLineFx, } from './income-draft-line-compute.pure.js';
import { computeDraftTotalsPreview, parseDocumentSettingsJson, } from './income-document-draft-totals.pure.js';
import { formatDiscountAmountDisplay, formatDiscountPercentDisplay, validateDocumentDiscount, } from './income-document-discount.pure.js';
import { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';
import { compactVatSelectLabel, readVatResolutionFromDraftPreview, } from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import { loadIncomeRecipientById } from './income-recipient.service.js';
import { supabaseAdmin } from '../../db/client.js';
const DOCUMENT_TYPE_LABELS = {
    receipt: 'קבלה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס קבלה',
    credit_tax_invoice: 'חשבונית מס זיכוי',
    deal_invoice: 'חשבונית עסקה',
    quote: 'הצעת מחיר',
};
function previewPartyAddressLine(addressJson) {
    if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson))
        return null;
    const o = addressJson;
    const parts = [o.line1, o.line2, o.city, o.zip]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
}
function escapeHtml(s) {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
async function loadIssuerPreviewBlock(scope) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id, address_json, phone, email')
        .eq('organization_id', scope.org_id)
        .eq('id', scope.issuer_business_id)
        .maybeSingle();
    if (error)
        throw error;
    const row = data;
    return {
        display_name: row?.display_name?.trim() ? String(row.display_name).trim() : scope.issuer_label,
        tax_id: row?.tax_id?.trim() ? String(row.tax_id).trim() : null,
        address: previewPartyAddressLine(row?.address_json),
        phone: row?.phone?.trim() ? String(row.phone).trim() : null,
        email: row?.email?.trim() ? String(row.email).trim() : null,
    };
}
async function loadRecipientPreviewBlock(scope, row, fallbackDisplayName) {
    const snap = row.one_time_customer_snapshot_json;
    if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
        const s = snap;
        return {
            display_name: typeof s.display_name === 'string' && s.display_name.trim()
                ? s.display_name.trim()
                : fallbackDisplayName,
            tax_id: typeof s.tax_id === 'string' && s.tax_id.trim() ? s.tax_id.trim() : null,
            address: previewPartyAddressLine(s.address_json),
            phone: typeof s.phone === 'string' && s.phone.trim() ? s.phone.trim() : null,
            email: typeof s.email === 'string' && s.email.trim() ? s.email.trim() : null,
        };
    }
    if (row.income_customer_id) {
        const { data, error } = await supabaseAdmin
            .from('income_customers')
            .select('id, display_name, tax_id, phone, email, address_json')
            .eq('organization_id', scope.org_id)
            .eq('issuer_business_id', scope.issuer_business_id)
            .eq('id', row.income_customer_id)
            .maybeSingle();
        if (error)
            throw error;
        const saved = data;
        return {
            display_name: saved?.display_name?.trim() ? String(saved.display_name).trim() : fallbackDisplayName,
            tax_id: saved?.tax_id?.trim() ? String(saved.tax_id).trim() : null,
            address: previewPartyAddressLine(saved?.address_json),
            phone: saved?.phone?.trim() ? String(saved.phone).trim() : null,
            email: saved?.email?.trim() ? String(saved.email).trim() : null,
        };
    }
    return {
        display_name: fallbackDisplayName,
        tax_id: null,
        address: null,
        phone: null,
        email: null,
    };
}
function formatPreviewDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}
function renderIncomePreviewHtml(params) {
    const p = params;
    const issuerLine = (label, value) => value ? `<div class="nx-doc__issuer-line"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>` : '';
    const recipientLine = (value) => value ? `<div class="nx-doc__recipient-line">${escapeHtml(value)}</div>` : '';
    const linesHtml = p.lineRows.length > 0
        ? p.lineRows
            .map((r) => `<tr>
            <td>${r.row_number}</td>
            <td>${escapeHtml(r.description || '—')}</td>
            <td>${escapeHtml(r.quantity)}</td>
            <td>${escapeHtml(r.unit_price)}</td>
            <td>${escapeHtml(r.currency)}</td>
            <td>${escapeHtml(r.vat_rate_label)}</td>
            <td>${escapeHtml(r.total)}</td>
          </tr>`)
            .join('')
        : `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:16px">אין שורות במסמך</td></tr>`;
    return `
<div class="nx-doc" dir="rtl">
  <div class="nx-doc__header">
    <div class="nx-doc__issuer">
      <div class="nx-doc__logo" aria-hidden="true">PROG4BIZ</div>
      <div class="nx-doc__issuer-name">${escapeHtml(p.issuer.display_name)}</div>
      ${issuerLine('ח.פ/ע.מ', p.issuer.tax_id)}
      ${issuerLine('כתובת', p.issuer.address)}
      ${issuerLine('טלפון', p.issuer.phone)}
      ${issuerLine('אימייל', p.issuer.email)}
    </div>
    <div class="nx-doc__title-block">
      <div class="nx-doc__recipient">
        ${recipientLine(p.recipient.display_name)}
        ${recipientLine(p.recipient.address)}
        ${recipientLine(p.recipient.tax_id ? `ח.פ/ע.מ ${p.recipient.tax_id}` : null)}
      </div>
      <div class="nx-doc__title">${escapeHtml(p.docTypeLabel)} ${escapeHtml(p.numberPreview ?? '')}</div>
      <div class="nx-doc__dates">
        <span>תאריך מסמך: ${escapeHtml(formatPreviewDate(p.document_date))}</span>
        <span>תאריך לתשלום: ${escapeHtml(formatPreviewDate(p.due_date))}</span>
      </div>
    </div>
  </div>

  <table class="nx-doc__table">
    <thead>
      <tr>
        <th>#</th>
        <th>תיאור</th>
        <th>כמות</th>
        <th>מחיר ליחידה</th>
        <th>מטבע</th>
        <th>מע״מ</th>
        <th>סה״כ</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="nx-doc__totals-wrap">
    <div class="nx-doc__totals">
      <div class="nx-doc__total-row"><span>סכום ביניים</span><span>${escapeHtml(p.totals.subtotal_before_discount)}</span></div>
      ${p.totals.discount
        ? `<div class="nx-doc__total-row nx-doc__total-row--discount"><span>הנחה לפני מע״מ</span><span>${escapeHtml(p.totals.discount)}</span></div>
      <div class="nx-doc__total-row"><span>סכום לאחר הנחה</span><span>${escapeHtml(p.totals.subtotal_after_discount)}</span></div>`
        : ''}
      ${p.totals.vat
        ? `<div class="nx-doc__total-row"><span>${escapeHtml(p.totals.vat_label ?? 'מע״מ')}</span><span>${escapeHtml(p.totals.vat)}</span></div>`
        : ''}
      <div class="nx-doc__grand-total">
        <span>סה״כ לתשלום</span>
        <strong>${escapeHtml(p.totals.grand_total)}</strong>
      </div>
    </div>
  </div>

  <div class="nx-doc__footer">
    ${p.notes && p.notes.trim()
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">הערות</div><div class="nx-doc__footer-text">${escapeHtml(p.notes)}</div></div>`
        : ''}
    <div class="nx-doc__footer-block">
      <div class="nx-doc__footer-title">פרטי תשלום</div>
      <div class="nx-doc__footer-text">TEMPORARY_BRANDING_PENDING — פרטי בנק יוצגו מהגדרות מנפיק</div>
    </div>
    <div class="nx-doc__signature">חתימה וחותמת</div>
  </div>
</div>
  `.trim();
}
function buildPreviewToolbarActions() {
    return [
        { action: 'preview_export_pdf', label: 'PDF', enabled: false, reason: 'זמין לאחר הפקה' },
        { action: 'preview_print', label: 'הדפסה', enabled: false, reason: 'זמין לאחר הפקה' },
        { action: 'preview_download', label: 'הורדה', enabled: false, reason: 'זמין לאחר הפקה' },
    ];
}
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
        return { document_number_preview: null, recipient_display_name: null, preview_generated_at: null };
    }
    const o = raw;
    return {
        document_number_preview: typeof o.document_number_preview === 'string' ? o.document_number_preview : null,
        recipient_display_name: typeof o.recipient_display_name === 'string' ? o.recipient_display_name : null,
        preview_generated_at: typeof o.preview_generated_at === 'string' ? o.preview_generated_at : null,
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
function buildDocumentDiscountModel(settings, totals, canEdit) {
    const d = settings.discount;
    const subtotalBefore = totals.subtotal_before_discount_reference ?? 0;
    const fieldErrors = validateDocumentDiscount(d, subtotalBefore);
    return {
        enabled: d.enabled,
        editable: canEdit,
        type: d.type,
        value: d.enabled ? String(d.value) : '',
        currency: totals.currency,
        amount_display: d.type === 'fixed_amount' && d.enabled
            ? formatDiscountAmountDisplay(d.value, totals.currency)
            : null,
        percent_display: d.type === 'percent' && d.enabled ? formatDiscountPercentDisplay(d.value) : null,
        calculated_discount_amount_display: totals.discount_amount_display,
        affects_vat: true,
        field_errors: fieldErrors,
        allowed_actions: canEdit ? ['update_income_document_discount'] : [],
    };
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
    const previewMessages = warnings.map((w) => ({
        severity: 'warning',
        label: w.message,
        field: null,
        blocking: false,
    }));
    const previewGeneratedAt = uiCache.preview_generated_at;
    const issuerBlock = previewGeneratedAt != null
        ? await loadIssuerPreviewBlock(scope)
        : {
            display_name: scope.issuer_label,
            tax_id: null,
            address: null,
            phone: null,
            email: null,
        };
    const recipientBlock = previewGeneratedAt != null
        ? await loadRecipientPreviewBlock(scope, row, recipientName ?? '—')
        : {
            display_name: recipientName ?? '—',
            tax_id: null,
            address: null,
            phone: null,
            email: null,
        };
    const previewLineRows = previewGeneratedAt != null
        ? (await buildLineRows(lines, settings, vatResolution, documentDate, false)).map((r) => ({
            row_number: r.row_number,
            description: r.description.value,
            quantity: r.quantity.value,
            unit_price: r.unit_price.value,
            currency: r.currency.value,
            vat_rate_label: r.vat_rate_label,
            total: r.line_total_display,
        }))
        : [];
    const previewVatLabel = totals.vat_display != null
        ? settings.vat_mode === 'standard'
            ? `מע״מ (${vatResolution.standard_rate_percent_label})`
            : 'מע״מ'
        : null;
    const previewHtml = previewGeneratedAt != null
        ? renderIncomePreviewHtml({
            docTypeLabel,
            numberPreview,
            issuer: issuerBlock,
            recipient: recipientBlock,
            document_date: row.document_date ?? null,
            due_date: row.due_date ?? null,
            currency: row.currency,
            lineRows: previewLineRows,
            totals: {
                subtotal_before_discount: totals.subtotal_before_discount_display,
                discount: totals.discount_enabled && totals.discount_amount_display
                    ? `−${totals.discount_amount_display.replace(/^−/, '')}`
                    : null,
                subtotal_after_discount: totals.subtotal_after_discount_display,
                vat_label: previewVatLabel,
                vat: totals.vat_display ?? null,
                grand_total: totals.grand_total_display,
            },
            notes: row.notes ?? null,
        })
        : '';
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
    const documentDiscount = buildDocumentDiscountModel(settings, totals, canEdit);
    const totalsBlock = buildTotalsBlock(totals, settings, vatResolution);
    return {
        draft_id: row.id,
        document_type_key: row.document_type ?? null,
        document_discount: documentDiscount,
        totals_block: totalsBlock,
        document_preview: {
            visible: previewGeneratedAt != null,
            preview_status: previewGeneratedAt != null ? 'ready' : 'not_generated',
            generated_at: previewGeneratedAt,
            document_type_label: docTypeLabel,
            document_number_preview: numberPreview,
            issuer: issuerBlock,
            recipient: recipientBlock,
            dates: { document_date: row.document_date ?? null, due_date: row.due_date ?? null },
            currency: row.currency,
            preview_html: previewHtml,
            validation_messages: previewMessages,
            allowed_actions: canEdit ? ['generate_income_document_preview'] : [],
            toolbar_actions: buildPreviewToolbarActions(),
        },
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
                subtotal: { label: 'סכום ביניים', display: totals.subtotal_before_discount_display },
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
