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
    const primary = b.primary_color;
    const secondary = b.secondary_color;
    const tableHeader = b.table_header_color;
    const totalsColor = b.totals_color;
    const clientRight = b.client_block_position === 'right';
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
    const recipientLines = [];
    recipientLines.push(`<div class="nx-doc__recipient-line nx-doc__recipient-name">${escapeHtml(params.recipient.display_name)}</div>`);
    if (params.recipient.address) {
        recipientLines.push(`<div class="nx-doc__recipient-line">${escapeHtml(params.recipient.address)}</div>`);
    }
    if (params.recipient.tax_id) {
        recipientLines.push(`<div class="nx-doc__recipient-line">${escapeHtml(`ח.פ/ע.מ ${params.recipient.tax_id}`)}</div>`);
    }
    if (params.recipient.phone) {
        recipientLines.push(`<div class="nx-doc__recipient-line">${escapeHtml(params.recipient.phone)}</div>`);
    }
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
    return `
<style>
.nx-doc { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 13px; line-height: 1.45; }
.nx-doc__header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.nx-doc__issuer { flex: 1; min-width: 0; }
.nx-doc__title-block { flex: 1; min-width: 0; text-align: ${clientRight ? 'right' : 'left'}; }
.nx-doc__logo-img, .nx-doc__logo-placeholder { max-height: 56px; max-width: 180px; margin-bottom: 8px; }
.nx-doc__logo-placeholder { width: 120px; height: 40px; background: ${secondary}; border-radius: 4px; }
.nx-doc__issuer-name { font-size: 18px; font-weight: 700; color: ${primary}; }
.nx-doc__issuer-subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
.nx-doc__issuer-line { font-size: 12px; color: #334155; margin-top: 2px; }
.nx-doc__recipient { background: #f8fafc; border: 1px solid #e2e8f0; border-right: 3px solid ${primary}; padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; }
.nx-doc__recipient-name { font-weight: 700; color: ${primary}; }
.nx-doc__recipient-line { font-size: 12px; color: #334155; }
.nx-doc__title { font-size: 20px; font-weight: 700; color: ${primary}; margin: 8px 0; }
.nx-doc__dates { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
.nx-doc__table { width: 100%; border-collapse: collapse; margin: 16px 0; }
.nx-doc__table th { background: ${tableHeader}; color: #fff; padding: 8px 6px; font-size: 12px; text-align: right; }
.nx-doc__table td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; font-size: 12px; vertical-align: top; }
.nx-doc__totals-wrap { display: flex; justify-content: flex-end; margin-top: 12px; }
.nx-doc__totals { min-width: 280px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: 3px solid ${totalsColor}; border-radius: 8px; padding: 12px; }
.nx-doc__total-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13px; }
.nx-doc__total-row--discount { color: #b45309; }
.nx-doc__grand-total { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 2px solid ${totalsColor}; font-size: 15px; color: ${totalsColor}; }
.nx-doc__footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
.nx-doc__footer-title { font-weight: 700; color: ${primary}; margin-bottom: 4px; }
.nx-doc__footer-text { font-size: 12px; color: #334155; white-space: pre-wrap; }
.nx-doc__signature { margin-top: 20px; text-align: left; }
.nx-doc__signature-img { max-height: 64px; max-width: 200px; }
</style>
<div class="nx-doc" dir="rtl">
  <div class="nx-doc__header">
    <div class="nx-doc__issuer">
      ${logoHtml}
      <div class="nx-doc__issuer-name">${escapeHtml(params.issuer.display_name)}</div>
      ${subtitle}
      ${issuerLine('ח.פ/ע.מ', params.issuer.tax_id, d.show_business_tax_id)}
      ${issuerLine('כתובת', params.issuer.address, d.show_business_address)}
      ${issuerLine('טלפון', params.issuer.phone, d.show_business_phone)}
      ${issuerLine('אימייל', params.issuer.email, d.show_business_email)}
    </div>
    <div class="nx-doc__title-block">
      <div class="nx-doc__recipient">${recipientLines.join('')}</div>
      <div class="nx-doc__title">${escapeHtml(params.docTypeLabel)} ${escapeHtml(params.numberPreview ?? '')}</div>
      <div class="nx-doc__dates">
        <span>תאריך מסמך: ${escapeHtml(formatPreviewDate(params.document_date))}</span>
        ${d.show_due_date ? `<span>תאריך לתשלום: ${escapeHtml(formatPreviewDate(params.due_date))}</span>` : ''}
      </div>
    </div>
  </div>

  <table class="nx-doc__table">
    <thead>${tableHead}</thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="nx-doc__totals-wrap">
    <div class="nx-doc__totals">
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
