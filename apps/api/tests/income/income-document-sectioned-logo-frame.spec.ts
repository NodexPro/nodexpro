import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSectionedLogoFrameRecommendedSizeHint,
  getSectionedLogoFrameMeta,
  SECTIONED_LOGO_FRAME,
} from '../../src/domains/income/income-document-sectioned-logo-frame.pure.js';
import { renderIncomeBrandedPreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

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
  display_options: { show_logo: true },
  payment_methods: [],
  document_attachments: [],
  default_payment_terms: null,
};

function sectionedHtml(logo_data_url: string | null): string {
  return renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile(baseRow, { logo_data_url, signature_data_url: null }),
    docTypeLabel: 'חשבונית מס',
    document_type: 'tax_invoice',
    numberPreview: '4000',
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

describe('sectioned logo frame contract', () => {
  test('logo frame metadata returns exact width and height', () => {
    const meta = getSectionedLogoFrameMeta();
    assert.equal(meta.width_px, 322);
    assert.equal(meta.height_px, 61);
    assert.equal(meta.aspect_ratio, '322:61');
    assert.equal(meta.css_frame_width, '322px');
    assert.equal(meta.css_frame_height, '61px');
    assert.equal(meta.css_frame_class, 'nx-doc__logo-frame');
    assert.equal(SECTIONED_LOGO_FRAME.section_outer_height_px, 65);
    assert.equal(SECTIONED_LOGO_FRAME.height_px, 65 - 2 * SECTIONED_LOGO_FRAME.section_border_px);
  });

  test('recommended size hint comes from the same logo-frame metadata', () => {
    const meta = getSectionedLogoFrameMeta();
    const hint = buildSectionedLogoFrameRecommendedSizeHint();
    assert.equal(hint, meta.recommended_size_hint);
    assert.match(hint, /322 × 61/);
    assert.match(hint, /≈ 5\.3∶1/);
    assert.match(hint, /יותאמו למסגרת/);
    assert.match(hint, /רקע לבן/);
  });

  test('missing logo keeps fixed white frame and does not collapse', () => {
    const html = sectionedHtml(null);
    assert.match(html, /nx-doc__logo-frame/);
    assert.match(html, /nx-doc__logo-frame--empty/);
    assert.match(html, /--nx-doc-logo-frame-width:\s*322px/);
    assert.match(html, /--nx-doc-logo-frame-height:\s*61px/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-frame[\s\S]*background: #ffffff/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1[\s\S]*height: 65px/);
    assert.doesNotMatch(html, /<img class="nx-doc__logo-img"/);
  });

  test('large landscape logo uses contain fit without stretch or fixed scale', () => {
    const html = sectionedHtml('data:image/png;base64,landscape');
    assert.match(html, /nx-doc__logo-img/);
    assert.match(html, /object-fit: contain/);
    assert.match(html, /object-position: center/);
    assert.match(html, /--nx-doc-logo-fit:\s*92%/);
    assert.doesNotMatch(html, /transform: scale\(/);
    assert.doesNotMatch(html, /object-fit:\s*fill/);
  });

  test('large portrait logo uses same fixed frame contract', () => {
    const html = sectionedHtml('data:image/png;base64,portrait');
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-frame[\s\S]*width: 100%/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-frame[\s\S]*height: 100%/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-frame[\s\S]*overflow: hidden/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-img[\s\S]*transform: none/);
  });

  test('logo stays contain-centered on white paper inside clipped frame', () => {
    const html = sectionedHtml('data:image/png;base64,small');
    assert.match(html, /object-fit: contain/);
    assert.match(html, /background: #ffffff/);
    assert.match(html, /transform: none/);
  });

  test('transparent logo still renders over white frame background', () => {
    const html = sectionedHtml('data:image/png;base64,transparent');
    assert.match(html, /src="data:image\/png;base64,transparent"/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__sheet-section--1 \.nx-doc__logo-frame[\s\S]*background: #ffffff/);
  });
});
