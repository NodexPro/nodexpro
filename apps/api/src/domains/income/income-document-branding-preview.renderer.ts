import type { IncomeBrandingResolvedProfile } from './income-document-branding.types.js';
import {
  formatDocumentNumberDisplay,
  resolveBrandingPreviewThemePalette,
  resolveLogoSizeDimensions,
  STUDIO_SAMPLE_ISSUER,
  STUDIO_SAMPLE_RECIPIENT,
} from './income-document-branding.pure.js';
import { docPreviewIcon, nodexproFooterLogoMarkup } from './income-document-preview-icons.pure.js';
import { resolveSectionedDocumentIdentityPresentation } from './income-document-sectioned-identity.pure.js';
import {
  resolveSectionedBrandingLayout,
  SECTIONED_GOLDEN_MASTER as GM,
} from './income-document-sectioned-golden-master.pure.js';
import { getSectionedLogoFrameMeta } from './income-document-sectioned-logo-frame.pure.js';
import {
  logoCssFitPercent,
  prepareLogoDataUrlForDocumentRenderDetailed,
} from './income-document-logo-visible-fit.pure.js';
import type { IncomeDocumentType } from './income.types.js';

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
  /** Line VAT amount display for print (e.g. ₪180.00) — backend-prepared only. */
  vat_display: string;
  /** @deprecated retained for legacy readers — print uses vat_display */
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

const PARTY_LINE_ICON_PX = 16;
const PARTY_LINE_GAP_PX = 5;

function partyInfoRow(
  classPrefix: 'issuer' | 'customer',
  icon: string,
  value: string | null,
): string {
  if (!value?.trim()) return '';
  return `<div class="nx-doc__${classPrefix}-line"><span class="nx-doc__${classPrefix}-line-icon" aria-hidden="true">${icon}</span><span class="nx-doc__${classPrefix}-line-value">${escapeHtml(value)}</span></div>`;
}

function partyPlainRow(
  classPrefix: 'issuer' | 'customer',
  value: string | null,
): string {
  if (!value?.trim()) return '';
  return `<div class="nx-doc__${classPrefix}-line nx-doc__${classPrefix}-line--plain"><span class="nx-doc__${classPrefix}-line-icon nx-doc__${classPrefix}-line-icon--spacer" aria-hidden="true"></span><span class="nx-doc__${classPrefix}-line-value">${escapeHtml(value)}</span></div>`;
}

function issuerInfoRow(icon: string, value: string | null): string {
  return partyInfoRow('issuer', icon, value);
}

function metaRow(label: string, value: string, icon?: string): string {
  const iconHtml = icon ? `<span class="nx-doc__meta-icon">${icon}</span>` : '';
  return `<div class="nx-doc__meta-row">${iconHtml}<span class="nx-doc__meta-label">${escapeHtml(label)}</span><span class="nx-doc__meta-value">${escapeHtml(value)}</span></div>`;
}

function allocationDocumentMetaRow(
  label: string,
  value: string,
  icon: string,
  valueEmpty: boolean,
): string {
  const iconHtml = `<span class="nx-doc__meta-icon">${icon}</span>`;
  const valueClass = valueEmpty ? ' nx-doc__meta-value--empty' : '';
  return `<div class="nx-doc__meta-row nx-doc__meta-row--allocation">${iconHtml}<span class="nx-doc__meta-label">${escapeHtml(label)}</span><span class="nx-doc__meta-value${valueClass}">${escapeHtml(value)}</span></div>`;
}

function customerInfoRow(icon: string, value: string | null): string {
  return partyInfoRow('customer', icon, value);
}

function formatLineCurrency(currency: string): string {
  const c = currency?.trim() || 'ILS';
  return c;
}

