import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import {
  buildUnifiedIncomeDocumentRenderInput,
  lineRowsFromLinesSnapshot,
  totalsFromTotalsSnapshot,
} from '../../src/domains/income/income-document-unified-render.pure.js';
import {
  buildUnifiedIncomeDocumentPrintHtml,
  renderUnifiedIncomeDocumentHtml,
} from '../../src/domains/income/income-document-unified-render.html.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pdfRendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.renderer.ts'),
  'utf8',
);
const pdfServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
  'utf8',
);
const detailsBuilderSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);

function sampleBrandingRow(): IncomeBrandingProfileRow {
  return {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'classic',
    color_theme_key: 'nodexpro_premium',
    primary_color: '#5B4DFF',
    secondary_color: '#FFFFFF',
    table_header_color: '#5B4DFF',
    totals_color: '#5B4DFF',
    client_block_position: 'right',
    footer_text: null,
    bank_name: 'בנק לדוגמה',
    bank_branch: '100',
    bank_account: '123456',
    swift: null,
    iban: null,
    email_subject_template: null,
    email_body_template: null,
    customer_notes: null,
    terms_and_conditions: null,
    display_options: {
      show_logo: true,
      show_signature: false,
      show_footer: true,
      show_notes: true,
      show_payment_terms: true,
      show_bank_details: true,
      show_due_date: true,
      show_vat_row: true,
      show_discount_row: true,
      show_business_tax_id: true,
      show_business_address: true,
      show_business_phone: true,
      show_business_email: true,
      client_block_position: 'right',
    },
    payment_methods: [
      { key: 'bank_transfer', label: 'העברה בנקאית', enabled: true },
      { key: 'credit_card', label: 'כרטיס אשראי', enabled: true },
      { key: 'bit', label: 'Bit', enabled: true },
    ],
    document_attachments: [],
    default_payment_terms: null,
  };
}

function buildSampleUnifiedInput() {
  const branding = resolveBrandingProfile(sampleBrandingRow(), { logo_data_url: null, signature_data_url: null });
  return buildUnifiedIncomeDocumentRenderInput({
    branding,
    document_type: 'tax_invoice',
    language: 'he',
    document_number: '2026-000154',
    document_date: '2026-07-11',
    due_date: '2026-08-10',
    currency: 'ILS',
    notes: 'תודה על העסקתכם',
    payment_terms_display: 'שוטף + 30',
    allocation_number_visible: true,
    allocation_number: '123456789',
    lineRows: [
      {
        row_number: 1,
        description: 'רישיון תוכנה',
        quantity: '1',
        unit: 'יחידה',
        unit_price: '₪1,000.00',
        discount: '₪50.00',
        currency: 'ILS',
        vat_display: '₪171.00',
        vat_rate_label: '18%',
        total: '₪950.00',
      },
    ],
    issuer_snapshot_json: {
      display_name: 'מכון טכנולוגי לדוגמה בע״מ',
      tax_id: '514789632',
      phone: '03-1234567',
      email: 'office@example.com',
      address_json: { line1: 'רחוב העסק 1', city: 'תל אביב' },
    },
    customer_snapshot_json: {
      display_name: 'לקוח לדוגמה בע״מ',
      tax_id: '998877665',
      phone: '050-7654321',
      email: 'client@example.com',
      address_json: { line1: 'רחוב הלקוח 5', city: 'חיפה' },
    },
    lines_snapshot_json: [
      {
        description: 'רישיון תוכנה',
        quantity: 1,
        unit_label: 'יחידה',
        unit_price_reference: 1000,
        discount_display: '₪50.00',
        currency: 'ILS',
        vat_rate_code: 'standard',
        amount_reference: 950,
      },
    ],
    totals_snapshot_json: {
      subtotal_before_discount_display: '₪1,000.00',
      discount_enabled: true,
      discount_amount_display: '₪50.00',
      subtotal_after_discount_display: '₪950.00',
      vat_rate_label: 'מע״מ (18%)',
      vat_display: '₪171.00',
      grand_total_display: '₪1,121.00',
    },
    issuer_website: 'www.example.com',
    issuer_fallback_label: 'המנפיק',
  });
}

