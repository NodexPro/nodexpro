import { formatDocumentNumberDisplay, gradientCss, resolveLogoSizeDimensions, } from './income-document-branding.pure.js';
const INVOICE_FONT = 'Arial, Helvetica, "Segoe UI", sans-serif';
function escapeHtml(value) {
    const s = value == null ? '' : String(value);
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function formatPreviewDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}
export function renderIncomeBrandedPreviewHtml(params) {
    const b = params.branding;
    const d = b.display_options;
    const theme = b.color_theme;
    const styleKey = b.document_style_key;
    const headerGradient = gradientCss(theme.gradient);
    const tableHeader = theme.table_header_color;
    const totalsAccent = theme.totals_accent_color;
    const recipientAccent = theme.recipient_accent_color;
    const recipientBg = theme.recipient_block_background;
    const recipientBorder = theme.recipient_block_border;
    const issuerText = theme.text_on_light;
    const tableHeaderText = theme.text_on_dark;
    const numberDisplay = formatDocumentNumberDisplay(params.numberPreview);
    const logoDims = resolveLogoSizeDimensions(b.logo_size_key);
    const issuerLine = (label, value, visible) => value && visible
        ? `<div class="nx-doc__issuer-line"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`
        : '';
    const logoHtml = d.show_logo && b.logo_data_url
        ? `<img class="nx-doc__logo-img" src="${b.logo_data_url}" alt="" />`
        : d.show_logo
            ? `<div class="nx-doc__logo-placeholder" aria-hidden="true"></div>`
            : '';
    const subtitle = params.company_subtitle?.trim() || b.company_subtitle?.trim()
        ? `<div class="nx-doc__issuer-subtitle">${escapeHtml(params.company_subtitle ?? b.company_subtitle)}</div>`
        : '';
    const issuerDetails = `
    <div class="nx-doc__issuer-name">${escapeHtml(params.issuer.display_name)}</div>
    ${subtitle}
    ${issuerLine('ח.פ/ע.מ', params.issuer.tax_id, d.show_business_tax_id)}
    ${issuerLine('כתובת', params.issuer.address, d.show_business_address)}
    ${issuerLine('טלפון', params.issuer.phone, d.show_business_phone)}
    ${issuerLine('אימייל', params.issuer.email, d.show_business_email)}
  `;
    const recipientField = (label, value) => value
        ? `<div class="nx-doc__recipient-field"><span class="nx-doc__recipient-label">${escapeHtml(label)}</span> <span>${escapeHtml(value)}</span></div>`
        : '';
    const recipientBlock = `
    <div class="nx-doc__recipient-heading">לכבוד:</div>
    <div class="nx-doc__recipient-line nx-doc__recipient-name">${escapeHtml(params.recipient.display_name)}</div>
    ${recipientField('ח.פ / ע.מ:', params.recipient.tax_id)}
    ${recipientField('כתובת:', params.recipient.address)}
    ${recipientField('טלפון:', params.recipient.phone)}
    ${recipientField('אימייל:', params.recipient.email)}
  `;
    const docTitleInner = `
      <div class="nx-doc__title">${escapeHtml(params.docTypeLabel)} · ${escapeHtml(numberDisplay)}</div>
      <div class="nx-doc__dates">
        <span>תאריך מסמך: ${escapeHtml(formatPreviewDate(params.document_date))}</span>
        ${d.show_due_date ? `<span>תאריך לתשלום: ${escapeHtml(formatPreviewDate(params.due_date))}</span>` : ''}
      </div>`;
    const docTitleHtml = `<div class="nx-doc__doc-meta">${docTitleInner}</div>`;
    const qtyCol = d.show_item_index;
    const showCurrencyCol = d.show_currency;
    const linesHtml = params.lineRows.length > 0
        ? params.lineRows
            .map((r) => {
            const qtyCell = d.quantity_position === 'after_description' ? '' : `<td>${escapeHtml(r.quantity)}</td>`;
            const qtyAfter = d.quantity_position === 'after_description'
                ? `<td>${escapeHtml(r.quantity)}</td>`
                : '';
            return `<tr>
            ${qtyCol ? `<td>${r.row_number}</td>` : ''}
            ${qtyCell}
            <td>${escapeHtml(r.description || '—')}</td>
            ${qtyAfter}
            <td>${escapeHtml(r.unit_price)}</td>
            ${showCurrencyCol ? `<td>${escapeHtml(r.currency)}</td>` : ''}
            ${d.show_vat_row ? `<td>${escapeHtml(r.vat_rate_label)}</td>` : ''}
            <td>${escapeHtml(r.total)}</td>
          </tr>`;
        })
            .join('')
        : `<tr><td colspan="8" style="text-align:center;color:#64748b;padding:16px">אין שורות במסמך</td></tr>`;
    const tableHead = `
    <tr>
      ${qtyCol ? '<th>#</th>' : ''}
      ${d.quantity_position === 'before_description' ? '<th>כמות</th>' : ''}
      <th>תיאור</th>
      ${d.quantity_position === 'after_description' ? '<th>כמות</th>' : ''}
      <th>מחיר ליחידה</th>
      ${showCurrencyCol ? '<th>מטבע</th>' : ''}
      ${d.show_vat_row ? '<th>מע״מ</th>' : ''}
      <th>סה״כ</th>
    </tr>`;
    const bankLines = [];
    if (d.show_bank_details) {
        if (b.bank_name)
            bankLines.push(`בנק: ${escapeHtml(b.bank_name)}`);
        if (b.bank_branch)
            bankLines.push(`סניף: ${escapeHtml(b.bank_branch)}`);
        if (b.bank_account)
            bankLines.push(`חשבון: ${escapeHtml(b.bank_account)}`);
        if (b.iban)
            bankLines.push(`IBAN: ${escapeHtml(b.iban)}`);
        if (b.swift)
            bankLines.push(`SWIFT: ${escapeHtml(b.swift)}`);
    }
    const paymentLabels = b.payment_methods.filter((m) => m.enabled).map((m) => escapeHtml(m.label));
    const paymentHtml = paymentLabels.length > 0
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">אמצעי תשלום</div><div class="nx-doc__footer-text">${paymentLabels.join(' · ')}</div></div>`
        : '';
    const signatureHtml = d.show_signature && b.signature_data_url
        ? `<div class="nx-doc__signature"><img src="${b.signature_data_url}" alt="" class="nx-doc__signature-img" /></div>`
        : d.show_signature
            ? `<div class="nx-doc__signature">חתימה וחותמת</div>`
            : '';
    const bannerClass = styleKey === 'classic'
        ? 'nx-doc__doc-type-banner'
        : 'nx-doc__doc-type-banner nx-doc__doc-type-banner--subtle';
    let headerHtml = '';
    if (styleKey === 'elegant') {
        headerHtml = `
  <div class="nx-doc__header nx-doc__header--elegant">
    <div class="nx-doc__elegant-top">
      <div class="nx-doc__elegant-logo">${logoHtml}</div>
      <div class="nx-doc__elegant-company">${issuerDetails}<div class="nx-doc__elegant-accent"></div></div>
    </div>
    <div class="nx-doc__elegant-divider"></div>
    <div class="nx-doc__recipient nx-doc__recipient--elegant">${recipientBlock}</div>
    <div class="${bannerClass}">${docTitleHtml}</div>
  </div>`;
    }
    else if (styleKey === 'modern') {
        headerHtml = `
  <div class="nx-doc__header nx-doc__header--modern">
    <div class="nx-doc__modern-top">
      ${logoHtml}
      <div class="nx-doc__modern-issuer">${issuerDetails}</div>
    </div>
    <div class="nx-doc__modern-rule"></div>
    <div class="nx-doc__recipient nx-doc__recipient--modern">${recipientBlock}</div>
    <div class="nx-doc__modern-rule nx-doc__modern-rule--spaced"></div>
    <div class="nx-doc__doc-meta nx-doc__doc-meta--modern">${docTitleInner}</div>
  </div>`;
    }
    else {
        headerHtml = `
  <div class="nx-doc__header nx-doc__header--classic">
    <div class="nx-doc__issuer">
      ${logoHtml}
      ${issuerDetails}
    </div>
    <div class="nx-doc__title-block">
      <div class="nx-doc__recipient">${recipientBlock}</div>
      <div class="${bannerClass}">${docTitleHtml}</div>
    </div>
  </div>`;
    }
    const totalsBoxClass = styleKey === 'elegant'
        ? 'nx-doc__totals nx-doc__totals--elegant'
        : styleKey === 'modern'
            ? 'nx-doc__totals nx-doc__totals--modern'
            : 'nx-doc__totals';
    const tableClass = styleKey === 'modern'
        ? 'nx-doc__table nx-doc__table--modern'
        : styleKey === 'elegant'
            ? 'nx-doc__table nx-doc__table--elegant'
            : 'nx-doc__table';
    return `
<style>
.nx-doc { font-family: ${INVOICE_FONT}; color: ${issuerText}; font-size: 13px; line-height: 1.45; }
.nx-doc__header { margin-bottom: 20px; }
.nx-doc__header--classic { display: flex; justify-content: space-between; gap: 24px; }
.nx-doc__issuer { flex: 1; min-width: 0; }
.nx-doc__title-block { flex: 1; min-width: 0; }
.nx-doc__logo-img { max-width: ${logoDims.maxWidthPx}px; max-height: ${logoDims.maxHeightPx}px; width: auto; height: auto; object-fit: contain; display: block; margin-bottom: 10px; }
.nx-doc__logo-placeholder { width: ${Math.round(logoDims.maxWidthPx * 0.75)}px; height: ${Math.round(logoDims.maxHeightPx * 0.65)}px; background: ${recipientBg}; border: 1px dashed ${recipientBorder}; border-radius: 6px; margin-bottom: 10px; }
.nx-doc__issuer-name { font-size: 18px; font-weight: 700; color: ${issuerText}; }
.nx-doc__issuer-subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
.nx-doc__issuer-line { font-size: 12px; color: #334155; margin-top: 2px; }
.nx-doc__recipient { background: ${recipientBg}; border: 1px solid ${recipientBorder}; border-inline-start: 3px solid ${recipientAccent}; padding: 12px 14px; border-radius: 6px; margin-bottom: 14px; color: ${issuerText}; }
.nx-doc__recipient-heading { font-weight: 700; margin-bottom: 6px; color: ${issuerText}; }
.nx-doc__recipient-name { font-weight: 700; margin-bottom: 4px; color: ${issuerText}; }
.nx-doc__recipient-field { font-size: 12px; margin-top: 3px; color: #334155; }
.nx-doc__recipient-label { font-weight: 600; color: #475569; }
.nx-doc__doc-type-banner { background: ${headerGradient}; color: ${theme.text_on_dark}; padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; }
.nx-doc__doc-type-banner--subtle { background: transparent; color: ${issuerText}; padding: 10px 0 8px; border-radius: 0; border-bottom: 1px solid ${recipientAccent}; margin-bottom: 8px; }
.nx-doc__title { font-size: 20px; font-weight: 700; margin: 0; }
.nx-doc__doc-type-banner .nx-doc__title { color: ${theme.text_on_dark}; }
.nx-doc__doc-type-banner--subtle .nx-doc__title { color: ${issuerText}; font-size: 19px; }
.nx-doc__dates { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; margin-top: 8px; }
.nx-doc__header--elegant .nx-doc__elegant-top { display: flex; justify-content: space-between; gap: 32px; align-items: flex-start; }
.nx-doc__header--elegant .nx-doc__elegant-logo { flex: 0 0 auto; }
.nx-doc__header--elegant .nx-doc__elegant-logo .nx-doc__logo-img { max-width: ${Math.round(logoDims.maxWidthPx * 1.1)}px; max-height: ${Math.round(logoDims.maxHeightPx * 1.1)}px; }
.nx-doc__header--elegant .nx-doc__elegant-company { flex: 1; text-align: left; }
.nx-doc__header--elegant .nx-doc__elegant-accent { height: 1px; background: ${recipientAccent}; margin-top: 10px; max-width: 220px; margin-inline-start: auto; opacity: 0.85; }
.nx-doc__header--elegant .nx-doc__elegant-divider { height: 1px; background: #e8e0d4; margin: 18px 0; }
.nx-doc__recipient--elegant { background: ${recipientBg}; border: 1px solid ${recipientBorder}; border-inline-start: 2px solid ${recipientAccent}; box-shadow: none; }
.nx-doc__header--modern { margin-bottom: 28px; }
.nx-doc__header--modern .nx-doc__modern-top { display: flex; gap: 20px; align-items: flex-start; margin-bottom: 14px; }
.nx-doc__header--modern .nx-doc__modern-issuer .nx-doc__issuer-name { font-size: 17px; }
.nx-doc__header--modern .nx-doc__modern-rule { height: 1px; background: #e2e8f0; margin: 0; }
.nx-doc__header--modern .nx-doc__modern-rule--spaced { margin: 18px 0 14px; }
.nx-doc__recipient--modern { background: transparent; border: none; border-inline-start: none; border-bottom: 1px solid #e2e8f0; border-radius: 0; padding: 0 0 14px; margin-bottom: 0; }
.nx-doc__doc-meta--modern { padding: 4px 0 0; }
.nx-doc__doc-meta--modern .nx-doc__title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.nx-doc__doc-meta--modern .nx-doc__dates { margin-top: 10px; color: #64748b; }
.nx-doc__table { width: 100%; border-collapse: collapse; margin: 16px 0; }
.nx-doc__table th { background: ${tableHeader}; color: ${tableHeaderText}; padding: 8px 6px; font-size: 12px; text-align: right; }
.nx-doc__table--modern th { background: transparent; color: ${issuerText}; border-bottom: 2px solid ${tableHeader}; font-weight: 700; padding-bottom: 10px; }
.nx-doc__table--elegant th { padding: 10px 8px; letter-spacing: 0.01em; }
.nx-doc__table td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; font-size: 12px; vertical-align: top; color: ${issuerText}; }
.nx-doc__table--modern td { padding: 10px 6px; border-bottom-color: #eef2f7; }
.nx-doc__header--elegant .nx-doc__table td { padding: 10px 8px; }
.nx-doc__totals-wrap { display: flex; justify-content: flex-end; margin-top: 12px; }
.nx-doc__totals { min-width: 280px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: 3px solid ${totalsAccent}; border-radius: 8px; padding: 12px; }
.nx-doc__totals--elegant { background: transparent; border: none; border-top: 1px solid ${totalsAccent}; border-radius: 0; padding: 14px 0 0; min-width: 300px; }
.nx-doc__totals--modern { background: transparent; border: none; border-top: 1px solid #e2e8f0; border-radius: 0; padding: 14px 0 0; box-shadow: none; }
.nx-doc__total-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13px; color: ${issuerText}; }
.nx-doc__total-row--discount { color: #b45309; }
.nx-doc__grand-total { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 2px solid ${totalsAccent}; font-size: 15px; color: ${totalsAccent}; font-weight: 700; }
.nx-doc__footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
.nx-doc__footer-title { font-weight: 700; color: ${issuerText}; margin-bottom: 4px; }
.nx-doc__footer-text { font-size: 12px; color: #334155; white-space: pre-wrap; }
.nx-doc__signature { margin-top: 20px; text-align: left; }
.nx-doc__signature-img { max-height: 64px; max-width: 200px; }
</style>
<div class="nx-doc nx-doc--${styleKey}" dir="rtl">
  ${headerHtml}

  <table class="${tableClass}">
    <thead>${tableHead}</thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="nx-doc__totals-wrap">
    <div class="${totalsBoxClass}">
      <div class="nx-doc__total-row"><span>סכום ביניים</span><span>${escapeHtml(params.totals.subtotal_before_discount)}</span></div>
      ${d.show_discount_row && params.totals.discount
        ? `<div class="nx-doc__total-row nx-doc__total-row--discount"><span>הנחה לפני מע״מ</span><span>${escapeHtml(params.totals.discount)}</span></div>
      <div class="nx-doc__total-row"><span>סכום לאחר הנחה</span><span>${escapeHtml(params.totals.subtotal_after_discount)}</span></div>`
        : ''}
      ${d.show_vat_row && params.totals.vat
        ? `<div class="nx-doc__total-row"><span>${escapeHtml(params.totals.vat_label ?? 'מע״מ')}</span><span>${escapeHtml(params.totals.vat)}</span></div>`
        : ''}
      <div class="nx-doc__grand-total">
        <span>סה״כ לתשלום</span>
        <strong>${escapeHtml(params.totals.grand_total)}</strong>
      </div>
    </div>
  </div>

  <div class="nx-doc__footer">
    ${d.show_notes && params.notes?.trim()
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">הערות</div><div class="nx-doc__footer-text">${escapeHtml(params.notes)}</div></div>`
        : ''}
    ${b.customer_notes?.trim()
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">הערות ללקוח</div><div class="nx-doc__footer-text">${escapeHtml(b.customer_notes)}</div></div>`
        : ''}
    ${b.terms_and_conditions?.trim()
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">תנאים והגבלות</div><div class="nx-doc__footer-text">${escapeHtml(b.terms_and_conditions)}</div></div>`
        : ''}
    ${d.show_footer && b.footer_text?.trim()
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">כותרת תחתונה</div><div class="nx-doc__footer-text">${escapeHtml(b.footer_text)}</div></div>`
        : ''}
    ${bankLines.length
        ? `<div class="nx-doc__footer-block"><div class="nx-doc__footer-title">פרטי תשלום</div><div class="nx-doc__footer-text">${bankLines.join('<br/>')}</div></div>`
        : ''}
    ${paymentHtml}
  </div>
  ${signatureHtml}
