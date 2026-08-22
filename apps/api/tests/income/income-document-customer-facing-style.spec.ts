/**
 * Customer-facing Income document style — shared INV-13A finished layout.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import {
  CUSTOMER_FACING_INCOME_DOCUMENT_STYLE_KEY,
  resolveCustomerFacingIncomeDocumentBranding,
} from '../../src/domains/income/income-document-customer-facing-style.pure.js';
import { renderUnifiedIncomeDocumentHtml } from '../../src/domains/income/income-document-unified-render.html.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';
import type { IncomeDocumentType } from '../../src/domains/income/income.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const issuedRenderServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-unified-render.service.ts'),
  'utf8',
);

function sampleClassicBrandingRow(): IncomeBrandingProfileRow {
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
    payment_methods: [],
    document_attachments: [],
    default_payment_terms: null,
    logo_size_key: 'm',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function renderCustomerFacingDraftPreviewHtml(documentType: IncomeDocumentType): string {
  const studioBranding = resolveBrandingProfile(sampleClassicBrandingRow(), {
    logo_data_url: null,
    signature_data_url: null,
  });
  assert.equal(studioBranding.document_style_key, 'classic');
  const previewBranding = resolveCustomerFacingIncomeDocumentBranding(studioBranding);
  return renderUnifiedIncomeDocumentHtml({
    branding: previewBranding,
    docTypeLabel:
      documentType === 'deal_invoice'
        ? 'חשבון עסקה'
        : documentType === 'tax_invoice'
          ? 'חשבונית מס'
          : documentType === 'tax_invoice_receipt'
            ? 'חשבונית מס/קבלה'
            : documentType === 'quote'
              ? 'הצעת מחיר'
              : documentType,
    numberPreview: '1001',
    document_type: documentType,
    issuer: {
      display_name: 'Issuer Ltd',
      tax_id: '123',
      address: 'Tel Aviv',
      phone: null,
      email: null,
      website: null,
      contact_name: null,
    },
    recipient: {
      display_name: 'Customer',
      tax_id: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      contact_name: null,
    },
    document_date: '2026-08-01',
    due_date: null,
    currency: 'ILS',
    lineRows: [
      {
        row_number: 1,
        description: 'Service',
        quantity: '1',
        unit: null,
        unit_price: '100.00',
        discount: null,
        currency: 'ILS',
        vat_display: '17.00',
        vat_rate_label: '17%',
        total: '117.00',
      },
    ],
    totals: {
      subtotal_before_discount: '100.00',
      discount: null,
      subtotal_after_discount: '100.00',
      vat_label: 'מע״מ',
      vat: '17.00',
      grand_total: '117.00',
    },
    notes: null,
    company_subtitle: null,
  });
}

test('resolveCustomerFacingIncomeDocumentBranding forces sectioned from classic studio profile', () => {
  const classic = resolveBrandingProfile(sampleClassicBrandingRow(), {
    logo_data_url: null,
    signature_data_url: null,
  });
  assert.equal(classic.document_style_key, 'classic');
  const facing = resolveCustomerFacingIncomeDocumentBranding(classic);
  assert.equal(facing.document_style_key, CUSTOMER_FACING_INCOME_DOCUMENT_STYLE_KEY);
  assert.equal(facing.document_style_key, 'sectioned');
  // Non-style fields unchanged.
  assert.equal(facing.primary_color, classic.primary_color);
  assert.equal(facing.color_theme_key, classic.color_theme_key);
  assert.equal(facing.display_options.show_vat_row, classic.display_options.show_vat_row);
});

test('resolveCustomerFacingIncomeDocumentBranding is idempotent when already sectioned', () => {
  const sectioned = resolveBrandingProfile(
    { ...sampleClassicBrandingRow(), document_style_key: 'sectioned' },
    { logo_data_url: null, signature_data_url: null },
  );
  const facing = resolveCustomerFacingIncomeDocumentBranding(sectioned);
  assert.equal(facing, sectioned);
});

test('customer-facing draft preview HTML is sectioned finished layout — not upper-sheet classic', () => {
  for (const documentType of [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
    'quote',
  ] as const) {
    const html = renderCustomerFacingDraftPreviewHtml(documentType);
    assert.match(html, /class="nx-doc nx-doc--unified nx-doc--sectioned"/, documentType);
    assert.match(html, /class="nx-doc__upper"/, documentType);
    // Classic builder grid must not be the customer-facing DOM (CSS may still mention classic selectors).
    assert.doesNotMatch(html, /<div class="nx-doc__upper-sheet"/, documentType);
    assert.doesNotMatch(html, /<section class="nx-doc__sheet-section/, documentType);
    // Branding / content still present.
    assert.match(html, /Issuer Ltd/, documentType);
    assert.match(html, /Customer/, documentType);
    assert.match(html, /Service/, documentType);
    assert.match(html, /117\.00/, documentType);
  }
});

test('draft preview builder uses shared customer-facing style helper — not conversion-specific', () => {
  const previewSlice = detailsBuildersSource.slice(
    detailsBuildersSource.indexOf('const previewBranding'),
    detailsBuildersSource.indexOf('const deliveryEmail'),
  );
  assert.match(previewSlice, /resolveCustomerFacingIncomeDocumentBranding/);
  assert.match(previewSlice, /renderUnifiedIncomeDocumentHtml/);
  assert.doesNotMatch(previewSlice, /conversion/i);
  assert.doesNotMatch(previewSlice, /document_type === 'credit_tax_invoice'/);
});

test('issued render model uses the same shared customer-facing style helper', () => {
  assert.match(
    issuedRenderServiceSource,
    /resolveCustomerFacingIncomeDocumentBranding\(branding\)/,
  );
  assert.doesNotMatch(
    issuedRenderServiceSource,
    /branding\.document_style_key === 'sectioned'\s*\?\s*branding/,
  );
});
