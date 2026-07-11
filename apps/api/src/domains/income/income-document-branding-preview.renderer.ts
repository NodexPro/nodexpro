import type { IncomeBrandingResolvedProfile } from './income-document-branding.types.js';
import {
  formatDocumentNumberDisplay,
  resolveBrandingPreviewThemePalette,
  resolveLogoSizeDimensions,
  STUDIO_SAMPLE_ISSUER,
  STUDIO_SAMPLE_RECIPIENT,
} from './income-document-branding.pure.js';
import { docPreviewIcon, nodexproFooterLogoMarkup } from './income-document-preview-icons.pure.js';

const INVOICE_FONT = 'Heebo, Arial, Helvetica, "Segoe UI", sans-serif';
const NODEXPRO_FOOTER_URL = 'https://www.nodexpro.com';

function escapeHtml(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPreviewDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDiscountDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[\s−\-–—]+/, '').trim();
}

export type IncomeBrandingPreviewParty = {
  display_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website?: string | null;
  contact_name?: string | null;
};

export type IncomeBrandingPreviewLineRow = {
  row_number: number;
  description: string;
  quantity: string;
  unit?: string | null;
  unit_price: string;
  discount?: string | null;
  currency: string;
  vat_rate_label: string;
  total: string;
};

export type IncomeBrandingPreviewTotals = {
  subtotal_before_discount: string;
  discount: string | null;
  subtotal_after_discount: string;
  vat_label: string | null;
  vat: string | null;
  grand_total: string;
};

function partyInfoRow(
  classPrefix: 'issuer' | 'customer',
  icon: string,
  value: string | null,
): string {
  if (!value?.trim()) return '';
  return `<div class="nx-doc__${classPrefix}-line"><span class="nx-doc__${classPrefix}-line-icon">${icon}</span><span class="nx-doc__${classPrefix}-line-value">${escapeHtml(value)}</span></div>`;
}

function issuerInfoRow(icon: string, value: string | null, visible: boolean): string {
  if (!visible || !value?.trim()) return '';
  return partyInfoRow('issuer', icon, value);
}

function customerInfoRow(icon: string, value: string | null): string {
  return partyInfoRow('customer', icon, value);
}

function customerPlainLine(value: string | null): string {
  if (!value?.trim()) return '';
  return `<div class="nx-doc__customer-line nx-doc__customer-line--plain"><span>${escapeHtml(value)}</span></div>`;
}

function buildPaymentCards(params: {
  branding: IncomeBrandingResolvedProfile;
  showBankDetails: boolean;
  accent: string;
  payment_link_url?: string | null;
  payment_qr_data_url?: string | null;
}): string {
  const b = params.branding;
  const enabled = b.payment_methods.filter((m) => m.enabled);
  if (!enabled.length && !params.showBankDetails) return '';

  const bankEnabled = enabled.some((m) => m.key === 'bank_transfer');
  const cardEnabled = enabled.some((m) => m.key === 'credit_card');
  const otherMethods = enabled.filter((m) => m.key !== 'bank_transfer' && m.key !== 'credit_card');

  const bankLines: string[] = [];
  if (params.showBankDetails) {
    if (b.bank_name) bankLines.push(`בנק: ${escapeHtml(b.bank_name)}`);
    if (b.bank_branch) bankLines.push(`סניף: ${escapeHtml(b.bank_branch)}`);
    if (b.bank_account) bankLines.push(`חשבון: ${escapeHtml(b.bank_account)}`);
    if (b.iban) bankLines.push(`IBAN: ${escapeHtml(b.iban)}`);
    if (b.swift) bankLines.push(`SWIFT: ${escapeHtml(b.swift)}`);
    if (b.payment_instructions) bankLines.push(escapeHtml(b.payment_instructions));
  }

  const cards: string[] = [];

  if (bankEnabled || bankLines.length) {
    cards.push(`<article class="nx-doc__payment-card nx-doc__payment-card--bank">
      <header class="nx-doc__payment-card-head">${docPreviewIcon('bank')}<strong>העברה בנקאית</strong></header>
      <div class="nx-doc__payment-card-body">${bankLines.length ? bankLines.join('<br/>') : '—'}</div>
    </article>`);
  }

  if (cardEnabled && params.payment_link_url?.trim()) {
    const cardMethod = enabled.find((m) => m.key === 'credit_card');
    const link = escapeHtml(params.payment_link_url.trim());
    const qrBlock = params.payment_qr_data_url?.trim()
      ? `<img class="nx-doc__payment-qr" src="${escapeHtml(params.payment_qr_data_url.trim())}" alt="" />`
      : '';
    cards.push(`<article class="nx-doc__payment-card nx-doc__payment-card--card">
      <header class="nx-doc__payment-card-head">${docPreviewIcon('card')}<strong>${escapeHtml(cardMethod?.label ?? 'כרטיס אשראי')}</strong></header>
      <div class="nx-doc__payment-card-body nx-doc__payment-card-body--card">
        ${qrBlock}
        <div class="nx-doc__payment-card-text"><div><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div></div>
      </div>
    </article>`);
  }

  if (otherMethods.length) {
    cards.push(`<article class="nx-doc__payment-card nx-doc__payment-card--other">
      <header class="nx-doc__payment-card-head">${docPreviewIcon('payment')}<strong>אמצעי תשלום נוספים</strong></header>
      <div class="nx-doc__payment-card-body">${otherMethods.map((m) => `<div>${escapeHtml(m.label)}</div>`).join('')}</div>
    </article>`);
  }

  if (!cards.length) return '';
  return `<section class="nx-doc__payments" aria-label="אמצעי תשלום">
    <header class="nx-doc__payments-head">${docPreviewIcon('payment')}<span>אמצעי תשלום</span></header>
    <div class="nx-doc__payments-grid">${cards.join('')}</div>
  </section>`;
}

