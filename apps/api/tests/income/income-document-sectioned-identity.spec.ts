import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  resolveSectionedDocumentIdentityPresentation,
  SECTIONED_NUMBER_BAR_FALLBACK_WIDTH,
  SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE,
} from '../../src/domains/income/income-document-sectioned-identity.pure.js';
import { DOCUMENT_TYPE_LABELS_HE } from '../../src/domains/income/income-pdf-template.resolver.js';
import { renderIncomeBrandedPreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';
import type { IncomeDocumentType } from '../../src/domains/income/income.types.js';

const baseRow: IncomeBrandingProfileRow = {
  id: 'p1',
  organization_id: 'o1',
  issuer_business_id: 'b1',
  represented_client_id: null,
  logo_file_asset_id: null,
  signature_file_asset_id: null,
  company_subtitle: null,
  document_style_key: 'sectioned',
  color_theme_key: 'nodexpro_premium',
  primary_color: '#5b21b6',
  secondary_color: '#ddd6fe',
  table_header_color: '#5b21b6',
  totals_color: '#5b21b6',
  client_block_position: 'right',
  footer_text: null,
  bank_name: null,
  bank_branch: null,
  bank_account: null,
  swift: null,
  iban: null,
  payment_instructions: null,
  email_subject_template: null,
  email_body_template: null,
  customer_notes: null,
  terms_and_conditions: null,
  display_options: {},
  payment_methods: [],
  document_attachments: [],
  default_payment_terms: null,
};

function renderForType(document_type: IncomeDocumentType, numberPreview = '2026-000154'): string {
  return renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile(baseRow, { logo_data_url: null, signature_data_url: null }),
    docTypeLabel: DOCUMENT_TYPE_LABELS_HE[document_type],
    document_type,
    numberPreview,
    issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
    recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
    document_date: '2026-05-01',
    due_date: null,
    currency: 'ILS',
    lineRows: [],
    totals: {
      subtotal_before_discount: '100',
      discount: null,
      subtotal_after_discount: '100',
      vat_label: 'מע״מ',
      vat: '17',
      grand_total: '117',
    },
    notes: null,
    company_subtitle: null,
  });
}

describe('sectioned document-number identity presentation', () => {
  test('maps חשבונית מס width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'חשבונית מס',
      document_number: '4000',
      document_type: 'tax_invoice',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.tax_invoice);
    assert.equal(p.title_width_key, 'tax_invoice');
  });

  test('maps הצעת מחיר width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'הצעת מחיר',
      document_number: '1',
      document_type: 'quote',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.quote);
  });

  test('maps חשבון עסקה width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'חשבון עסקה',
      document_number: '1',
      document_type: 'deal_invoice',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.deal_invoice);
  });

  test('maps קבלה width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'קבלה',
      document_number: '1',
      document_type: 'receipt',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.receipt);
  });

  test('maps חשבונית מס/קבלה width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'חשבונית מס/קבלה',
      document_number: '1',
      document_type: 'tax_invoice_receipt',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.tax_invoice_receipt);
  });

  test('maps חשבונית מס זיכוי width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'חשבונית מס זיכוי',
      document_number: '1',
      document_type: 'credit_tax_invoice',
    });
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.credit_tax_invoice);
  });

  test('unknown document title uses חשבונית מס fallback width', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'מסמך לא מוכר ארוך מאוד מאוד מאוד',
      document_number: '99',
      document_type: null,
    });
    assert.equal(p.title_width_key, 'tax_invoice');
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_FALLBACK_WIDTH);
    assert.equal(p.number_bar_width, SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE.tax_invoice);
  });

  test('number text remains backend supplied', () => {
    const p = resolveSectionedDocumentIdentityPresentation({
      doc_type_label: 'חשבונית מס',
      document_number: '2026-000154',
      document_type: 'tax_invoice',
    });
    assert.equal(p.document_number, '2026-000154');
  });

  test('sectioned HTML uses white number bar and prepared stack width', () => {
    const html = renderForType('tax_invoice', '2026-000154');
    assert.match(html, /nx-doc__doc-number-bar/);
    assert.match(html, />2026-000154</);
    assert.match(html, /--nx-doc-identity-stack-width:152px/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*color: #ffffff/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__doc-number-bar[\s\S]*background: var\(--nx-doc-primary\)/);
    assert.doesNotMatch(html, /nx-doc__doc-number-pill/);
  });

  test('each supported type gets its mapped bar width in HTML', () => {
    for (const [documentType, width] of Object.entries(SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE) as [
      IncomeDocumentType,
      string,
    ][]) {
      const html = renderForType(documentType);
      assert.match(html, new RegExp(`--nx-doc-identity-stack-width:${width.replace('.', '\\.')}`));
      assert.match(html, new RegExp(`data-title-width-key="${documentType}"`));
    }
  });

  test('old pale number-pill class is no longer used for sectioned layout', () => {
    const html = renderForType('quote');
    assert.doesNotMatch(html, /nx-doc__doc-number-pill/);
    assert.doesNotMatch(html, /border-radius:\s*999px/);
    assert.match(html, /nx-doc__doc-number-bar/);
  });
});