test('canonical render model maps issued snapshots to unified preview fields', () => {
  const input = buildSampleUnifiedInput();
  assert.equal(input.docTypeLabel, 'חשבונית מס');
  assert.equal(input.issuer.display_name, 'מכון טכנולוגי לדוגמה בע״מ');
  assert.equal(input.recipient.display_name, 'לקוח לדוגמה בע״מ');
  assert.equal(input.lineRows.length, 1);
  assert.equal(input.lineRows[0]?.unit, 'יחידה');
  assert.equal(input.lineRows[0]?.discount, '₪50.00');
  assert.equal(input.totals.discount, '₪50.00');
});

test('issuer logo comes from branding studio data url in issuer block', () => {
  const input = buildSampleUnifiedInput();
  input.branding = {
    ...input.branding,
    logo_data_url: 'data:image/png;base64,logo-test',
  };
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, /class="nx-doc__logo-img" src="data:image\/png;base64,logo-test"/);
  const sheet1Start = html.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--1"');
  const sheet2Start = html.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--2"');
  assert.ok(sheet1Start >= 0 && sheet2Start > sheet1Start);
  const section1 = html.slice(sheet1Start, sheet2Start);
  const section2 = html.slice(sheet2Start, html.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--3"'));
  assert.match(section1, /nx-doc__logo-img/);
  assert.match(section1, /nx-doc__issuer-identity/);
  assert.doesNotMatch(section1, /nx-doc__issuer-name/);
  assert.match(section2, /nx-doc__issuer-name/);
  assert.match(section2, /nx-doc__issuer-details/);
});