export function renderIncomeBrandedPreviewHtml(params: {
  branding: IncomeBrandingResolvedProfile;
  docTypeLabel: string;
  numberPreview: string | null;
  issuer: IncomeBrandingPreviewParty;
  recipient: IncomeBrandingPreviewParty;
  document_date: string | null;
  due_date: string | null;
  payment_terms_display?: string | null;
  payment_link_url?: string | null;
  payment_qr_data_url?: string | null;
  currency: string;
  lineRows: IncomeBrandingPreviewLineRow[];
  totals: IncomeBrandingPreviewTotals;
  notes: string | null;
  company_subtitle: string | null;
}): string {
  const b = params.branding;
  const d = b.display_options;
  const palette = resolveBrandingPreviewThemePalette(b.color_theme);
  const accent = palette.totals_accent_color;
  const numberDisplay = formatDocumentNumberDisplay(params.numberPreview);
  const logoDims = resolveLogoSizeDimensions(b.logo_size_key);
  const discountDisplay = formatDiscountDisplay(params.totals.discount);

  const logoHtml =
    d.show_logo && b.logo_data_url
      ? `<img class="nx-doc__logo-img" src="${b.logo_data_url}" alt="" />`
      : d.show_logo
        ? `<div class="nx-doc__logo-placeholder" aria-hidden="true"></div>`
        : '';

  const subtitle =
    params.company_subtitle?.trim() || b.company_subtitle?.trim()
      ? `<div class="nx-doc__issuer-subtitle">${escapeHtml(params.company_subtitle ?? b.company_subtitle)}</div>`
      : '';

  const issuerContactLines = [
    issuerInfoRow(docPreviewIcon('location'), params.issuer.address, d.show_business_address),
    issuerInfoRow(docPreviewIcon('id'), params.issuer.tax_id, d.show_business_tax_id),
    issuerInfoRow(docPreviewIcon('phone'), params.issuer.phone, d.show_business_phone),
    issuerInfoRow(docPreviewIcon('mail'), params.issuer.email, d.show_business_email),
    issuerInfoRow(docPreviewIcon('website'), params.issuer.website ?? null, Boolean(params.issuer.website?.trim())),
  ]
    .filter(Boolean)
    .join('');

  const issuerBlock = `<div class="nx-doc__issuer-identity">
    ${logoHtml}
    <div class="nx-doc__issuer-details">
      <div class="nx-doc__issuer-name">${escapeHtml(params.issuer.display_name)}</div>
      ${subtitle}
      ${issuerContactLines ? `<div class="nx-doc__issuer-lines">${issuerContactLines}</div>` : ''}
    </div>
  </div>`;

  const customerBlock = `
    <header class="nx-doc__customer-head">${docPreviewIcon('user')}<span>לכבוד</span></header>
    <div class="nx-doc__customer-name">${escapeHtml(params.recipient.display_name)}</div>
    ${customerPlainLine(params.recipient.contact_name ?? null)}
    ${customerInfoRow(docPreviewIcon('location'), params.recipient.address)}
    ${customerInfoRow(docPreviewIcon('id'), params.recipient.tax_id)}
    ${customerInfoRow(docPreviewIcon('phone'), params.recipient.phone)}
    ${customerInfoRow(docPreviewIcon('mail'), params.recipient.email)}
    ${customerInfoRow(docPreviewIcon('website'), params.recipient.website ?? null)}
  `;

  const metaRows = [
    `<div class="nx-doc__meta-row">${docPreviewIcon('calendar')}<span class="nx-doc__meta-label">תאריך המסמך</span><span class="nx-doc__meta-value">${escapeHtml(formatPreviewDate(params.document_date))}</span></div>`,
    d.show_due_date
      ? `<div class="nx-doc__meta-row">${docPreviewIcon('calendar')}<span class="nx-doc__meta-label">תאריך לתשלום</span><span class="nx-doc__meta-value">${escapeHtml(formatPreviewDate(params.due_date))}</span></div>`
      : '',
    d.show_payment_terms && params.payment_terms_display?.trim()
      ? `<div class="nx-doc__meta-row">${docPreviewIcon('clock')}<span class="nx-doc__meta-label">תנאי תשלום</span><span class="nx-doc__meta-value">${escapeHtml(params.payment_terms_display)}</span></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const linesHtml =
    params.lineRows.length > 0
      ? params.lineRows
          .map((r) => {
            const unit = r.unit?.trim() || '—';
            const lineDiscount = formatDiscountDisplay(r.discount) ?? (r.discount?.trim() || '—');
            return `<tr>
            <td class="nx-doc__cell-desc">${escapeHtml(r.description || '—')}</td>
            <td class="nx-doc__cell-qty">${escapeHtml(r.quantity)}</td>
            <td>${escapeHtml(unit)}</td>
            <td class="nx-doc__cell-money">${escapeHtml(r.unit_price)}</td>
            <td class="nx-doc__cell-money nx-doc__cell-discount">${escapeHtml(lineDiscount)}</td>
            ${d.show_vat_row ? `<td class="nx-doc__cell-money">${escapeHtml(r.vat_rate_label)}</td>` : ''}
            <td class="nx-doc__cell-money nx-doc__cell-total">${escapeHtml(r.total)}</td>
          </tr>`;
          })
          .join('')
      : `<tr><td colspan="7" class="nx-doc__empty-lines">אין שורות במסמך</td></tr>`;

  const tableHead = `<tr>
      <th>תיאור</th>
      <th>כמות</th>
      <th>יחידת מידה</th>
      <th>מחיר יחידה</th>
      <th>הנחה</th>
      ${d.show_vat_row ? '<th>סכום מע״מ</th>' : ''}
      <th>סכום</th>
    </tr>`;

  const notesHtml =
    d.show_notes && params.notes?.trim()
      ? `<section class="nx-doc__comments" aria-label="הערות">
      <header class="nx-doc__comments-head">${docPreviewIcon('comment')}<span>הערות</span></header>
      <div class="nx-doc__comments-body">${escapeHtml(params.notes)}</div>
    </section>`
      : '';

  const signatureHtml =
    d.show_signature && b.signature_data_url
      ? `<div class="nx-doc__signature" aria-label="חתימה"><img src="${b.signature_data_url}" alt="" /></div>`
      : '';

  const totalsHtml = `
    <section class="nx-doc__summary" aria-label="סיכום כספי">
      <header class="nx-doc__summary-head">${docPreviewIcon('calculator')}<span>סיכום כספי</span></header>
      <div class="nx-doc__summary-body">
        <div class="nx-doc__total-row"><span>סכום ביניים</span><span>${escapeHtml(params.totals.subtotal_before_discount)}</span></div>
        ${
          d.show_discount_row && discountDisplay
            ? `<div class="nx-doc__total-row nx-doc__total-row--discount"><span>הנחה לפני מע״מ</span><span>${escapeHtml(discountDisplay)}</span></div>
        <div class="nx-doc__total-row"><span>סכום לאחר הנחה</span><span>${escapeHtml(params.totals.subtotal_after_discount)}</span></div>`
            : ''
        }
        ${
          d.show_vat_row && params.totals.vat
            ? `<div class="nx-doc__total-row"><span>${escapeHtml(params.totals.vat_label ?? 'מע״מ')}</span><span>${escapeHtml(params.totals.vat)}</span></div>`
            : ''
        }
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
      <span>מסמך זה הופק באמצעות מערכת NodexPro</span>
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
  padding: 20px 24px 12px;
  box-sizing: border-box;
  font-family: ${INVOICE_FONT};
  color: var(--nx-doc-text);
  font-size: 14px;
  line-height: 1.45;
  background: #fff;
}
.nx-doc * { box-sizing: border-box; }
.nx-doc--unified .nx-doc__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px 40px;
  align-items: start;
  margin-bottom: 24px;
  padding-bottom: 0;
  border-bottom: none;
}
.nx-doc--unified .nx-doc__header-doc { grid-column: 1; min-width: 0; }
.nx-doc--unified .nx-doc__header-issuer { grid-column: 2; min-width: 0; }
.nx-doc--unified .nx-doc__doc-title {
  margin: 0 0 12px;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--nx-doc-text);
  line-height: 1.15;
}
.nx-doc--unified .nx-doc__doc-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: 12px;
  background: ${palette.gradient_css};
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 16px;
  box-shadow: none;
}
.nx-doc--unified .nx-doc__meta-list {
  width: 100%;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.nx-doc--unified .nx-doc__meta-row {
  display: grid;
  grid-template-columns: 16px auto 1fr;
  gap: 8px 12px;
  align-items: center;
  padding: 4px 0;
  color: var(--nx-doc-text-muted);
  font-size: 13px;
}
.nx-doc--unified .nx-doc__meta-row > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__meta-label { color: var(--nx-doc-text-muted); white-space: nowrap; }
.nx-doc--unified .nx-doc__meta-value { color: var(--nx-doc-text); font-weight: 600; justify-self: start; }
.nx-doc--unified .nx-doc__issuer-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: end;
  gap: 0;
  width: 100%;
}
.nx-doc--unified .nx-doc__issuer-details { width: 100%; }
.nx-doc--unified .nx-doc__issuer-lines { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.nx-doc--unified .nx-doc__logo-img {
  max-width: ${Math.min(logoDims.maxWidthPx, 220)}px;
  max-height: ${Math.min(logoDims.maxHeightPx, 72)}px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: 0 0 8px 0;
  align-self: flex-end;
}
.nx-doc--unified .nx-doc__logo-placeholder {
  width: ${Math.round(Math.min(logoDims.maxWidthPx, 220) * 0.65)}px;
  height: ${Math.round(Math.min(logoDims.maxHeightPx, 72) * 0.72)}px;
  background: transparent;
  border: 1px dashed var(--nx-doc-border);
  border-radius: 6px;
  margin: 0 0 8px 0;
  align-self: flex-end;
}
.nx-doc--unified .nx-doc__issuer-name {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
  line-height: 1.25;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__issuer-subtitle { font-size: 13px; color: var(--nx-doc-text-muted); margin-bottom: 6px; }
.nx-doc--unified .nx-doc__issuer-line,
.nx-doc--unified .nx-doc__customer-line {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 8px;
  align-items: start;
  padding: 3px 0;
  font-size: 13px;
  color: var(--nx-doc-text);
  line-height: 1.45;
}
.nx-doc--unified .nx-doc__issuer-line-icon,
.nx-doc--unified .nx-doc__customer-line-icon { display: inline-flex; margin-top: 1px; color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__issuer-line-value,
.nx-doc--unified .nx-doc__customer-line-value { text-align: end; }
.nx-doc--unified .nx-doc__customer-line--plain { grid-template-columns: 1fr; color: var(--nx-doc-text-muted); }
.nx-doc--unified .nx-doc__customer {
  width: 100%;
  margin: 0 0 24px;
  padding: 0 0 20px;
  border-bottom: 1px solid var(--nx-doc-border);
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
.nx-doc--unified .nx-doc__customer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
  color: var(--nx-doc-primary);
}
.nx-doc--unified .nx-doc__customer-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__customer-name {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0 0 24px;
  border: 1px solid var(--nx-doc-border);
  border-radius: 12px 12px 0 0;
  overflow: hidden;
}
.nx-doc--unified .nx-doc__table thead th {
  background: var(--nx-doc-header-gradient);
  color: #fff;
  padding: 12px 10px;
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  border-inline-end: 1px solid rgba(255,255,255,0.12);
}
.nx-doc--unified .nx-doc__table thead th:first-child { border-start-start-radius: 12px; }
.nx-doc--unified .nx-doc__table thead th:last-child { border-inline-end: none; border-start-end-radius: 12px; }
.nx-doc--unified .nx-doc__table tbody td {
  padding: 11px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--nx-doc-border);
  vertical-align: top;
  background: #fff;
}
.nx-doc--unified .nx-doc__cell-desc { font-weight: 600; color: var(--nx-doc-text); min-width: 140px; }
.nx-doc--unified .nx-doc__cell-qty { text-align: center; white-space: nowrap; }
.nx-doc--unified .nx-doc__cell-money { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.nx-doc--unified .nx-doc__cell-discount { color: var(--nx-doc-text) !important; }
.nx-doc--unified .nx-doc__cell-total { font-weight: 700; color: var(--nx-doc-text); }
.nx-doc--unified .nx-doc__bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: start;
  margin-bottom: 24px;
}
.nx-doc--unified .nx-doc__summary { grid-column: 2; }
.nx-doc--unified .nx-doc__comments { grid-column: 1; }
.nx-doc--unified .nx-doc__summary-head,
.nx-doc--unified .nx-doc__comments-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 10px;
  color: var(--nx-doc-primary);
}
.nx-doc--unified .nx-doc__summary-head > .nx-doc__icon,
.nx-doc--unified .nx-doc__comments-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__summary-body { padding: 0; background: transparent; border: none; box-shadow: none; }
.nx-doc--unified .nx-doc__comments {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  min-height: 0;
  box-shadow: none;
}
.nx-doc--unified .nx-doc__comments-body { white-space: pre-wrap; font-size: 13px; color: var(--nx-doc-text-muted); line-height: 1.55; }
.nx-doc--unified .nx-doc__total-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 0;
  font-size: 14px;
  border-bottom: 1px solid var(--nx-doc-border);
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__total-row--discount span:first-child,
.nx-doc--unified .nx-doc__total-row--discount span:last-child { color: var(--nx-doc-text) !important; font-weight: 500; }
.nx-doc--unified .nx-doc__grand-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--nx-doc-header-gradient);
  color: #fff;
  border: none;
}
.nx-doc--unified .nx-doc__grand-total strong {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  color: #fff;
}
.nx-doc--unified .nx-doc__payments { margin-bottom: 24px; }
.nx-doc--unified .nx-doc__payments-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--nx-doc-primary);
}
.nx-doc--unified .nx-doc__payments-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__payments-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-items: stretch;
}
.nx-doc--unified .nx-doc__payment-card {
  background: #fff;
  border: 1px solid var(--nx-doc-border);
  border-radius: 8px;
  padding: 14px 16px;
  min-height: 132px;
  height: 100%;
  box-shadow: none;
}
.nx-doc--unified .nx-doc__payment-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--nx-doc-text);
}
.nx-doc--unified .nx-doc__payment-card-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc--unified .nx-doc__payment-card-body { font-size: 12px; color: var(--nx-doc-text-muted); line-height: 1.55; }
.nx-doc--unified .nx-doc__payment-card-body--card { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.nx-doc--unified .nx-doc__payment-card-text { flex: 1; min-width: 0; word-break: break-word; }
.nx-doc--unified .nx-doc__payment-qr { display: block; width: 84px; height: 84px; flex-shrink: 0; object-fit: contain; }
.nx-doc--unified .nx-doc__platform-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 0 8px;
  border-top: 1px solid var(--nx-doc-border);
  margin-top: 8px;
}
.nx-doc--unified .nx-doc__platform-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--nx-doc-text-muted);
  font-size: 11px;
  text-decoration: none;
}
.nx-doc__icon { display: block; flex-shrink: 0; }
.nx-doc__header { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-bottom: 18px; }
.nx-doc__header-doc { grid-column: 1; text-align: start; }
.nx-doc__header-issuer { grid-column: 2; }
.nx-doc__issuer-identity { display: flex; flex-direction: column; align-items: flex-end; text-align: end; gap: 0; }
.nx-doc__doc-title { margin: 0 0 10px; font-size: 32px; font-weight: 700; color: var(--nx-doc-text); line-height: 1.15; }
.nx-doc__doc-badge {
  display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border-radius: 12px;
  background: var(--nx-doc-header-gradient); color: #fff; font-size: 17px; font-weight: 700; margin-bottom: 10px;
}
.nx-doc__meta-row { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px 10px; align-items: center; padding: 4px 0; color: var(--nx-doc-text-muted); font-size: 13px; }
.nx-doc__meta-row > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__meta-label { color: var(--nx-doc-text-muted); }
.nx-doc__meta-value { color: var(--nx-doc-text); font-weight: 600; justify-self: end; }
.nx-doc__logo-img { max-width: ${logoDims.maxWidthPx}px; max-height: ${logoDims.maxHeightPx}px; width: auto; height: auto; object-fit: contain; display: block; margin: 0 0 8px 0; align-self: flex-end; }
.nx-doc__logo-placeholder { width: ${Math.round(logoDims.maxWidthPx * 0.72)}px; height: ${Math.round(logoDims.maxHeightPx * 0.58)}px; background: transparent; border: 1px dashed var(--nx-doc-border); border-radius: 6px; margin: 0 0 8px 0; align-self: flex-end; }
.nx-doc__issuer-name { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
.nx-doc__issuer-subtitle { font-size: 13px; color: var(--nx-doc-text-muted); margin-bottom: 8px; }
.nx-doc__issuer-line { display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: start; padding: 3px 0; font-size: 13px; color: var(--nx-doc-text); }
.nx-doc__issuer-line-icon { display: inline-flex; margin-top: 1px; color: var(--nx-doc-icon); }
.nx-doc__issuer-line-value { text-align: end; line-height: 1.45; }
.nx-doc__customer { width: 100%; margin: 0 0 24px; padding: 0 0 20px; border-bottom: 1px solid var(--nx-doc-border); background: transparent; box-shadow: none; }
.nx-doc__customer-head { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 8px; color: var(--nx-doc-primary); }
.nx-doc__customer-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__customer-name { font-size: 22px; font-weight: 700; margin-bottom: 6px; color: var(--nx-doc-text); }
.nx-doc__customer-line { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; font-size: 13px; padding: 2px 0; color: var(--nx-doc-text); }
.nx-doc__customer-line--plain { grid-template-columns: 1fr; color: var(--nx-doc-text-muted); }
.nx-doc__customer-line-icon { display: inline-flex; margin-top: 1px; color: var(--nx-doc-icon); }
.nx-doc__customer-line-value { text-align: end; }
.nx-doc__table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0 0 24px; border-radius: 12px 12px 0 0; overflow: hidden; border: 1px solid var(--nx-doc-border); }
.nx-doc__table thead th { background: var(--nx-doc-header-gradient); color: #fff; padding: 12px 10px; font-size: 13px; font-weight: 700; text-align: right; border-inline-end: 1px solid rgba(255,255,255,0.12); }
.nx-doc__table thead th:last-child { border-inline-end: none; }
.nx-doc__table tbody td { padding: 11px 10px; font-size: 13px; border-bottom: 1px solid var(--nx-doc-border); vertical-align: top; background: #fff; }
.nx-doc__cell-desc { font-weight: 600; color: var(--nx-doc-text); }
.nx-doc__empty-lines { text-align: center; color: var(--nx-doc-text-muted); padding: 20px !important; }
.nx-doc__bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start; margin-bottom: 24px; }
.nx-doc__comments { grid-column: 1; background: transparent; border: none; padding: 0; min-height: 0; box-shadow: none; }
.nx-doc__comments-head { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 8px; color: var(--nx-doc-primary); }
.nx-doc__comments-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__comments-body { white-space: pre-wrap; font-size: 13px; color: var(--nx-doc-text-muted); line-height: 1.55; }
.nx-doc__summary { grid-column: 2; }
.nx-doc__summary-head { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 10px; color: var(--nx-doc-primary); }
.nx-doc__summary-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__total-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; font-size: 14px; border-bottom: 1px solid var(--nx-doc-border); color: var(--nx-doc-text); }
.nx-doc__total-row--discount span:first-child,
.nx-doc__total-row--discount span:last-child { color: var(--nx-doc-text) !important; font-weight: 500; }
.nx-doc__grand-total {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 12px; padding: 14px 16px;
  border-radius: 10px; background: var(--nx-doc-header-gradient); color: #fff; border: none;
}
.nx-doc__grand-total strong { font-size: 26px; font-weight: 800; line-height: 1.1; color: #fff; }
.nx-doc__payments { margin-bottom: 24px; }
.nx-doc__payments-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; margin-bottom: 12px; color: var(--nx-doc-primary); }
.nx-doc__payments-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__payments-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: stretch; }
.nx-doc__payment-card { background: #fff; border: 1px solid var(--nx-doc-border); border-radius: 8px; padding: 14px 16px; min-height: 132px; height: 100%; box-shadow: none; }
.nx-doc__payment-card-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; margin-bottom: 8px; color: var(--nx-doc-text); }
.nx-doc__payment-card-head > .nx-doc__icon { color: var(--nx-doc-icon); }
.nx-doc__payment-card-body { font-size: 12px; color: var(--nx-doc-text-muted); line-height: 1.55; }
.nx-doc__payment-card-body--card { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.nx-doc__payment-card-text { flex: 1; min-width: 0; word-break: break-word; }
.nx-doc__payment-qr { display: block; width: 84px; height: 84px; flex-shrink: 0; object-fit: contain; }
.nx-doc__signature { margin: 0 0 12px; text-align: end; }
.nx-doc__signature img { max-width: 180px; max-height: 72px; object-fit: contain; }
.nx-doc__platform-footer { display: flex; align-items: center; justify-content: center; padding: 16px 0 8px; border-top: 1px solid var(--nx-doc-border); margin-top: 8px; }
.nx-doc__platform-link { display: inline-flex; align-items: center; gap: 8px; color: var(--nx-doc-text-muted); font-size: 11px; text-decoration: none; }
.nx-doc__platform-link:hover { color: var(--nx-doc-primary); }
@media print {
  .nx-doc { max-width: none; padding: 0; }
  .nx-doc__payment-card, .nx-doc__comments, .nx-doc__customer { box-shadow: none; }
}
</style>
<div class="nx-doc nx-doc--unified" dir="rtl">
  <section class="nx-doc__header">
    <div class="nx-doc__header-doc">
      <h1 class="nx-doc__doc-title">${escapeHtml(params.docTypeLabel)}</h1>
      <div class="nx-doc__doc-badge" style="background:${palette.gradient_css}">${docPreviewIcon('id', '#ffffff')}<span>${escapeHtml(numberDisplay)}</span></div>
      <div class="nx-doc__meta-list">${metaRows}</div>
    </div>
    <div class="nx-doc__header-issuer">${issuerBlock}</div>
  </section>

  <section class="nx-doc__customer" aria-label="לכבוד">${customerBlock}</section>

  <table class="nx-doc__table">
    <thead>${tableHead}</thead>
    <tbody>${linesHtml}</tbody>
  </table>

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

export function renderStudioSamplePreviewHtml(
  branding: IncomeBrandingResolvedProfile,
  docTypeLabel = 'הצעת מחיר',
): string {
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