</div>
  `.trim();
}
export function renderStudioSamplePreviewHtml(branding) {
    return renderIncomeBrandedPreviewHtml({
        branding,
        docTypeLabel: 'הצעת מחיר',
        numberPreview: null,
        issuer: {
            display_name: 'שם העסק',
            tax_id: '123456789',
            address: 'רחוב העסק 1, תל אביב',
            phone: '03-1234567',
            email: 'office@example.com',
        },
        recipient: {
            display_name: 'לקוח לדוגמה',
            tax_id: '987654321',
            address: 'רחוב הלקוח 5',
            phone: '050-1234567',
            email: 'client@example.com',
        },
        document_date: '2026-05-29',
        due_date: '2026-06-29',
        currency: 'ILS',
        lineRows: [
            {
                row_number: 1,
                description: 'שירות מקצועי',
                quantity: '1',
                unit_price: '1,000.00',
                currency: '₪',
                vat_rate_label: '17%',
                total: '1,000.00',
            },
        ],
        totals: {
            subtotal_before_discount: '1,000.00 ₪',
            discount: null,
            subtotal_after_discount: '1,000.00 ₪',
            vat_label: 'מע״מ (17%)',
            vat: '170.00 ₪',
            grand_total: '1,170.00 ₪',
        },
        notes: null,
        company_subtitle: branding.company_subtitle,
    });
}