test('preview and PDF paths use the same unified HTML renderer', () => {
  const input = buildSampleUnifiedInput();
  const previewHtml = renderUnifiedIncomeDocumentHtml(input);
  const printHtml = buildUnifiedIncomeDocumentPrintHtml(input);
  assert.equal(printHtml.includes(previewHtml), true);
  assert.match(previewHtml, /nx-doc nx-doc--unified/);
  assert.match(printHtml, /@page \{ size: A4 portrait/);
  assert.match(printHtml, /dir="rtl"/);
});

test('unified tax invoice html markers — section order and labels', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  const bodyStart = html.indexOf('<div class="nx-doc nx-doc--unified"');
  assert.ok(bodyStart >= 0);
  const body = html.slice(bodyStart);
  const upperSheetIdx = body.indexOf('<div class="nx-doc__upper-sheet"');
  const sheet1Idx = body.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--1"');
  const sheet6Idx = body.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--6"');
  const tableIdx = body.indexOf('<table class="nx-doc__table"');
  const summaryIdx = body.indexOf('<section class="nx-doc__summary"');
  const commentsIdx = body.indexOf('<section class="nx-doc__comments"');
  const paymentsIdx = body.indexOf('<section class="nx-doc__payments"');
  const footerIdx = body.indexOf('<footer class="nx-doc__platform-footer"');
  assert.ok(upperSheetIdx >= 0);
  assert.ok(sheet1Idx >= 0);
  assert.ok(sheet6Idx >= 0);
  assert.ok(upperSheetIdx < tableIdx);
  assert.ok(sheet1Idx < sheet6Idx);
  assert.ok(sheet6Idx < tableIdx);
  assert.ok(tableIdx < summaryIdx);
  assert.ok(commentsIdx < summaryIdx);
  assert.ok(paymentsIdx < footerIdx);
  assert.match(html, /class="nx-doc__doc-number"/);
  assert.doesNotMatch(html, /class="nx-doc__doc-badge"/);
  assert.match(html, />מע״מ</);
  assert.match(html, />מחיר ליח'/);
  assert.match(html, />פירוט</);
  assert.match(html, />מטבע</);
  assert.match(html, />סה״כ</);
  assert.doesNotMatch(html, />סכום מע״מ</);
  assert.doesNotMatch(html, />יחידת מידה</);
  assert.match(html, /nx-doc__summary-head[\s\S]*סיכום כספי/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__grand-total[\s\S]*border-top: 2px solid var\(--nx-doc-primary\)/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__grand-total strong[\s\S]*font-size: 26px/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__grand-total strong[\s\S]*color: var\(--nx-doc-primary\)/);
  assert.match(html, /table-layout: fixed/);
  assert.match(html, /<colgroup>/);
  assert.match(html, /\.nx-doc__comments \{[\s\S]*grid-column: 1/);
  assert.match(html, /\.nx-doc__summary \{[\s\S]*grid-column: 2/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__table thead th \{[\s\S]*background: #f8fafc/);
  assert.match(html, /nx-doc__payments-head/);
  assert.match(html, />אמצעי תשלום</);
  assert.match(html, /חשבונית מס/);
  assert.match(html, />לכבוד</);
  assert.match(html, /הנחה לפני מע״מ/);
  assert.match(html, /₪50\.00/);
  assert.doesNotMatch(html, /−₪50/);
  assert.match(html, /סה״כ לתשלום/);
});

test('issuer is never hardcoded as NodexPro and footer branding appears once', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /מכון טכנולוגי לדוגמה בע/);
  assert.doesNotMatch(html, /NODEXPRO/);
  assert.match(html, /המסמך הופק באמצעות NodexPro/);
  assert.match(html, /https:\/\/www\.nodexpro\.com/);
  const footerMatches = html.match(/<footer class="nx-doc__platform-footer"/g) ?? [];
  assert.equal(footerMatches.length, 1);
});

test('discount row uses standard text color in unified css', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /\.nx-doc__total-row--discount span:first-child,\s*\.nx-doc__total-row--discount span:last-child \{ color: var\(--nx-doc-text\) !important/);
  assert.doesNotMatch(html, /total-row--discount[\s\S]*#dc2626/i);
  assert.doesNotMatch(html, /total-row--discount[\s\S]*red/i);
});

test('comments section hidden when notes empty', () => {
  const input = buildSampleUnifiedInput();
  input.notes = null;
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.doesNotMatch(html, /<section class="nx-doc__comments"/);
  assert.doesNotMatch(html, />הערות</);
});

test('payment bank details never appear inside comments section', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  const commentsStart = html.indexOf('<section class="nx-doc__comments"');
  const commentsEnd = html.indexOf('</section>', commentsStart);
  assert.ok(commentsStart >= 0);
  const commentsBody = html.slice(commentsStart, commentsEnd);
  assert.doesNotMatch(commentsBody, /IBAN:/);
  assert.doesNotMatch(commentsBody, /SWIFT:/);
  assert.doesNotMatch(commentsBody, /העברה בנקאית/);
});

test('default premium theme uses brand primary on doc number and table header', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /--nx-doc-primary: #5B4DFF/);
  assert.match(html, /class="nx-doc__doc-number">2026-000154/);
  assert.match(html, /--nx-doc-icon: var\(--nx-doc-primary\)/);
  assert.match(html, /nx-doc__issuer-details/);
  assert.match(html, /nx-doc__issuer-lines/);
});

test('credit card block hidden without backend payment link data', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.doesNotMatch(html, /nx-doc__payment-col--card/);
  assert.doesNotMatch(html, /pay\.nodexpro\.com/);
  assert.doesNotMatch(html, /פרטי תשלום בכרטיס יוצגו/);
});

test('credit card block renders only with real payment link', () => {
  const input = buildSampleUnifiedInput();
  input.payment_link_url = 'https://pay.example.com/inv/123';
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, /nx-doc__payment-col--card/);
  assert.match(html, /https:\/\/pay\.example\.com\/inv\/123/);
});

test('disabled payment methods do not render cards', () => {
  const input = buildSampleUnifiedInput();
  input.branding = {
    ...input.branding,
    payment_methods: input.branding.payment_methods.map((m) =>
      m.key === 'bit' ? { ...m, enabled: false } : m,
    ),
  };
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.doesNotMatch(html, />Bit</);
});

