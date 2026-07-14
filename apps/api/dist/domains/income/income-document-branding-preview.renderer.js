import { formatDocumentNumberDisplay, resolveBrandingPreviewThemePalette, resolveLogoSizeDimensions, STUDIO_SAMPLE_ISSUER, STUDIO_SAMPLE_RECIPIENT, } from './income-document-branding.pure.js';
import { docPreviewIcon, nodexproFooterLogoMarkup } from './income-document-preview-icons.pure.js';
const INVOICE_FONT = 'Heebo, Arial, Helvetica, "Segoe UI", sans-serif';
const NODEXPRO_FOOTER_URL = 'https://www.nodexpro.com';
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
function formatDiscountDisplay(value) {
    if (!value)
        return null;
    const trimmed = String(value).trim();
    if (!trimmed)
        return null;
    return trimmed.replace(/^[\s−\-–—]+/, '').trim();
}
const PARTY_LINE_ICON_PX = 16;
const PARTY_LINE_GAP_PX = 5;
function partyInfoRow(classPrefix, icon, value) {
    if (!value?.trim())
        return '';
    return `<div class="nx-doc__${classPrefix}-line"><span class="nx-doc__${classPrefix}-line-icon" aria-hidden="true">${icon}</span><span class="nx-doc__${classPrefix}-line-value">${escapeHtml(value)}</span></div>`;
}
function partyPlainRow(classPrefix, value) {
    if (!value?.trim())
        return '';
    return `<div class="nx-doc__${classPrefix}-line nx-doc__${classPrefix}-line--plain"><span class="nx-doc__${classPrefix}-line-icon nx-doc__${classPrefix}-line-icon--spacer" aria-hidden="true"></span><span class="nx-doc__${classPrefix}-line-value">${escapeHtml(value)}</span></div>`;
}
function issuerInfoRow(icon, value) {
    return partyInfoRow('issuer', icon, value);
}
function metaRow(label, value, icon) {
    const iconHtml = icon ? `<span class="nx-doc__meta-icon">${icon}</span>` : '';
    return `<div class="nx-doc__meta-row">${iconHtml}<span class="nx-doc__meta-label">${escapeHtml(label)}</span><span class="nx-doc__meta-value">${escapeHtml(value)}</span></div>`;
}
function allocationDocumentMetaRow(label, value, icon, valueEmpty) {
    const iconHtml = `<span class="nx-doc__meta-icon">${icon}</span>`;
    const valueClass = valueEmpty ? ' nx-doc__meta-value--empty' : '';
    return `<div class="nx-doc__meta-row nx-doc__meta-row--allocation">${iconHtml}<span class="nx-doc__meta-label">${escapeHtml(label)}</span><span class="nx-doc__meta-value${valueClass}">${escapeHtml(value)}</span></div>`;
}
function customerInfoRow(icon, value) {
    return partyInfoRow('customer', icon, value);
}
function formatLineCurrency(currency) {
    const c = currency?.trim() || 'ILS';
    return c;
}
function buildPaymentCards(params) {
    const b = params.branding;
    const enabled = b.payment_methods.filter((m) => m.enabled);
    if (!enabled.length && !params.showBankDetails)
        return '';
    const bankEnabled = enabled.some((m) => m.key === 'bank_transfer');
    const cardEnabled = enabled.some((m) => m.key === 'credit_card');
    const otherMethods = enabled.filter((m) => m.key !== 'bank_transfer' && m.key !== 'credit_card');
    const bankLines = [];
    if (params.showBankDetails) {
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
        if (b.payment_instructions)
            bankLines.push(escapeHtml(b.payment_instructions));
    }
    const cards = [];
    if (bankEnabled || bankLines.length) {
        cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--bank">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('bank')}<strong>העברה בנקאית</strong></header>
      <div class="nx-doc__payment-col-body">${bankLines.length ? bankLines.join('<br/>') : '—'}</div>
    </div>`);
    }
    if (cardEnabled && params.payment_link_url?.trim()) {
        const cardMethod = enabled.find((m) => m.key === 'credit_card');
        const link = escapeHtml(params.payment_link_url.trim());
        const qrBlock = params.payment_qr_data_url?.trim()
            ? `<img class="nx-doc__payment-qr" src="${escapeHtml(params.payment_qr_data_url.trim())}" alt="" />`
            : '';
        cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--card">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('card')}<strong>${escapeHtml(cardMethod?.label ?? 'כרטיס אשראי')}</strong></header>
      <div class="nx-doc__payment-col-body nx-doc__payment-col-body--card">
        ${qrBlock}
        <div class="nx-doc__payment-col-text"><div><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div></div>
      </div>
    </div>`);
    }
    if (otherMethods.length) {
        cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--other">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('payment')}<strong>אמצעי תשלום נוספים</strong></header>
      <div class="nx-doc__payment-col-body">${otherMethods.map((m) => `<div>${escapeHtml(m.label)}</div>`).join('')}</div>
    </div>`);
    }
    if (!cards.length)
        return '';
    return `<section class="nx-doc__payments" aria-label="אמצעי תשלום">
    <header class="nx-doc__payments-head"><span>אמצעי תשלום</span></header>
    <div class="nx-doc__payments-grid">${cards.join('')}</div>
  </section>`;
}
function buildSheetSection(sectionNumber, bodyHtml) {
    return `<section class="nx-doc__sheet-section nx-doc__sheet-section--${sectionNumber}" aria-label="אזור ${sectionNumber}"><span class="nx-doc__sheet-section-badge" aria-hidden="true">${sectionNumber}</span><div class="nx-doc__sheet-section-body">${bodyHtml}</div></section>`;
}
export function renderIncomeBrandedPreviewHtml(params) {
    const b = params.branding;
    const d = b.display_options;
    const isSectioned = b.document_style_key === 'sectioned';
    const palette = resolveBrandingPreviewThemePalette(b.color_theme);
    const accent = palette.totals_accent_color;
    const numberDisplay = formatDocumentNumberDisplay(params.numberPreview);
    const logoDims = resolveLogoSizeDimensions(b.logo_size_key);
    const discountDisplay = formatDiscountDisplay(params.totals.discount);
    const rootClass = isSectioned ? 'nx-doc nx-doc--unified nx-doc--sectioned' : 'nx-doc nx-doc--unified';
    const numberBlock = isSectioned
        ? `<div class="nx-doc__doc-number"><span class="nx-doc__doc-number-pill">${escapeHtml(numberDisplay)}</span></div>`
        : `<div class="nx-doc__doc-number">${escapeHtml(numberDisplay)}</div>
      <div class="nx-doc__doc-number-rule" aria-hidden="true"></div>`;
    const logoHtml = d.show_logo && b.logo_data_url
        ? `<img class="nx-doc__logo-img" src="${b.logo_data_url}" alt="" />`
        : d.show_logo
            ? `<div class="nx-doc__logo-placeholder" aria-hidden="true"></div>`
            : '';
    const subtitle = params.company_subtitle?.trim() || b.company_subtitle?.trim()
        ? `<div class="nx-doc__issuer-subtitle">${escapeHtml(params.company_subtitle ?? b.company_subtitle)}</div>`
        : '';
    const issuerContactLines = [
        issuerInfoRow(docPreviewIcon('id'), d.show_business_tax_id ? params.issuer.tax_id : null),
        issuerInfoRow(docPreviewIcon('location'), d.show_business_address ? params.issuer.address : null),
        issuerInfoRow(docPreviewIcon('phone'), d.show_business_phone ? params.issuer.phone : null),
        issuerInfoRow(docPreviewIcon('mail'), d.show_business_email ? params.issuer.email : null),
        issuerInfoRow(docPreviewIcon('website'), params.issuer.website?.trim() ? params.issuer.website : null),
    ]
        .filter(Boolean)
        .join('');
    const customerLines = [
        partyPlainRow('customer', params.recipient.contact_name ?? null),
        customerInfoRow(docPreviewIcon('location'), params.recipient.address),
        customerInfoRow(docPreviewIcon('id'), params.recipient.tax_id),
        customerInfoRow(docPreviewIcon('phone'), params.recipient.phone),
        customerInfoRow(docPreviewIcon('mail'), params.recipient.email),
        customerInfoRow(docPreviewIcon('website'), params.recipient.website ?? null),
    ]
        .filter(Boolean)
        .join('');
    const metaRows = [
        metaRow('תאריך המסמך', formatPreviewDate(params.document_date), docPreviewIcon('calendar')),
        params.due_date
            ? metaRow('תאריך לתשלום', formatPreviewDate(params.due_date), docPreviewIcon('clock'))
            : '',
        params.payment_terms_display?.trim()
            ? metaRow('תנאי תשלום', params.payment_terms_display, docPreviewIcon('payment'))
            : '',
        params.allocation_number_visible
            ? allocationDocumentMetaRow('מספר הקצאה', params.allocation_number_display != null
                ? String(params.allocation_number_display)
                : '', docPreviewIcon('id'), params.allocation_number_value_empty === true)
            : '',
    ]
        .filter(Boolean)
        .join('');
    const issuerIdentityBlock = `<div class="nx-doc__issuer-identity">
    ${logoHtml}
    <div class="nx-doc__issuer-details">
      <div class="nx-doc__issuer-name">${escapeHtml(params.issuer.display_name)}</div>
      ${subtitle}
    </div>
  </div>`;
    const issuerContactsBlock = issuerContactLines
        ? `<div class="nx-doc__issuer-lines">${issuerContactLines}</div>`
        : '';
    const docTitleBlock = `<h1 class="nx-doc__doc-title">${escapeHtml(params.docTypeLabel)}</h1>${numberBlock}`;
    const docMetaBlock = metaRows ? `<div class="nx-doc__meta-list">${metaRows}</div>` : '';
    const customerHeadBlock = `<header class="nx-doc__customer-head"><span>לכבוד</span></header><div class="nx-doc__customer-name">${escapeHtml(params.recipient.display_name)}</div>`;
    const customerLinesBlock = customerLines ? `<div class="nx-doc__customer-lines">${customerLines}</div>` : '';
    const upperSheetBlock = `<div class="nx-doc__upper-sheet" aria-label="כותרת מסמך">
    ${buildSheetSection(1, issuerIdentityBlock)}
    ${buildSheetSection(2, issuerContactsBlock)}
    ${buildSheetSection(3, docTitleBlock)}
    ${buildSheetSection(4, docMetaBlock)}
    ${buildSheetSection(5, customerHeadBlock)}
    ${buildSheetSection(6, customerLinesBlock)}
  </div>`;
    const colCount = d.show_vat_row ? 7 : 6;
    const linesHtml = params.lineRows.length > 0
        ? params.lineRows
            .map((r) => {
            const vatCell = d.show_vat_row
                ? `<td class="nx-doc__cell-vat">${escapeHtml(r.vat_display)}</td>`
                : '';
            return `<tr>
            <td class="nx-doc__cell-num">${escapeHtml(String(r.row_number))}</td>
            <td class="nx-doc__cell-desc">${escapeHtml(r.description || '—')}</td>
            <td class="nx-doc__cell-qty">${escapeHtml(r.quantity)}</td>
            <td class="nx-doc__cell-money">${escapeHtml(r.unit_price)}</td>
            <td class="nx-doc__cell-currency">${escapeHtml(formatLineCurrency(r.currency))}</td>
            ${vatCell}
            <td class="nx-doc__cell-money nx-doc__cell-total">${escapeHtml(r.total)}</td>
          </tr>`;
        })
            .join('')
        : `<tr><td colspan="${colCount}" class="nx-doc__empty-lines">אין שורות במסמך</td></tr>`;
    const tableColgroup = d.show_vat_row
        ? `<colgroup>
      <col class="nx-doc__col-num" />
      <col class="nx-doc__col-desc" />
      <col class="nx-doc__col-qty" />
      <col class="nx-doc__col-price" />
      <col class="nx-doc__col-currency" />
      <col class="nx-doc__col-vat" />
      <col class="nx-doc__col-total" />
    </colgroup>`
        : `<colgroup>
      <col class="nx-doc__col-num" />
      <col class="nx-doc__col-desc" />
      <col class="nx-doc__col-qty" />
      <col class="nx-doc__col-price" />
      <col class="nx-doc__col-currency" />
      <col class="nx-doc__col-total" />
    </colgroup>`;
    const tableHead = `<tr>
      <th class="nx-doc__th-num">#</th>
      <th>פירוט</th>
      <th>כמות</th>
      <th>מחיר ליח'</th>
      <th>מטבע</th>
      ${d.show_vat_row ? '<th>מע״מ</th>' : ''}
      <th>סה״כ</th>
    </tr>`;
    const tableBlock = isSectioned
        ? `<section class="nx-doc__lines" aria-label="שורות מסמך">
  <table class="nx-doc__table">
    ${tableColgroup}
    <thead>${tableHead}</thead>
    <tbody>${linesHtml}</tbody>
  </table>
</section>`
        : `<table class="nx-doc__table">
    ${tableColgroup}
    <thead>${tableHead}</thead>
    <tbody>${linesHtml}</tbody>
  </table>`;
    const notesHtml = d.show_notes && params.notes?.trim()
        ? `<section class="nx-doc__comments" aria-label="הערות">
      <header class="nx-doc__comments-head"><span>הערות</span></header>
      <div class="nx-doc__comments-body">${escapeHtml(params.notes)}</div>
    </section>`
        : '';
    const signatureHtml = d.show_signature && b.signature_data_url
        ? `<div class="nx-doc__signature" aria-label="חתימה"><img src="${b.signature_data_url}" alt="" /></div>`
        : '';
    const totalsHtml = `
    <section class="nx-doc__summary" aria-label="סיכום כספי">
      <header class="nx-doc__summary-head"><span>סיכום כספי</span></header>
      <div class="nx-doc__summary-body">
        <div class="nx-doc__total-row"><span>סכום ביניים</span><span>${escapeHtml(params.totals.subtotal_before_discount)}</span></div>
        ${d.show_discount_row && discountDisplay
        ? `<div class="nx-doc__total-row nx-doc__total-row--discount"><span>הנחה לפני מע״מ</span><span>${escapeHtml(discountDisplay)}</span></div>
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
    </section>`;
    const paymentHtml = buildPaymentCards({
        branding: b,
        showBankDetails: d.show_bank_details,
        accent,
        payment_link_url: params.payment_link_url,
        payment_qr_data_url: params.payment_qr_data_url,
    });
    const platformFooter = `<footer class="nx-doc__platform-footer">
    <a class="nx-doc__platform-link" href="${NODEXPRO_FOOTER_URL}" target="_blank" rel="noopener noreferrer">
      ${nodexproFooterLogoMarkup()}
      <span>המסמך הופק באמצעות NodexPro</span>
    </a>
  </footer>`;
    return `
<style>
.nx-doc {
  --nx-doc-primary: ${accent};
  --nx-doc-secondary: ${b.secondary_color};
  --nx-doc-icon: var(--nx-doc-primary);
  --nx-doc-bg-card: ${palette.recipient_block_background};
  --nx-doc-border: ${palette.recipient_block_border};
  --nx-doc-text: ${palette.text_on_light};
  --nx-doc-text-muted: #697386;
  --nx-doc-theme-accent: ${accent};
  --nx-doc-table-header: ${palette.table_header_color};
  --nx-doc-header-gradient: ${palette.gradient_css};
  --nx-doc-grand-total-bg: color-mix(in srgb, var(--nx-doc-primary) 6%, #ffffff);
  max-width: 840px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
  font-family: ${INVOICE_FONT};
  color: var(--nx-doc-text);
  font-size: 14px;
  line-height: 1.35;
  background: #fff;
}
.nx-doc * { box-sizing: border-box; }
.nx-doc--unified .nx-doc__upper-sheet {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(100px, 1fr));
  gap: 0;
  width: 100%;
  margin: 0 0 4px;
  border: 1px solid var(--nx-doc-border);
}
.nx-doc--unified .nx-doc__sheet-section {
  position: relative;
  min-height: 100px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--nx-doc-border) 85%, #000);
  box-sizing: border-box;
}
.nx-doc--unified .nx-doc__sheet-section-body {
  height: 100%;
}
.nx-doc--unified .nx-doc__sheet-section-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--nx-doc-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}
.nx-doc--unified .nx-doc__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2px 20px;
  align-items: start;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--nx-doc-border);
}
.nx-doc--unified .nx-doc__header-doc { grid-column: 1; min-width: 0; text-align: start; }
.nx-doc--unified .nx-doc__header-issuer { grid-column: 2; min-width: 0; }
.nx-doc--unified .nx-doc__doc-title {
  margin: 0 0 2px;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--nx-doc-text);
  line-height: 1.06;
}
.nx-doc--unified .nx-doc__doc-number {
  margin: 0 0 3px;
  font-size: 22px;
  font-weight: 700;
  color: var(--nx-doc-primary);
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.nx-doc--unified .nx-doc__doc-number-rule {
  height: 1px;
  background: color-mix(in srgb, var(--nx-doc-primary) 40%, var(--nx-doc-border));
  margin: 0 0 6px;
}
.nx-doc--unified .nx-doc__meta-list {
  width: 100%;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nx-doc--unified .nx-doc__meta-row {
  display: grid;
  grid-template-columns: 16px 112px minmax(0, 1fr);
  gap: 6px 8px;
  align-items: center;
  padding: 0;
  color: var(--nx-doc-text-muted);
  font-size: 13px;
  line-height: 1.3;
}
.nx-doc--unified .nx-doc__meta-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--nx-doc-icon);
  opacity: 0.9;
}
.nx-doc--unified .nx-doc__meta-icon .nx-doc__icon { width: 16px; height: 16px; }
.nx-doc--unified .nx-doc__meta-label { color: var(--nx-doc-text-muted); white-space: nowrap; font-weight: 500; }
.nx-doc--unified .nx-doc__meta-row--allocation {
  grid-template-columns: 16px auto minmax(0, 1fr);
}
.nx-doc--unified .nx-doc__meta-value { color: var(--nx-doc-text); font-weight: 600; justify-self: start; }
.nx-doc--unified .nx-doc__meta-value--empty {
  color: var(--nx-doc-text-muted);
  font-weight: 500;
}
.nx-doc--unified .nx-doc__issuer-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: end;
  gap: 0;
  width: 100%;
}
.nx-doc--unified .nx-doc__issuer-details { width: 100%; }
.nx-doc--unified .nx-doc__issuer-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  width: 100%;
}
.nx-doc--unified .nx-doc__issuer-line,
.nx-doc--unified .nx-doc__customer-line {
  display: grid;
  grid-template-columns: ${PARTY_LINE_ICON_PX}px minmax(0, 1fr);
  gap: ${PARTY_LINE_GAP_PX}px;
  align-items: start;
  padding: 0;
  font-size: 12px;
  color: var(--nx-doc-text);
  line-height: 1.35;
}
.nx-doc--unified .nx-doc__issuer-line-icon,
.nx-doc--unified .nx-doc__customer-line-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: ${PARTY_LINE_ICON_PX}px;
  height: ${PARTY_LINE_ICON_PX}px;
  margin-top: 1px;
  color: var(--nx-doc-icon);
  opacity: 0.92;
}
.nx-doc--unified .nx-doc__issuer-line-icon .nx-doc__icon,
.nx-doc--unified .nx-doc__customer-line-icon .nx-doc__icon {
  width: ${PARTY_LINE_ICON_PX}px;
  height: ${PARTY_LINE_ICON_PX}px;
}
.nx-doc--unified .nx-doc__issuer-line-icon--spacer,
.nx-doc--unified .nx-doc__customer-line-icon--spacer {
  visibility: hidden;
}
.nx-doc--unified .nx-doc__issuer-line-value,
.nx-doc--unified .nx-doc__customer-line-value {
  text-align: start;
  min-width: 0;
  word-break: break-word;
}
.nx-doc--unified .nx-doc__customer-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  width: 100%;
}
.nx-doc--unified .nx-doc__logo-img {
  max-width: ${Math.min(logoDims.maxWidthPx, 280)}px;
  max-height: 80px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: 0;
  align-self: flex-end;
}
.nx-doc--unified .nx-doc__logo-placeholder {
  width: ${Math.round(Math.min(logoDims.maxWidthPx, 200) * 0.75)}px;
  height: ${Math.round(Math.min(logoDims.maxHeightPx, 80) * 0.85)}px;
  background: transparent;
  border: 1px dashed var(--nx-doc-border);
  border-radius: 2px;
  margin: 0;
  align-self: flex-end;
}
.nx-doc--unified .nx-doc__issuer-name {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 0;
  line-height: 1.12;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__issuer-subtitle {
  font-size: 12px;
  color: var(--nx-doc-text-muted);
  margin-bottom: 1px;
  line-height: 1.25;
}
.nx-doc--unified .nx-doc__customer {
  width: 100%;
  margin: 0;
  padding: 0 0 4px;
  border-bottom: 1px solid var(--nx-doc-border);
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
.nx-doc--unified .nx-doc__customer-head {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
  line-height: 1.2;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__customer-name {
  font-size: 19px;
  font-weight: 700;
  margin-bottom: 3px;
  line-height: 1.12;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  margin: 0 0 14px;
  border: 1px solid #e2e8f0;
  border-radius: 0;
  overflow: visible;
  table-layout: fixed;
  background: #fff;
}
.nx-doc--unified .nx-doc__col-num { width: 4%; }
.nx-doc--unified .nx-doc__col-desc { width: 36%; }
.nx-doc--unified .nx-doc__col-qty { width: 8%; }
.nx-doc--unified .nx-doc__col-price { width: 14%; }
.nx-doc--unified .nx-doc__col-currency { width: 8%; }
.nx-doc--unified .nx-doc__col-vat { width: 10%; }
.nx-doc--unified .nx-doc__col-total { width: 20%; }
.nx-doc--unified .nx-doc__table thead { display: table-header-group; }
.nx-doc--unified .nx-doc__table thead th {
  background: #f8fafc;
  color: #475569;
  padding: 9px 10px;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  border: none;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.nx-doc--unified .nx-doc__table tbody td {
  padding: 7px 8px;
  font-size: 14px;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  background: #fff;
  line-height: 1.3;
}
.nx-doc--unified .nx-doc__table tbody tr:last-child td { border-bottom: none; }
.nx-doc--unified .nx-doc__cell-num { text-align: center; white-space: nowrap; color: var(--nx-doc-text-muted); font-variant-numeric: tabular-nums; }
.nx-doc--unified .nx-doc__th-num { text-align: center; }
.nx-doc--unified .nx-doc__cell-desc { font-weight: 500; color: var(--nx-doc-text); word-wrap: break-word; overflow-wrap: anywhere; }
.nx-doc--unified .nx-doc__cell-qty { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.nx-doc--unified .nx-doc__cell-currency { text-align: center; white-space: nowrap; font-size: 13px; }
.nx-doc--unified .nx-doc__cell-vat { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 13px; }
.nx-doc--unified .nx-doc__cell-money { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.nx-doc--unified .nx-doc__cell-total { font-weight: 700; color: var(--nx-doc-text); }
.nx-doc--unified .nx-doc__bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
  margin-bottom: 14px;
}
.nx-doc--unified .nx-doc__summary { grid-column: 2; }
.nx-doc--unified .nx-doc__comments { grid-column: 1; }
.nx-doc--unified .nx-doc__summary-head,
.nx-doc--unified .nx-doc__comments-head {
  font-weight: 700;
  font-size: 16px;
  margin-bottom: 4px;
  color: var(--nx-doc-text);
  text-transform: none;
  letter-spacing: 0;
}
.nx-doc--unified .nx-doc__summary-body {
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  max-width: 320px;
  margin-inline-start: auto;
}
.nx-doc--unified .nx-doc__comments {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  min-height: 0;
  box-shadow: none;
}
.nx-doc--unified .nx-doc__comments-body { white-space: pre-wrap; font-size: 14px; color: var(--nx-doc-text-muted); line-height: 1.45; }
.nx-doc--unified .nx-doc__total-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 0;
  font-size: 14px;
  border-bottom: 1px solid #eef0f6;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__total-row--discount span:first-child,
.nx-doc--unified .nx-doc__total-row--discount span:last-child { color: var(--nx-doc-text) !important; font-weight: 500; }
.nx-doc--unified .nx-doc__grand-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-top: 8px;
  padding: 10px 0 0;
  border-top: 2px solid var(--nx-doc-primary);
  background: transparent;
  color: var(--nx-doc-text);
  border-radius: 0;
  font-size: 14px;
  font-weight: 700;
}
.nx-doc--unified .nx-doc__grand-total strong {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.08;
  color: var(--nx-doc-primary);
  font-variant-numeric: tabular-nums;
}
.nx-doc--unified .nx-doc__payments { margin-bottom: 8px; }
.nx-doc--unified .nx-doc__payments-head {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__payments-head > .nx-doc__icon { display: none; }
.nx-doc--unified .nx-doc__payments-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  align-items: stretch;
  border-top: 1px solid var(--nx-doc-border);
  border-bottom: 1px solid var(--nx-doc-border);
}
.nx-doc--unified .nx-doc__payment-col {
  background: transparent;
  border: none;
  border-inline-end: 1px solid #eef0f6;
  border-radius: 0;
  padding: 8px 10px;
  min-height: 64px;
  height: 100%;
  box-shadow: none;
}
.nx-doc--unified .nx-doc__payment-col:last-child { border-inline-end: none; }
.nx-doc--unified .nx-doc__payment-col-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 3px;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__payment-col-head > .nx-doc__icon {
  display: inline-flex;
  color: var(--nx-doc-icon);
  width: 13px;
  height: 13px;
  opacity: 0.85;
}
.nx-doc--unified .nx-doc__payment-col-body { font-size: 11px; color: var(--nx-doc-text-muted); line-height: 1.4; }
.nx-doc--unified .nx-doc__payment-col-body--card { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; flex-direction: row-reverse; }
.nx-doc--unified .nx-doc__payment-col-text { flex: 1; min-width: 0; word-break: break-word; }
.nx-doc--unified .nx-doc__payment-qr { display: block; width: 68px; height: 68px; flex-shrink: 0; object-fit: contain; }
.nx-doc--unified .nx-doc__platform-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0 2px;
  border-top: 1px solid var(--nx-doc-border);
  margin-top: 2px;
}
.nx-doc--unified .nx-doc__platform-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--nx-doc-text-muted);
  font-size: 10px;
  text-decoration: none;
}
.nx-doc__icon { display: block; flex-shrink: 0; }
.nx-doc__header { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; align-items: start; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--nx-doc-border); }
.nx-doc__header-doc { grid-column: 1; text-align: start; }
.nx-doc__header-issuer { grid-column: 2; }
.nx-doc__issuer-identity { display: flex; flex-direction: column; align-items: flex-end; text-align: end; gap: 0; }
.nx-doc__doc-title { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: var(--nx-doc-text); line-height: 1.08; }
.nx-doc__doc-number {
  margin: 0 0 6px; font-size: 16px; font-weight: 700; color: var(--nx-doc-primary);
  letter-spacing: 0.01em; font-variant-numeric: tabular-nums; line-height: 1.2;
}
.nx-doc__meta-row { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: baseline; padding: 0; color: var(--nx-doc-text-muted); font-size: 12px; line-height: 1.25; }
.nx-doc__meta-row > .nx-doc__icon { display: none; }
.nx-doc__meta-label { color: var(--nx-doc-text-muted); }
.nx-doc__meta-value { color: var(--nx-doc-text); font-weight: 600; }
.nx-doc__logo-img { max-width: ${Math.min(logoDims.maxWidthPx, 160)}px; max-height: ${Math.min(logoDims.maxHeightPx, 40)}px; width: auto; height: auto; object-fit: contain; display: block; margin: 0 0 4px 0; align-self: flex-end; }
.nx-doc__logo-placeholder { width: ${Math.round(Math.min(logoDims.maxWidthPx, 160) * 0.72)}px; height: ${Math.round(Math.min(logoDims.maxHeightPx, 40) * 0.58)}px; background: transparent; border: 1px dashed var(--nx-doc-border); border-radius: 4px; margin: 0 0 4px 0; align-self: flex-end; }
.nx-doc__issuer-name { font-size: 17px; font-weight: 700; margin-bottom: 0; line-height: 1.15; }
.nx-doc__issuer-subtitle { font-size: 12px; color: var(--nx-doc-text-muted); margin-bottom: 2px; line-height: 1.25; }
.nx-doc__issuer-line { display: grid; grid-template-columns: ${PARTY_LINE_ICON_PX}px minmax(0, 1fr); gap: ${PARTY_LINE_GAP_PX}px; align-items: start; padding: 0; font-size: 12px; color: var(--nx-doc-text); line-height: 1.35; }
.nx-doc__issuer-line-icon { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; color: var(--nx-doc-icon); width: ${PARTY_LINE_ICON_PX}px; height: ${PARTY_LINE_ICON_PX}px; }
.nx-doc__issuer-line-icon--spacer { visibility: hidden; }
.nx-doc__issuer-line-value { text-align: start; line-height: 1.35; min-width: 0; word-break: break-word; }
.nx-doc__customer { width: 100%; margin: 0; padding: 0 0 6px; border-bottom: 1px solid var(--nx-doc-border); background: transparent; box-shadow: none; }
.nx-doc__customer-head { font-weight: 600; font-size: 14px; margin-bottom: 2px; line-height: 1.2; color: var(--nx-doc-text); }
.nx-doc__customer-name { font-size: 19px; font-weight: 700; margin-bottom: 2px; line-height: 1.15; color: var(--nx-doc-text); }
.nx-doc__customer-lines { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; width: 100%; }
.nx-doc__customer-line { display: grid; grid-template-columns: ${PARTY_LINE_ICON_PX}px minmax(0, 1fr); gap: ${PARTY_LINE_GAP_PX}px; align-items: start; font-size: 12px; padding: 0; color: var(--nx-doc-text); line-height: 1.35; }
.nx-doc__customer-line-icon { display: inline-flex; margin-top: 0; align-items: center; justify-content: center; color: var(--nx-doc-icon); width: ${PARTY_LINE_ICON_PX}px; height: ${PARTY_LINE_ICON_PX}px; }
.nx-doc__customer-line-icon--spacer { visibility: hidden; }
.nx-doc__customer-line-value { text-align: start; min-width: 0; word-break: break-word; }
.nx-doc__table { width: 100%; border-collapse: collapse; border-spacing: 0; margin: 0 0 16px; border: none; }
.nx-doc__table thead th { background: var(--nx-doc-primary); color: #fff; padding: 8px; font-size: 13px; font-weight: 700; text-align: right; border: none; border-bottom: 1px solid color-mix(in srgb, var(--nx-doc-primary) 80%, #000); }
.nx-doc__table tbody td { padding: 7px 8px; font-size: 13px; border: none; border-bottom: 1px solid var(--nx-doc-border); vertical-align: top; background: #fff; }
.nx-doc__cell-desc { font-weight: 500; color: var(--nx-doc-text); }
.nx-doc__empty-lines { text-align: center; color: var(--nx-doc-text-muted); padding: 16px !important; }
.nx-doc__bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; margin-bottom: 20px; }
.nx-doc__comments { grid-column: 1; background: transparent; border: none; padding: 0; min-height: 0; box-shadow: none; }
.nx-doc__comments-head { font-weight: 700; font-size: 13px; margin-bottom: 6px; color: var(--nx-doc-text); }
.nx-doc__comments-head > .nx-doc__icon { display: none; }
.nx-doc__comments-body { white-space: pre-wrap; font-size: 13px; color: var(--nx-doc-text-muted); line-height: 1.45; }
.nx-doc__summary { grid-column: 2; }
.nx-doc__summary-head { font-weight: 700; font-size: 13px; margin-bottom: 6px; color: var(--nx-doc-text); }
.nx-doc__summary-head > .nx-doc__icon { display: none; }
.nx-doc__total-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13px; border-bottom: 1px solid var(--nx-doc-border); color: var(--nx-doc-text); }
.nx-doc__total-row--discount span:first-child,
.nx-doc__total-row--discount span:last-child { color: var(--nx-doc-text) !important; font-weight: 500; }
.nx-doc__grand-total {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 6px; padding: 8px 0 0;
  border-top: 2px solid var(--nx-doc-primary); background: transparent; color: var(--nx-doc-text); border-radius: 0; font-size: 13px; font-weight: 700;
}
.nx-doc__grand-total strong { font-size: 20px; font-weight: 800; line-height: 1.1; color: var(--nx-doc-primary); }
.nx-doc__payments { margin-bottom: 12px; }
.nx-doc__payments-head { font-size: 13px; font-weight: 700; margin-bottom: 6px; color: var(--nx-doc-text); }
.nx-doc__payments-head > .nx-doc__icon { display: none; }
.nx-doc__payments-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; align-items: stretch; border-top: 1px solid var(--nx-doc-border); border-bottom: 1px solid var(--nx-doc-border); }
.nx-doc__payment-col { background: transparent; border: none; border-inline-end: 1px solid var(--nx-doc-border); padding: 8px 12px; min-height: 72px; height: 100%; box-shadow: none; }
.nx-doc__payment-col-head { font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--nx-doc-text); }
.nx-doc__payment-col-head > .nx-doc__icon { display: none; }
.nx-doc__payment-col-body { font-size: 12px; color: var(--nx-doc-text-muted); line-height: 1.45; }
.nx-doc__payment-col-body--card { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.nx-doc__payment-col-text { flex: 1; min-width: 0; word-break: break-word; }
.nx-doc__payment-qr { display: block; width: 72px; height: 72px; flex-shrink: 0; object-fit: contain; }
.nx-doc__signature { margin: 0 0 8px; text-align: end; }
.nx-doc__signature img { max-width: 180px; max-height: 72px; object-fit: contain; }
.nx-doc__platform-footer { display: flex; align-items: center; justify-content: center; padding: 12px 0 4px; border-top: 1px solid var(--nx-doc-border); margin-top: 4px; }
.nx-doc__platform-link { display: inline-flex; align-items: center; gap: 8px; color: var(--nx-doc-text-muted); font-size: 11px; text-decoration: none; }
.nx-doc__platform-link:hover { color: var(--nx-doc-primary); }
@media print {
  .nx-doc { max-width: none; padding: 0; }
  .nx-doc__payment-col, .nx-doc__comments, .nx-doc__customer { box-shadow: none; }
}

/* Sectioned style — reference enterprise sections + Excel grid; classic path above stays unchanged */
.nx-doc--sectioned {
  padding: 4px 0 0;
}
.nx-doc--sectioned .nx-doc__upper-sheet {
  margin-bottom: 14px;
  border-color: #e5e7eb;
}
.nx-doc--sectioned .nx-doc__sheet-section {
  min-height: 110px;
  padding: 10px 12px;
  border-color: #d5dae3;
}
.nx-doc--sectioned .nx-doc__sheet-section--5,
.nx-doc--sectioned .nx-doc__sheet-section--6 {
  background: color-mix(in srgb, var(--nx-doc-primary) 7%, #ffffff);
}
.nx-doc--sectioned .nx-doc__doc-title {
  font-size: 28px;
  margin: 0 0 8px;
}
.nx-doc--sectioned .nx-doc__doc-number {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--nx-doc-text);
}
.nx-doc--sectioned .nx-doc__doc-number-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nx-doc-primary) 14%, #ffffff);
  color: var(--nx-doc-primary);
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.nx-doc--sectioned .nx-doc__doc-number-rule { display: none; }
.nx-doc--sectioned .nx-doc__logo-img {
  max-width: ${Math.min(logoDims.maxWidthPx, 280)}px;
  max-height: 80px;
  margin: 0 0 2px;
}
.nx-doc--sectioned .nx-doc__issuer-identity { gap: 0; }
.nx-doc--sectioned .nx-doc__issuer-name { font-size: 18px; margin-bottom: 2px; }
.nx-doc--sectioned .nx-doc__issuer-lines { margin-top: 2px; gap: 3px; }
.nx-doc--sectioned .nx-doc__customer-head { margin-bottom: 4px; }
.nx-doc--sectioned .nx-doc__customer-name { margin-bottom: 6px; }
.nx-doc--sectioned .nx-doc__lines { margin: 0 0 14px; }
.nx-doc--sectioned .nx-doc__table {
  border: 1px solid #c5cad4;
  margin: 0;
  border-radius: 0;
  overflow: hidden;
}
.nx-doc--sectioned .nx-doc__table thead th {
  background: var(--nx-doc-primary);
  color: #fff;
  padding: 9px 8px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid color-mix(in srgb, var(--nx-doc-primary) 78%, #000);
  border-bottom: 1px solid color-mix(in srgb, var(--nx-doc-primary) 70%, #000);
  white-space: nowrap;
}
.nx-doc--sectioned .nx-doc__table tbody td {
  padding: 8px;
  font-size: 13px;
  border: 1px solid #d5dae3;
  background: #fff;
  vertical-align: middle;
}
.nx-doc--sectioned .nx-doc__table tbody tr:last-child td {
  border-bottom: 1px solid #d5dae3;
}
.nx-doc--sectioned .nx-doc__bottom {
  gap: 16px;
  margin-bottom: 16px;
}
.nx-doc--sectioned .nx-doc__comments {
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fafbfd;
  min-height: 72px;
}
.nx-doc--sectioned .nx-doc__summary-body {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--nx-doc-primary) 18%, #e5e7eb);
  border-radius: 10px;
  background: color-mix(in srgb, var(--nx-doc-primary) 5%, #ffffff);
  max-width: 100%;
}
.nx-doc--sectioned .nx-doc__grand-total {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 2px solid var(--nx-doc-primary);
}
.nx-doc--sectioned .nx-doc__payments-grid {
  gap: 10px;
  border: none;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.nx-doc--sectioned .nx-doc__payment-col {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  border-inline-end: 1px solid #e5e7eb;
  min-height: 88px;
}
.nx-doc--sectioned .nx-doc__payment-col:last-child {
  border-inline-end: 1px solid #e5e7eb;
}
.nx-doc--sectioned .nx-doc__payment-col-head > .nx-doc__icon {
  display: inline-flex;
}
.nx-doc--sectioned .nx-doc__platform-footer {
  margin-top: 10px;
  padding-top: 10px;
}
</style>
<div class="${rootClass}" dir="rtl">
  ${upperSheetBlock}

  ${tableBlock}

  <div class="nx-doc__bottom">
    ${notesHtml}
    ${totalsHtml}
  </div>

  ${paymentHtml}
  ${signatureHtml}
  ${platformFooter}
</div>
  `.trim();
}
export function renderStudioSamplePreviewHtml(branding, docTypeLabel = 'הצעת מחיר') {
    return renderIncomeBrandedPreviewHtml({
        branding,
        docTypeLabel,
        numberPreview: '2026-000154',
        issuer: {
            display_name: STUDIO_SAMPLE_ISSUER.display_name,
            tax_id: STUDIO_SAMPLE_ISSUER.tax_id,
            address: STUDIO_SAMPLE_ISSUER.address,
            phone: STUDIO_SAMPLE_ISSUER.phone,
            email: STUDIO_SAMPLE_ISSUER.email,
            website: 'www.example.com',
        },
        recipient: {
            display_name: STUDIO_SAMPLE_RECIPIENT.display_name,
            tax_id: STUDIO_SAMPLE_RECIPIENT.tax_id,
            address: STUDIO_SAMPLE_RECIPIENT.address,
            phone: STUDIO_SAMPLE_RECIPIENT.phone,
            email: STUDIO_SAMPLE_RECIPIENT.email,
            contact_name: 'איש קשר לדוגמה',
        },
        document_date: '2026-07-11',
        due_date: '2026-08-10',
        payment_terms_display: 'שוטף + 30 ימים',
        currency: 'ILS',
        lineRows: [
            {
                row_number: 1,
                description: 'רישיון תוכנה שנתי',
                quantity: '1',
                unit: 'יחידה',
                unit_price: '₪1,000.00',
                discount: '—',
                currency: '₪',
                vat_display: '₪171.00',
                vat_rate_label: '18%',
                total: '₪1,000.00',
            },
            {
                row_number: 2,
                description: 'תמיכה פרימיום',
                quantity: '1',
                unit: 'חודש',
                unit_price: '₪298.00',
                discount: '—',
                currency: '₪',
                vat_display: '₪53.64',
                vat_rate_label: '18%',
                total: '₪298.00',
            },
        ],
        totals: {
            subtotal_before_discount: '₪1,298.00',
            discount: '₪100.00',
            subtotal_after_discount: '₪1,198.00',
            vat_label: 'מע״מ (18%)',
            vat: '₪215.64',
            grand_total: '₪1,413.64',
        },
        notes: 'תודה על שיתוף הפעולה.',
        company_subtitle: branding.company_subtitle,
    });
}
