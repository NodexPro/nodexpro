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
  const issuerStart = html.indexOf('<div class="nx-doc__issuer-identity">');
  const issuerEnd = html.indexOf('</div>', issuerStart);
  assert.ok(issuerStart >= 0);
  const issuerBlock = html.slice(issuerStart, issuerEnd);
  assert.match(issuerBlock, /nx-doc__logo-img/);
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
  const headerIdx = html.indexOf('<section class="nx-doc__header"');
  const customerIdx = html.indexOf('<section class="nx-doc__customer"');
  const tableIdx = html.indexOf('<table class="nx-doc__table"');
  const summaryIdx = html.indexOf('<section class="nx-doc__summary"');
  const commentsIdx = html.indexOf('<section class="nx-doc__comments"');
  const paymentsIdx = html.indexOf('<section class="nx-doc__payments"');
  const footerIdx = html.indexOf('<footer class="nx-doc__platform-footer"');
  assert.ok(headerIdx < customerIdx);
  assert.ok(customerIdx < tableIdx);
  assert.ok(tableIdx < summaryIdx);
  assert.ok(commentsIdx < summaryIdx);
  assert.ok(paymentsIdx < footerIdx);
  assert.match(html, /\.nx-doc__customer \{[\s\S]*width: 100%/);
  assert.match(html, /\.nx-doc__customer \{[\s\S]*border-bottom:/);
  assert.match(html, /\.nx-doc__customer-inner \{[\s\S]*margin-inline-start: auto/);
  assert.match(html, /\.nx-doc__comments \{[\s\S]*grid-column: 1/);
  assert.match(html, /\.nx-doc__summary \{[\s\S]*grid-column: 2/);
  assert.match(html, /\.nx-doc__table thead th \{[\s\S]*background: var\(--nx-doc-header-gradient\)/);
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
  assert.match(html, /מסמך זה הופק באמצעות מערכת NodexPro/);
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

test('default premium theme uses purple gradient on badge and table header', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.match(html, /--nx-doc-header-gradient: linear-gradient\(135deg, #5B4DFF 0%, #6A5BFF 100%\)/);
  assert.match(html, /--nx-doc-icon: var\(--nx-doc-primary\)/);
  assert.match(html, /stroke="currentColor"/);
  assert.match(html, /border-radius: 12px/);
});

test('credit card block hidden without backend payment link data', () => {
  const html = renderUnifiedIncomeDocumentHtml(buildSampleUnifiedInput());
  assert.doesNotMatch(html, /nx-doc__payment-card--card/);
  assert.doesNotMatch(html, /pay\.nodexpro\.com/);
  assert.doesNotMatch(html, /פרטי תשלום בכרטיס יוצגו/);
});

test('credit card block renders only with real payment link', () => {
  const input = buildSampleUnifiedInput();
  input.payment_link_url = 'https://pay.example.com/inv/123';
  const html = renderUnifiedIncomeDocumentHtml(input);
  assert.match(html, /nx-doc__payment-card--card/);
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