test('supported document types map to Hebrew labels through unified renderer', () => {
  const types = [
    ['tax_invoice', 'חשבונית מס'],
    ['tax_invoice_receipt', 'חשבונית מס/קבלה'],
    ['receipt', 'קבלה'],
    ['deal_invoice', 'חשבון עסקה'],
    ['quote', 'הצעת מחיר'],
    ['credit_tax_invoice', 'חשבונית מס זיכוי'],
  ] as const;
  for (const [document_type, label] of types) {
    const base = buildSampleUnifiedInput();
    const built = buildUnifiedIncomeDocumentRenderInput({
      branding: base.branding,
      document_type,
      language: 'he',
      document_number: '1',
      document_date: '2026-07-11',
      due_date: null,
      currency: 'ILS',
      notes: null,
      issuer_snapshot_json: {
        display_name: base.issuer.display_name,
        tax_id: base.issuer.tax_id,
      },
      customer_snapshot_json: {
        display_name: base.recipient.display_name,
        tax_id: base.recipient.tax_id,
      },
      lines_snapshot_json: [],
      totals_snapshot_json: {
        subtotal_before_discount_display: '₪0.00',
        subtotal_after_discount_display: '₪0.00',
        grand_total_display: '₪0.00',
        discount_enabled: false,
      },
    });
    assert.equal(built.docTypeLabel, label);
    assert.match(renderUnifiedIncomeDocumentHtml(built), new RegExp(label.replace('/', '\\/')));
  }
});

test('line rows pass through unit and discount columns when present in snapshot', () => {
  const rows = lineRowsFromLinesSnapshot(
    [
      {
        description: 'שירות',
        quantity: 2,
        unit_label: 'שעה',
        discount_display: '₪10.00',
        unit_price_reference: 100,
        currency: 'ILS',
        vat_rate_code: 'standard',
        amount_reference: 190,
      },
    ],
    'ILS',
    { vat_rate_label: 'מע״מ (18%)' },
  );
  assert.equal(rows[0]?.unit, 'שעה');
  assert.equal(rows[0]?.discount, '₪10.00');
});

test('totals snapshot keeps positive discount display', () => {
  const totals = totalsFromTotalsSnapshot({
    discount_enabled: true,
    discount_amount_display: '₪100.00',
    subtotal_before_discount_display: '₪1,000.00',
    subtotal_after_discount_display: '₪900.00',
    grand_total_display: '₪1,062.00',
  });
  assert.equal(totals.discount, '₪100.00');
});

test('pdf pipeline uses unified html renderer and not legacy pdf-lib layout', () => {
  assert.match(pdfServiceSource, /buildUnifiedIncomeDocumentRenderModelForIssuedDocument/);
  assert.match(pdfServiceSource, /buildUnifiedIncomeDocumentPrintHtml/);
  assert.match(pdfServiceSource, /renderIncomeDocumentPdfBufferFromHtml/);
  assert.match(pdfServiceSource, /unified_income_document_v1/);
  assert.doesNotMatch(pdfServiceSource, /buildIncomeDocumentRenderSnapshot/);
  assert.doesNotMatch(pdfServiceSource, /renderIncomeDocumentPdfBuffer\(/);
  assert.doesNotMatch(pdfRendererSource, /pdf-lib/);
  assert.doesNotMatch(pdfRendererSource, /PDFDocument\.create/);
});

test('draft preview builder routes through unified html renderer', () => {
  assert.match(detailsBuilderSource, /renderUnifiedIncomeDocumentHtml/);
  assert.match(detailsBuilderSource, /totalsFromTotalsSnapshot/);
  assert.doesNotMatch(detailsBuilderSource, /renderIncomeBrandedPreviewHtml\(/);
});

test('pdf failure handling remains explicit', () => {
  assert.match(pdfServiceSource, /pdf_render_status: 'failed'/);
  assert.match(pdfServiceSource, /INCOME_PDF_RENDER_FAILED/);
  assert.match(pdfServiceSource, /pdf_render_status: 'pending'/);
});

test('allocation number renders in metadata when backend provides value', () => {
  const input = buildSampleUnifiedInput();
  input.allocation_number_display = '123456789';
  input.allocation_number_visible = true;
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, />מספר הקצאה</);
  assert.match(html, />123456789</);
  assert.doesNotMatch(html, /nx-we-preview-sidebar__edit-btn/);
  assert.doesNotMatch(html, /pencil/i);
});

test('allocation number hidden in document html when not visible', () => {
  const input = buildSampleUnifiedInput();
  input.allocation_number_display = null;
  input.allocation_number_visible = false;
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.doesNotMatch(html, />מספר הקצאה</);
});

test('allocation number row visible in metadata when applicable even before value saved', () => {
  const input = buildSampleUnifiedInput();
  input.allocation_number_visible = true;
  input.allocation_number_display = 'הזינו מספר הקצאה';
  input.allocation_number_value_empty = true;
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, />מספר הקצאה</);
  assert.match(html, />הזינו מספר הקצאה</);
  assert.match(html, /nx-doc__meta-row--allocation/);
  assert.doesNotMatch(html, /data-income-allocation-edit/);
  assert.doesNotMatch(html, /<button[^>]*nx-doc__meta/);
});