function buildPaymentCards(params: {
  branding: IncomeBrandingResolvedProfile;
  showBankDetails: boolean;
  accent: string;
  payment_link_url?: string | null;
  payment_qr_data_url?: string | null;
  /** Golden-master: always keep 3 payment blocks. */
  preserve_three_cards?: boolean;
}): string {
  const b = params.branding;
  const enabled = b.payment_methods.filter((m) => m.enabled);
  const preserve = params.preserve_three_cards === true;
  if (!preserve && !enabled.length && !params.showBankDetails) return '';

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

  if (preserve || bankEnabled || bankLines.length) {
    cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--bank">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('bank')}<strong>העברה בנקאית</strong></header>
      <div class="nx-doc__payment-col-body">${bankLines.length ? bankLines.join('<br/>') : '—'}</div>
    </div>`);
  }

  if (preserve || (cardEnabled && params.payment_link_url?.trim())) {
    const cardMethod = enabled.find((m) => m.key === 'credit_card');
    const linkRaw = params.payment_link_url?.trim() || '';
    const link = linkRaw ? escapeHtml(linkRaw) : '';
    const qrBlock = params.payment_qr_data_url?.trim()
      ? `<img class="nx-doc__payment-qr" src="${escapeHtml(params.payment_qr_data_url.trim())}" alt="" />`
      : '';
    cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--card">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('card')}<strong>${escapeHtml(cardMethod?.label ?? 'כרטיס אשראי')}</strong></header>
      <div class="nx-doc__payment-col-body nx-doc__payment-col-body--card">
        ${qrBlock}
        <div class="nx-doc__payment-col-text">${
          link
            ? `<div><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div>`
            : '<div>—</div>'
        }</div>
      </div>
    </div>`);
  }

  if (preserve || otherMethods.length) {
    cards.push(`<div class="nx-doc__payment-col nx-doc__payment-col--other">
      <header class="nx-doc__payment-col-head">${docPreviewIcon('payment')}<strong>אמצעי תשלום נוספים</strong></header>
      <div class="nx-doc__payment-col-body">${
        otherMethods.length ? otherMethods.map((m) => `<div>${escapeHtml(m.label)}</div>`).join('') : '—'
      }</div>
    </div>`);
  }

  if (!cards.length) return '';
  return `<section class="nx-doc__payments" aria-label="אמצעי תשלום">
    <header class="nx-doc__payments-head">${docPreviewIcon('card')}<span>אמצעי תשלום</span></header>
    <div class="nx-doc__payments-grid">${cards.join('')}</div>
  </section>`;
}

function buildSheetSection(sectionNumber: number, bodyHtml: string): string {
  return `<section class="nx-doc__sheet-section nx-doc__sheet-section--${sectionNumber}" data-sheet-section="${sectionNumber}" aria-label="אזור ${sectionNumber}"><span class="nx-doc__sheet-section-badge" aria-hidden="true">${sectionNumber}</span><span class="nx-doc__sheet-section-label">אזור ${sectionNumber}</span><div class="nx-doc__sheet-section-body">${bodyHtml}</div></section>`;
}