test('preview and pdf share identical allocation metadata document content', () => {
  const input = buildSampleUnifiedInput();
  input.allocation_number_visible = true;
  input.allocation_number_display = '123456789';
  input.allocation_number_value_empty = false;
  const previewHtml = renderUnifiedIncomeDocumentHtml(input);
  const printHtml = buildUnifiedIncomeDocumentPrintHtml(input);
  assert.match(previewHtml, /nx-doc__meta-row--allocation[\s\S]*123456789/);
  assert.match(printHtml, /nx-doc__meta-row--allocation[\s\S]*123456789/);
  assert.doesNotMatch(previewHtml, /data-income-allocation-edit/);
  assert.doesNotMatch(printHtml, /data-income-allocation-edit/);
  assert.doesNotMatch(printHtml, /nx-we-preview-allocation-edit-btn/);
});

test('payment terms appear in document metadata from backend display value', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, />תנאי תשלום</);
  assert.match(html, />שוטף \+ 30</);
});

test('vat column renders backend vat amount not percentage rate', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /₪171\.00/);
  assert.doesNotMatch(html, /<td class="nx-doc__cell-vat">18%/);
});

test('issuer letterhead restores thin-outline contact icons', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  const issuerStart = html.indexOf('<div class="nx-doc__issuer-lines">');
  const issuerEnd = html.indexOf('</section>', issuerStart);
  const issuerBlock = html.slice(issuerStart, issuerEnd);
  assert.match(issuerBlock, /nx-doc__issuer-line-icon/);
  assert.match(issuerBlock, /514789632/);
  assert.match(html, /nx-doc__meta-icon/);
  const issuerIconCount = (issuerBlock.match(/nx-doc__issuer-line-icon(?!-)/g) ?? []).length;
  assert.equal(issuerIconCount, 5);
  assert.match(html, /\.nx-doc--unified \.nx-doc__issuer-line,\s*\.nx-doc--unified \.nx-doc__customer-line[\s\S]*grid-template-columns: 16px minmax\(0, 1fr\)/);
});

test('issuer business number row includes ID icon', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  const issuerStart = html.indexOf('<div class="nx-doc__issuer-lines">');
  const issuerEnd = html.indexOf('</div>', issuerStart);
  const issuerLines = html.slice(issuerStart, issuerEnd);
  assert.match(issuerLines, /nx-doc__issuer-line-icon[\s\S]*514789632/);
});

test('issuer address row includes location icon', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  const issuerStart = html.indexOf('<div class="nx-doc__issuer-lines">');
  const issuerEnd = html.indexOf('</section>', issuerStart);
  const issuerBlock = html.slice(issuerStart, issuerEnd);
  assert.match(issuerBlock, /nx-doc__issuer-line-icon[\s\S]*רחוב העסק 1/);
});

test('customer block uses aligned icons for address tax id phone email and website', () => {
  const input = buildSampleUnifiedInput();
  input.recipient = {
    ...input.recipient,
    website: 'www.client.example.com',
  };
  const html = renderUnifiedIncomeDocumentHtml(input);
  const bodyStart = html.indexOf('<div class="nx-doc nx-doc--unified"');
  const body = html.slice(bodyStart);
  const customerStart = body.indexOf('class="nx-doc__sheet-section nx-doc__sheet-section--6"');
  const customerEnd = body.indexOf('</section>', customerStart);
  const customerBlock = body.slice(customerStart, customerEnd);
  assert.match(customerBlock, /nx-doc__customer-lines/);
  assert.match(customerBlock, /nx-doc__customer-line-icon[\s\S]*רחוב הלקוח 5/);
  assert.match(customerBlock, /nx-doc__customer-line-icon[\s\S]*998877665/);
  assert.match(customerBlock, /nx-doc__customer-line-icon[\s\S]*050-7654321/);
  assert.match(customerBlock, /nx-doc__customer-line-icon[\s\S]*client@example\.com/);
  assert.match(customerBlock, /nx-doc__customer-line-icon[\s\S]*www\.client\.example\.com/);
  const lineCount = (customerBlock.match(/class="nx-doc__customer-line(?:\s|")/g) ?? []).length;
  assert.equal(lineCount, 5);
});

test('customer contact person row aligns with icon column spacer', () => {
  const input = buildSampleUnifiedInput();
  input.recipient = {
    ...input.recipient,
    contact_name: 'איש קשר לדוגמה',
  };
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, /nx-doc__customer-line--plain[\s\S]*איש קשר לדוגמה/);
  assert.match(html, /nx-doc__customer-line-icon--spacer/);
});

test('customer phone and email rows share aligned icon column', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(
    html,
    /\.nx-doc--unified \.nx-doc__customer-line[\s\S]*grid-template-columns: 16px minmax\(0, 1fr\)/,
  );
});

test('document number accent rule present in unified header', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /class="nx-doc__doc-number-rule"/);
});

test('issuer logo fills section 1 without stretching aspect ratio', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(
    html,
    /\.nx-doc--unified \.nx-doc__sheet-section--1 \.nx-doc__logo-img[\s\S]*max-height: 100%/,
  );
  assert.match(
    html,
    /\.nx-doc--unified \.nx-doc__sheet-section--1 \.nx-doc__logo-img[\s\S]*object-fit: contain/,
  );
});

test('table matches invoice editor grid styling', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /\.nx-doc--unified \.nx-doc__table[\s\S]*border: 1px solid #e2e8f0/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__table thead th[\s\S]*background: #f8fafc/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__table tbody td[\s\S]*border-bottom: 1px solid #f1f5f9/);
});

test('table starts immediately after upper sheet grid', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /\.nx-doc--unified \.nx-doc__upper-sheet[\s\S]*margin: 0 0 8px/);
  assert.match(html, /\.nx-doc--unified \.nx-doc__table[\s\S]*margin: 0 0 14px/);
});

test('classic default render has no sectioned class or pill number', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /class="nx-doc nx-doc--unified"/);
  assert.doesNotMatch(html, /class="nx-doc nx-doc--unified nx-doc--sectioned"/);
  assert.doesNotMatch(html, /class="nx-doc__doc-number-pill"/);
  assert.doesNotMatch(html, /aria-label="שורות מסמך"/);
  assert.match(html, />פירוט</);
  assert.match(html, />מטבע</);
  assert.doesNotMatch(html, />יחידת מידה</);
  assert.doesNotMatch(html, />הנחה</);
  assert.doesNotMatch(html, /data-income-allocation-edit/);
  assert.doesNotMatch(html, /<button/);
});