export function renderIncomeBrandedPreviewHtml(params: {
  branding: IncomeBrandingResolvedProfile;
  docTypeLabel: string;
  numberPreview: string | null;
  document_type?: IncomeDocumentType | null;
  issuer: IncomeBrandingPreviewParty;
  recipient: IncomeBrandingPreviewParty;
  document_date: string | null;
  due_date: string | null;
  payment_terms_display?: string | null;
  allocation_number_display?: string | null;
  allocation_number_visible?: boolean;
  allocation_number_value_empty?: boolean;
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
  const isSectioned = b.document_style_key === 'sectioned';
  const palette = resolveBrandingPreviewThemePalette(b.color_theme);
  const accent = palette.totals_accent_color;
  const numberDisplay = formatDocumentNumberDisplay(params.numberPreview);
  const logoDims = resolveLogoSizeDimensions(b.logo_size_key);
  const sectionedLayout = resolveSectionedBrandingLayout(b.logo_size_key);
  const logoFrame = getSectionedLogoFrameMeta();
  const logoFitPercent = logoCssFitPercent();
  /* Sync processor — return value is the only img src (never overwritten). */
  const logoPrep = prepareLogoDataUrlForDocumentRenderDetailed(b.logo_data_url);
  const logoDataUrl = logoPrep.data_url;
  const logoProcessingAttr = logoPrep.final_src_is_cropped
    ? 'cropped'
    : logoPrep.source_kind === 'jpeg' || logoPrep.source_kind === 'webp'
      ? 'passthrough'
      : 'original';
  const discountDisplay = formatDiscountDisplay(params.totals.discount);
  const rootClass = isSectioned ? 'nx-doc nx-doc--unified nx-doc--sectioned' : 'nx-doc nx-doc--unified';
  const documentIdentity = resolveSectionedDocumentIdentityPresentation({
    doc_type_label: params.docTypeLabel,
    document_number: params.numberPreview,
    document_type: params.document_type,
  });
  const numberBlock = isSectioned
    ? `<div class="nx-doc__doc-number"><span class="nx-doc__doc-number-bar"><span class="nx-doc__doc-number-text">${escapeHtml(documentIdentity.document_number)}</span>${docPreviewIcon('document')}</span></div>`
    : `<div class="nx-doc__doc-number">${escapeHtml(numberDisplay)}</div>
      <div class="nx-doc__doc-number-rule" aria-hidden="true"></div>`;

  const logoInner =
    d.show_logo && logoDataUrl
      ? `<img class="nx-doc__logo-img" src="${logoDataUrl}" alt="" data-logo-processing="${logoProcessingAttr}" />`
      : !isSectioned && d.show_logo
        ? `<div class="nx-doc__logo-placeholder" aria-hidden="true"></div>`
        : '';
  const logoHtml = isSectioned
    ? `<div class="nx-doc__logo-frame${logoInner ? '' : ' nx-doc__logo-frame--empty'}">${logoInner}</div>`
    : logoInner
      ? `<div class="nx-doc__logo-frame">${logoInner}</div>`
      : '';

  const subtitle =
    params.company_subtitle?.trim() || b.company_subtitle?.trim()
      ? `<div class="nx-doc__issuer-subtitle">${escapeHtml(params.company_subtitle ?? b.company_subtitle)}</div>`
      : '';

  const issuerContactLines = isSectioned
    ? [
        issuerInfoRow(docPreviewIcon('location'), d.show_business_address ? params.issuer.address : null),
        issuerInfoRow(docPreviewIcon('id'), d.show_business_tax_id ? params.issuer.tax_id : null),
        issuerInfoRow(docPreviewIcon('phone'), d.show_business_phone ? params.issuer.phone : null),
        issuerInfoRow(docPreviewIcon('mail'), d.show_business_email ? params.issuer.email : null),
        issuerInfoRow(docPreviewIcon('website'), params.issuer.website?.trim() ? params.issuer.website : null),
      ]
        .filter(Boolean)
        .join('')
    : [
        issuerInfoRow(docPreviewIcon('id'), d.show_business_tax_id ? params.issuer.tax_id : null),
        issuerInfoRow(docPreviewIcon('location'), d.show_business_address ? params.issuer.address : null),
        issuerInfoRow(docPreviewIcon('phone'), d.show_business_phone ? params.issuer.phone : null),
        issuerInfoRow(docPreviewIcon('mail'), d.show_business_email ? params.issuer.email : null),
        issuerInfoRow(docPreviewIcon('website'), params.issuer.website?.trim() ? params.issuer.website : null),
      ]
        .filter(Boolean)
        .join('');

  const customerContactLabel = params.recipient.contact_name?.trim()
    ? `איש קשר: ${params.recipient.contact_name.trim()}`
    : null;
  const customerLines = [
    partyPlainRow('customer', customerContactLabel),
    customerInfoRow(docPreviewIcon('location'), params.recipient.address),
    customerInfoRow(docPreviewIcon('id'), params.recipient.tax_id),
    customerInfoRow(docPreviewIcon('mail'), params.recipient.email),
    customerInfoRow(docPreviewIcon('phone'), params.recipient.phone),
    customerInfoRow(docPreviewIcon('website'), params.recipient.website ?? null),
  ]
    .filter(Boolean)
    .join('');

  const metaRows = [
    metaRow('תאריך המסמך', formatPreviewDate(params.document_date), docPreviewIcon('calendar')),
    params.due_date
      ? metaRow(
          'תאריך לתשלום',
          formatPreviewDate(params.due_date),
          docPreviewIcon(isSectioned ? 'calendar' : 'clock'),
        )
      : '',
    params.payment_terms_display?.trim()
      ? metaRow('תנאי תשלום', params.payment_terms_display, docPreviewIcon(isSectioned ? 'clock' : 'payment'))
      : '',
    params.allocation_number_visible
      ? allocationDocumentMetaRow(
          'מספר הקצאה',
          params.allocation_number_display != null
            ? String(params.allocation_number_display)
            : '',
          docPreviewIcon('id'),
          params.allocation_number_value_empty === true,
        )
      : '',
  ]
    .filter(Boolean)
    .join('');

  const issuerIdentityBlock = `<div class="nx-doc__issuer-identity">${logoHtml}</div>`;

  const issuerNameBlock = `<div class="nx-doc__issuer-details">
      <div class="nx-doc__issuer-name">${escapeHtml(params.issuer.display_name)}</div>
      ${subtitle}
    </div>`;

  const issuerContactsBlock = `${issuerNameBlock}${
    issuerContactLines ? `<div class="nx-doc__issuer-lines">${issuerContactLines}</div>` : ''
  }`;

  const docTitleBlock = isSectioned
    ? `<div class="nx-doc__doc-identity" data-title-width-key="${escapeHtml(documentIdentity.title_width_key)}" style="--nx-doc-identity-stack-width:${escapeHtml(documentIdentity.number_bar_width)}">
      <h1 class="nx-doc__doc-title">${escapeHtml(documentIdentity.title)}</h1>
      ${numberBlock}
    </div>`
    : `<h1 class="nx-doc__doc-title">${escapeHtml(params.docTypeLabel)}</h1>${numberBlock}`;

  const docMetaBlock = metaRows ? `<div class="nx-doc__meta-list">${metaRows}</div>` : '';

  const customerHeadBlock = `<header class="nx-doc__customer-head">${isSectioned ? docPreviewIcon('user') : ''}<span>לכבוד</span></header><div class="nx-doc__customer-name">${escapeHtml(params.recipient.display_name)}</div>`;

  const customerLinesBlock = customerLines ? `<div class="nx-doc__customer-lines">${customerLines}</div>` : '';

  const upperSheetBlock = isSectioned
    ? `<div class="nx-doc__upper" aria-label="כותרת מסמך">
    <div class="nx-doc__doc-column">
      ${docTitleBlock}
      ${docMetaBlock}
      <section class="nx-doc__customer-card" aria-label="פרטי לקוח">
        ${customerHeadBlock}
        ${customerLinesBlock}
      </section>
    </div>
    <aside class="nx-doc__branding">
      ${logoHtml}
      ${issuerNameBlock}
      ${issuerContactLines ? `<div class="nx-doc__issuer-lines">${issuerContactLines}</div>` : ''}
    </aside>
  </div>`
    : `<div class="nx-doc__upper-sheet" aria-label="כותרת מסמך">
    ${buildSheetSection(1, issuerIdentityBlock)}
    ${buildSheetSection(2, issuerContactsBlock)}
    ${buildSheetSection(3, docTitleBlock)}
    ${buildSheetSection(4, docMetaBlock)}
    ${buildSheetSection(5, customerHeadBlock)}
    ${buildSheetSection(6, customerLinesBlock)}
  </div>`;

  function formatLineDescriptionCell(description: string): string {
    const parts = String(description || '—')
      .split(/\r?\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return escapeHtml('—');
    const [title, ...rest] = parts;
    const sub = rest.join(' ');
    if (!sub) return `<span class="nx-doc__desc-title">${escapeHtml(title)}</span>`;
    return `<span class="nx-doc__desc-title">${escapeHtml(title)}</span><span class="nx-doc__desc-sub">${escapeHtml(sub)}</span>`;
  }

  const colCount = isSectioned ? (d.show_vat_row ? 8 : 7) : d.show_vat_row ? 7 : 6;
  const linesHtml =
    params.lineRows.length > 0
      ? params.lineRows
          .map((r) => {
            if (isSectioned) {
              const vatCell = d.show_vat_row
                ? `<td class="nx-doc__cell-vat">${escapeHtml(r.vat_rate_label || r.vat_display || '—')}</td>`
                : '';
              return `<tr>
            <td class="nx-doc__cell-num">${escapeHtml(String(r.row_number))}</td>
            <td class="nx-doc__cell-desc">${formatLineDescriptionCell(r.description || '—')}</td>
            <td class="nx-doc__cell-qty">${escapeHtml(r.quantity)}</td>
            <td class="nx-doc__cell-unit">${escapeHtml(r.unit?.trim() || '—')}</td>
            <td class="nx-doc__cell-money">${escapeHtml(r.unit_price)}</td>
            <td class="nx-doc__cell-discount">${escapeHtml(r.discount?.trim() || '—')}</td>
            ${vatCell}
            <td class="nx-doc__cell-money nx-doc__cell-total">${escapeHtml(r.total)}</td>
          </tr>`;
            }
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

  const tableColgroup = isSectioned
    ? d.show_vat_row
      ? `<colgroup>
      <col class="nx-doc__col-num" />
      <col class="nx-doc__col-desc" />
      <col class="nx-doc__col-qty" />
      <col class="nx-doc__col-unit" />
      <col class="nx-doc__col-price" />
      <col class="nx-doc__col-discount" />
      <col class="nx-doc__col-vat" />
      <col class="nx-doc__col-total" />
    </colgroup>`
      : `<colgroup>
      <col class="nx-doc__col-num" />
      <col class="nx-doc__col-desc" />
      <col class="nx-doc__col-qty" />
      <col class="nx-doc__col-unit" />
      <col class="nx-doc__col-price" />
      <col class="nx-doc__col-discount" />
      <col class="nx-doc__col-total" />
    </colgroup>`
    : d.show_vat_row
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

  const tableHead = isSectioned
    ? `<tr>
      <th class="nx-doc__th-num">#</th>
      <th>תיאור</th>
      <th>כמות</th>
      <th>יחידת מידה</th>
      <th>מחיר יחידה</th>
      <th>הנחה</th>
      ${d.show_vat_row ? '<th>מע״מ</th>' : ''}
      <th>סכום</th>
    </tr>`
    : `<tr>
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

  const notesHtml =
    d.show_notes && params.notes?.trim()
      ? `<section class="nx-doc__comments" aria-label="הערות">
      <header class="nx-doc__comments-head">${isSectioned ? docPreviewIcon('comment') : ''}<span>הערות</span></header>
      <div class="nx-doc__comments-body">${escapeHtml(params.notes)}</div>
    </section>`
      : isSectioned
        ? `<section class="nx-doc__comments nx-doc__comments--empty" aria-label="הערות">
      <header class="nx-doc__comments-head">${docPreviewIcon('comment')}<span>הערות</span></header>
      <div class="nx-doc__comments-body"></div>
    </section>`
        : '';

  const signatureHtml =
    d.show_signature && b.signature_data_url
      ? `<div class="nx-doc__signature" aria-label="חתימה"><img src="${b.signature_data_url}" alt="" /></div>`
      : '';

  const totalsHtml = `
    <section class="nx-doc__summary" aria-label="סיכום כספי">
      ${isSectioned ? '' : '<header class="nx-doc__summary-head"><span>סיכום כספי</span></header>'}
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
    preserve_three_cards: isSectioned,
  });

  const sectionedLegalText =
    d.show_footer && b.footer_text?.trim()
      ? b.footer_text.trim()
      : 'מסמך זה הופק באופן אוטומטי על ידי המערכת. תודה שבחרתם בנו.';
  const platformFooter = isSectioned
    ? `<footer class="nx-doc__platform-footer">
    <div class="nx-doc__platform-legal">${docPreviewIcon('shield')}<span>${escapeHtml(sectionedLegalText)}</span></div>
    <a class="nx-doc__platform-link" href="${NODEXPRO_FOOTER_URL}" target="_blank" rel="noopener noreferrer">
      ${nodexproFooterLogoMarkup()}
      <span>NodexPro</span>
    </a>
  </footer>`
    : `<footer class="nx-doc__platform-footer">
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
  --nx-doc-logo-frame-width: ${logoFrame.css_frame_width};
  --nx-doc-logo-frame-height: ${logoFrame.css_frame_height};
  --nx-doc-logo-fit: ${logoFitPercent};
  max-width: 840px;
  margin: 0 auto;
  padding: 0;
  padding-inline: 19px;
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
  grid-template-rows: repeat(2, minmax(130px, 1fr));
  gap: 0;
  width: 100%;
  margin: 0 0 8px;
  border: 2px solid #64748b;
  background: #fff;
}
.nx-doc--unified .nx-doc__sheet-section {
  position: relative;
  min-height: 130px;
  padding: 30px 10px 8px;
  border: 2px solid #94a3b8;
  box-sizing: border-box;
  background: #fff;
}
.nx-doc--unified .nx-doc__sheet-section:nth-child(odd) {
  background: #f8fafc;
}
.nx-doc--unified .nx-doc__sheet-section-body {
  height: 100%;
}
.nx-doc--unified .nx-doc__sheet-section-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #4f46e5;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
  box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(15, 23, 42, 0.28);
}
.nx-doc--unified .nx-doc__sheet-section-label {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #64748b;
  text-transform: uppercase;
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
.nx-doc--unified .nx-doc__sheet-section--1 .nx-doc__sheet-section-body {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nx-doc--unified .nx-doc__issuer-identity {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  text-align: center;
  gap: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
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
.nx-doc--unified .nx-doc__sheet-section--1 .nx-doc__logo-img {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  margin: 0;
  align-self: stretch;
}
.nx-doc--unified .nx-doc__sheet-section--1 .nx-doc__logo-placeholder {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  background: transparent;
  border: 1px dashed var(--nx-doc-border);
  border-radius: 2px;
  margin: 0;
  align-self: stretch;
  box-sizing: border-box;
}
.nx-doc--unified .nx-doc__logo-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  min-height: 0;
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
/* Classic / non-sectioned only — never cap sectioned GM logo (was max-height:40px). */
.nx-doc--unified:not(.nx-doc--sectioned) .nx-doc__logo-img {
  max-width: ${Math.min(logoDims.maxWidthPx, 160)}px;
  max-height: ${Math.min(logoDims.maxHeightPx, 40)}px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: 0 0 4px 0;
  align-self: flex-end;
}
.nx-doc--unified:not(.nx-doc--sectioned) .nx-doc__logo-placeholder {
  width: ${Math.round(Math.min(logoDims.maxWidthPx, 160) * 0.72)}px;
  height: ${Math.round(Math.min(logoDims.maxHeightPx, 40) * 0.58)}px;
  background: transparent;
  border: 1px dashed var(--nx-doc-border);
  border-radius: 4px;
  margin: 0 0 4px 0;
  align-self: flex-end;
}
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

/* Sectioned — pixel contract from Jul 11 golden master (+ studio logo size scale). */
.nx-doc--sectioned {
  --nx-doc-primary: ${GM.colors.primary};
  --nx-doc-text: ${GM.colors.text};
  --nx-doc-text-muted: ${GM.colors.muted};
  --nx-doc-panel: ${GM.colors.panel};
  --nx-doc-radius: ${GM.upper.customer_card_radius_px}px;
  --nx-doc-logo-w: ${sectionedLayout.logo_block_width_px}px;
  --nx-doc-logo-h: ${sectionedLayout.logo_block_height_px}px;
  --nx-doc-branding-col: ${sectionedLayout.branding_col_width_px}px;
  --nx-doc-doc-col: ${sectionedLayout.doc_col_width_px}px;
  --nx-doc-logo-scale: ${sectionedLayout.scale};
  /*
   * Fill the preview paper edge-to-edge. Equal 0.5cm side insets.
   * Do not cap below the paper width — a narrower max-width leaves an RTL gutter
   * by the scrollbar (logo side).
   */
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding-block: 0;
  padding-inline: ${GM.page.margin_left_px}px;
  box-sizing: border-box;
  color: var(--nx-doc-text);
  font-size: 14px;
  line-height: 1.35;
  background: ${GM.colors.white};
}
.nx-doc--sectioned .nx-doc__upper {
  display: grid;
  /*
   * DOM: doc-column | branding. Fill full width (no leftover gutter by the scrollbar).
   * Branding is 20% narrower than doc → 1fr : 0.8fr.
   */
  grid-template-columns: 1fr 0.8fr;
  gap: 0;
  align-items: start;
  width: 100%;
  margin: 0 0 ${GM.upper.upper_to_table_gap_px}px;
  border: none;
  background: transparent;
  overflow: visible;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
}
.nx-doc--sectioned .nx-doc__branding {
  width: 100%;
  min-width: 0;
  padding: 0;
  padding-inline-start: 8px;
  border-inline-start: 1px solid ${GM.colors.divider};
  box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  overflow: visible;
  text-align: left;
}
.nx-doc--sectioned .nx-doc__doc-column {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  /* dir=rtl: flex-start = outer RIGHT edge. */
  align-items: flex-start;
  padding: 0;
  padding-inline-end: 8px;
  box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  text-align: start;
}
/*
 * Exact 319×120 paint box (× size). Small files stretch up — no empty margin in the box.
 * Pin to the physical left (scrollbar side); do not use inline-end:auto (RTL pushes to center).
 */
.nx-doc--sectioned .nx-doc__logo-frame {
  width: var(--nx-doc-logo-w);
  height: var(--nx-doc-logo-h);
  max-width: 100%;
  /* Lift logo 1cm to align with document title top. */
  margin: -38px 0 ${GM.upper.logo_to_company_gap_px}px 0;
  overflow: hidden;
  display: block;
  background: transparent;
  border: none;
  flex-shrink: 0;
  line-height: 0;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__logo-frame--empty {
  background: transparent;
  height: 0;
  max-height: 0;
  margin: 0;
  overflow: hidden;
}
.nx-doc--sectioned .nx-doc__logo-img {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  object-fit: fill;
  object-position: left top;
  display: block;
  transform: none;
}
.nx-doc--sectioned .nx-doc__issuer-name {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 ${GM.upper.meta_row_gap_px}px;
  line-height: 1.35;
  color: ${GM.colors.text};
  text-align: start;
  width: 100%;
}
.nx-doc--sectioned .nx-doc__issuer-subtitle {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--nx-doc-text-muted);
  margin: 0 0 ${GM.upper.meta_row_gap_px}px;
  text-align: start;
}
.nx-doc--sectioned .nx-doc__issuer-details {
  width: 100%;
  text-align: start;
}
.nx-doc--sectioned .nx-doc__issuer-lines {
  display: flex;
  flex-direction: column;
  gap: ${GM.upper.meta_row_gap_px}px;
  margin: 1px 0 0;
  width: 100%;
  text-align: start;
}
.nx-doc--sectioned .nx-doc__issuer-line {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: ${GM.colors.text};
  padding: 0 0 4px;
  border-bottom: 1px solid #e8e8f2;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__issuer-line-value {
  font-weight: 700;
  color: ${GM.colors.text};
  text-align: start;
  min-width: 0;
  word-break: break-word;
}
.nx-doc--sectioned .nx-doc__issuer-line-icon {
  color: var(--nx-doc-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.nx-doc--sectioned .nx-doc__customer-line {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__customer-line-icon {
  color: var(--nx-doc-primary);
}
.nx-doc--sectioned .nx-doc__doc-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${GM.upper.title_to_number_gap_px}px;
  /* Stack width = title ink; number bar stretches to the same length. */
  width: max-content;
  max-width: 100%;
  /* Pin title + number bar to the outer edge (inline-start = right in RTL). */
  margin: 0 0 12px;
  margin-inline-end: auto;
  margin-inline-start: 0;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__doc-title {
  font-family: ${INVOICE_FONT};
  font-size: ${GM.upper.title_font_size_px}px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: ${GM.upper.title_line_height};
  color: ${GM.colors.text};
  text-align: start;
  width: max-content;
  max-width: 100%;
  white-space: nowrap;
}
.nx-doc--sectioned .nx-doc__doc-number {
  width: 100%;
  max-width: 100%;
  margin: 0;
}
.nx-doc--sectioned .nx-doc__doc-number-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: ${GM.upper.number_bar_height_px}px;
  min-height: ${GM.upper.number_bar_height_px}px;
  padding: 0 14px;
  border-radius: ${GM.upper.number_bar_radius_px}px;
  background: var(--nx-doc-primary);
  color: #ffffff;
  font-family: ${INVOICE_FONT};
  font-weight: 800;
  font-size: ${GM.upper.number_bar_font_size_px}px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  text-align: center;
  unicode-bidi: isolate;
  direction: ltr;
  box-shadow: none;
}
.nx-doc--sectioned .nx-doc__doc-number-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
}
.nx-doc--sectioned .nx-doc__doc-number-bar .nx-doc__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: #ffffff;
  stroke: #ffffff;
}
.nx-doc--sectioned .nx-doc__doc-number-rule { display: none; }
.nx-doc--sectioned .nx-doc__meta-list {
  display: flex;
  flex-direction: column;
  gap: ${GM.upper.meta_row_gap_px}px;
  width: 100%;
  /*
   * Drop invoice meta to align with issuer contact rows (under the issuer name),
   * not with the issuer display name. Vertical only.
   */
  margin: 26px 0 ${GM.upper.customer_top_gap_px}px;
  text-align: start;
}
.nx-doc--sectioned .nx-doc__meta-row {
  display: grid;
  grid-template-columns: 16px auto minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: var(--nx-doc-text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid #e8e8f2;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__meta-label {
  font-weight: 500;
  color: var(--nx-doc-text-muted);
}
.nx-doc--sectioned .nx-doc__meta-value {
  font-weight: 700;
  color: ${GM.colors.text};
  justify-self: start;
}
.nx-doc--sectioned .nx-doc__customer-card {
  width: ${sectionedLayout.customer_card_width_px}px;
  max-width: 100%;
  min-height: 0;
  height: auto;
  margin: 0;
  padding: ${GM.upper.customer_card_padding_px}px;
  border-radius: ${GM.upper.customer_card_radius_px}px;
  background: var(--nx-doc-panel);
  border: 1px solid #ececf6;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__customer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--nx-doc-primary);
}
.nx-doc--sectioned .nx-doc__customer-head .nx-doc__icon { color: var(--nx-doc-primary); }
.nx-doc--sectioned .nx-doc__customer-name {
  margin: 0 0 8px;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.25;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__customer-lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}
.nx-doc--sectioned .nx-doc__lines {
  width: 100%;
  margin: 0 0 ${GM.lower.notes_totals_gap_px}px;
  padding: 0;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__table {
  width: 100%;
  max-width: none;
  border: none;
  margin: 0;
  border-radius: ${GM.table.radius_px}px;
  overflow: hidden;
  border-collapse: separate;
  border-spacing: 0;
  box-shadow: none;
}
.nx-doc--sectioned .nx-doc__table thead th {
  background: var(--nx-doc-primary);
  color: #ffffff;
  height: ${GM.table.header_height_px}px;
  padding: 0 8px;
  font-size: ${GM.table.header_font_size_px}px;
  font-weight: 700;
  border: none;
  white-space: nowrap;
  text-align: center;
  vertical-align: middle;
}
.nx-doc--sectioned .nx-doc__table thead th:nth-child(2) { text-align: start; }
.nx-doc--sectioned .nx-doc__table tbody td {
  height: ${GM.table.row_height_px}px;
  padding: 0 8px;
  font-size: ${GM.table.cell_font_size_px}px;
  border: none;
  border-bottom: 1px solid ${GM.colors.row_border};
  background: #ffffff;
  vertical-align: middle;
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
}
.nx-doc--sectioned .nx-doc__table tbody td.nx-doc__cell-desc {
  text-align: start;
  white-space: normal;
  font-weight: 600;
}
.nx-doc--sectioned .nx-doc__table tbody tr:nth-child(even) td { background: #ffffff; }
.nx-doc--sectioned .nx-doc__table tbody tr:last-child td { border-bottom: none; }
.nx-doc--sectioned .nx-doc__desc-title {
  display: block;
  font-weight: 700;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__desc-sub {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--nx-doc-text-muted);
}
.nx-doc--sectioned .nx-doc__col-num { width: 36px; }
.nx-doc--sectioned .nx-doc__col-qty { width: 56px; }
.nx-doc--sectioned .nx-doc__col-unit { width: 72px; }
.nx-doc--sectioned .nx-doc__col-price { width: 88px; }
.nx-doc--sectioned .nx-doc__col-discount { width: 64px; }
.nx-doc--sectioned .nx-doc__col-vat { width: 56px; }
.nx-doc--sectioned .nx-doc__col-total { width: 88px; }
.nx-doc--sectioned .nx-doc__bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${GM.lower.notes_totals_gap_px}px;
  margin-bottom: ${GM.lower.payment_section_gap_px}px;
  align-items: stretch;
}
.nx-doc--sectioned .nx-doc__comments {
  padding: 16px;
  border: 1px solid #ececf6;
  border-radius: ${GM.lower.notes_totals_radius_px}px;
  background: var(--nx-doc-panel);
  min-height: ${GM.lower.notes_totals_height_px}px;
  height: ${GM.lower.notes_totals_height_px}px;
  box-shadow: none;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__comments-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--nx-doc-primary);
}
.nx-doc--sectioned .nx-doc__comments-head .nx-doc__icon { color: var(--nx-doc-primary); }
.nx-doc--sectioned .nx-doc__comments-body {
  font-size: ${GM.upper.company_line_font_size_px}px;
  line-height: 1.55;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__summary-head { display: none; }
.nx-doc--sectioned .nx-doc__summary,
.nx-doc--sectioned .nx-doc__summary-body {
  min-height: ${GM.lower.notes_totals_height_px}px;
  height: ${GM.lower.notes_totals_height_px}px;
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__summary-body {
  padding: 16px;
  border: 1px solid #ececf6;
  border-radius: ${GM.lower.notes_totals_radius_px}px;
  background: var(--nx-doc-panel);
  max-width: 100%;
  box-shadow: none;
}
.nx-doc--sectioned .nx-doc__total-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: ${GM.upper.company_line_font_size_px}px;
  border-bottom: 1px solid ${GM.colors.row_border};
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__grand-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #e0e0ee;
}
.nx-doc--sectioned .nx-doc__grand-total span {
  font-size: 13px;
  font-weight: 700;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__grand-total strong {
  font-size: ${GM.lower.grand_total_font_size_px}px;
  font-weight: 800;
  color: var(--nx-doc-primary);
}
.nx-doc--sectioned .nx-doc__payments { margin-bottom: 12px; }
.nx-doc--sectioned .nx-doc__payments-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__payments-head .nx-doc__icon { color: var(--nx-doc-primary); }
.nx-doc--sectioned .nx-doc__payments-grid {
  display: grid;
  gap: ${GM.lower.payment_card_gap_px}px;
  border: none;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.nx-doc--sectioned .nx-doc__payment-col {
  border: 1px solid #ececf6;
  border-radius: ${GM.lower.payment_card_radius_px}px;
  padding: 14px;
  background: #ffffff;
  border-inline-end: 1px solid #ececf6;
  height: ${GM.lower.payment_card_height_px}px;
  min-height: ${GM.lower.payment_card_height_px}px;
  box-shadow: none;
  box-sizing: border-box;
  overflow: hidden;
}
.nx-doc--sectioned .nx-doc__payment-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: ${GM.upper.company_line_font_size_px}px;
  margin-bottom: 8px;
  color: ${GM.colors.text};
}
.nx-doc--sectioned .nx-doc__payment-col-head > .nx-doc__icon {
  display: inline-flex;
  color: var(--nx-doc-primary);
  opacity: 1;
}
.nx-doc--sectioned .nx-doc__payment-col-body {
  font-size: 11px;
  line-height: 1.45;
  color: var(--nx-doc-text-muted);
}
.nx-doc--sectioned .nx-doc__platform-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: ${GM.lower.footer_height_px}px;
  min-height: ${GM.lower.footer_height_px}px;
  margin-top: 0;
  padding-top: 0;
  border-top: 1px solid ${GM.colors.row_border};
  box-sizing: border-box;
}
.nx-doc--sectioned .nx-doc__platform-legal {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: ${GM.lower.footer_font_size_px}px;
  color: var(--nx-doc-text-muted);
  max-width: 70%;
}
.nx-doc--sectioned .nx-doc__platform-legal .nx-doc__icon {
  color: var(--nx-doc-primary);
  flex-shrink: 0;
}
.nx-doc--sectioned .nx-doc__platform-link {
  gap: 8px;
  font-size: ${GM.lower.footer_font_size_px}px;
  color: #94a3b8;
}
@media print {
  .nx-doc--sectioned {
    width: 100%;
    max-width: none;
    padding: 0;
  }
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

export function renderStudioSamplePreviewHtml(
  branding: IncomeBrandingResolvedProfile,
  docTypeLabel = 'הצעת מחיר',
): string {
  return renderIncomeBrandedPreviewHtml({
    branding,
    docTypeLabel,
    document_type: 'quote',
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