test('sectioned style matches golden-master printable layout', () => {
  const input = buildSampleUnifiedInput();
  input.branding = {
    ...input.branding,
    document_style_key: 'sectioned',
  };
  const previewHtml = renderUnifiedIncomeDocumentHtml(input);
  const printHtml = buildUnifiedIncomeDocumentPrintHtml(input);
  assert.match(previewHtml, /class="nx-doc nx-doc--unified nx-doc--sectioned"/);
  assert.match(previewHtml, /nx-doc__upper/);
  assert.match(previewHtml, /nx-doc__branding/);
  assert.match(previewHtml, /nx-doc__doc-column/);
  assert.match(previewHtml, /nx-doc__customer-card/);
  assert.match(previewHtml, /nx-doc__doc-number-bar/);
  assert.doesNotMatch(previewHtml, /nx-doc__doc-number-pill/);
  assert.doesNotMatch(previewHtml, /class="nx-doc__sheet-section-badge"/);
  assert.doesNotMatch(previewHtml, /data-sheet-section=/);
  assert.doesNotMatch(previewHtml, /aria-label="אזור \d"/);
  assert.doesNotMatch(previewHtml, /\.nx-doc--sectioned[\s\S]*grid-template-areas:/);
  assert.doesNotMatch(previewHtml, /\.nx-doc--sectioned[\s\S]*height: 65px/);
  assert.doesNotMatch(previewHtml, /issuerIdentity documentIdentity/);
  assert.match(previewHtml, /aria-label="שורות מסמך"/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__table thead th[\s\S]*background: var\(--nx-doc-primary\)/);
  assert.match(
    previewHtml,
    /\.nx-doc--sectioned \.nx-doc__upper[\s\S]*grid-template-columns: 1fr 0\.8fr/,
  );
  assert.match(
    previewHtml,
    /nx-doc__upper[\s\S]*nx-doc__doc-column[\s\S]*nx-doc__branding/,
  );
  assert.match(previewHtml, /\.nx-doc--sectioned[\s\S]*--nx-doc-branding-col:\s*336px/);
  assert.match(previewHtml, /\.nx-doc--sectioned[\s\S]*--nx-doc-doc-col:\s*420px/);
  assert.match(previewHtml, /\.nx-doc--sectioned[\s\S]*--nx-doc-logo-h:\s*102px/);
  assert.match(previewHtml, /\.nx-doc--sectioned[\s\S]*--nx-doc-logo-w:\s*271px/); /* medium: 0.85×319×120 */
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*object-fit: fill/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*width: 100%/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*height: 100%/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*transform: none/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*max-height: none/);
  assert.match(previewHtml, /\.nx-doc--unified:not\(\.nx-doc--sectioned\) \.nx-doc__logo-img/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__customer-card[\s\S]*min-height:\s*0/);
  assert.doesNotMatch(previewHtml, /\.nx-doc--sectioned \.nx-doc__customer-card[\s\S]*min-height:\s*200px/);
  assert.doesNotMatch(previewHtml, /transform: scale\(/);
  assert.match(previewHtml, /nx-doc__logo-frame/);
  assert.match(previewHtml, /nx-doc__doc-identity/);
  assert.match(previewHtml, /--nx-doc-identity-stack-width:152px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*background: var\(--nx-doc-primary\)/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*color: #ffffff/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*height: 39px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*width: 100%/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-number-text[\s\S]*font-size: 22px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-name[\s\S]*font-size: 14px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-name[\s\S]*font-weight: 700/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-name[\s\S]*text-align: start/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-line[\s\S]*border-bottom: 1px solid #e8e8f2/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-line-value[\s\S]*font-weight: 700/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__issuer-lines[\s\S]*gap: 8px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-identity[\s\S]*width: max-content/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-title[\s\S]*font-size: 32px/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__doc-title[\s\S]*text-align: start/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*margin: -38px 0/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*width: var\(--nx-doc-logo-w\)/);
  assert.match(previewHtml, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*height: var\(--nx-doc-logo-h\)/);
  assert.match(previewHtml, /nx-doc__payment-col--bank/);
  assert.match(previewHtml, /nx-doc__payment-col--card/);
  assert.match(previewHtml, /nx-doc__payment-col--other/);
  assert.match(previewHtml, />תיאור</);
  assert.match(previewHtml, />כמות</);
  assert.match(previewHtml, />יחידת מידה</);
  assert.match(previewHtml, />מחיר יחידה</);
  assert.match(previewHtml, />הנחה</);
  assert.match(previewHtml, />מע״מ</);
  assert.match(previewHtml, />סכום</);
  assert.doesNotMatch(previewHtml, />פירוט</);
  assert.doesNotMatch(previewHtml, />מטבע</);
  assert.doesNotMatch(previewHtml, /data-income-allocation-edit/);
  assert.doesNotMatch(previewHtml, /<button/);
  assert.match(previewHtml, /nx-doc__platform-legal/);
  assert.equal(printHtml.includes(previewHtml), true);
});
