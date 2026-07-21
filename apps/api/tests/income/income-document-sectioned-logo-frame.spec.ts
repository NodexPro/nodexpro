import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSectionedLogoFrameRecommendedSizeHint,
  getSectionedLogoFrameMeta,
  SECTIONED_LOGO_FRAME,
  SECTIONED_LOGO_RECOMMENDED_UPLOAD,
} from '../../src/domains/income/income-document-sectioned-logo-frame.pure.js';
import {
  resolveSectionedBrandingLayout,
} from '../../src/domains/income/income-document-sectioned-golden-master.pure.js';
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

describe('sectioned logo frame contract (golden master)', () => {
  test('upload guidance is wide horizontal lockup', () => {
    const meta = getSectionedLogoFrameMeta();
    assert.equal(meta.width_px, SECTIONED_LOGO_RECOMMENDED_UPLOAD.width_px);
    assert.equal(meta.height_px, SECTIONED_LOGO_RECOMMENDED_UPLOAD.height_px);
    assert.equal(meta.aspect_ratio, '1288:244');
    assert.equal(meta.aspect_ratio_label, '≈ 5.3∶1');
    assert.equal(meta.css_frame_class, 'nx-doc__logo-frame');
    assert.equal(SECTIONED_LOGO_FRAME.width_px, 300);
    assert.equal(SECTIONED_LOGO_FRAME.height_px, 70);
    assert.equal(SECTIONED_LOGO_FRAME.section_outer_height_px, 0);
  });

  test('recommended size hint comes from the same logo-frame metadata', () => {
    const meta = getSectionedLogoFrameMeta();
    const hint = buildSectionedLogoFrameRecommendedSizeHint();
    assert.equal(hint, meta.recommended_size_hint);
    assert.match(hint, /1288 × 244/);
    assert.match(hint, /≈ 5\.3∶1/);
    assert.match(hint, /אופקי/);
  });

  test('missing logo keeps branding logo frame without sheet chrome', () => {
    const html = sectionedHtml(null);
    assert.match(html, /nx-doc__logo-frame/);
    assert.match(html, /nx-doc__logo-frame--empty/);
    assert.match(html, /nx-doc__branding/);
    assert.match(html, /nx-doc__upper/);
    assert.doesNotMatch(html, /class="nx-doc__sheet-section-badge"/);
    assert.doesNotMatch(html, /data-sheet-section=/);
    assert.doesNotMatch(html, /aria-label="אזור \d"/);
    assert.doesNotMatch(html, /\.nx-doc--sectioned[\s\S]*height: 65px/);
    assert.doesNotMatch(html, /<img class="nx-doc__logo-img"/);
  });

  test('logo stretches to exact paint box even when file is small', () => {
    const html = sectionedHtml('data:image/png;base64,landscape');
    assert.match(html, /nx-doc__logo-img/);
    assert.match(html, /object-fit: fill/);
    assert.match(html, /data-logo-processing="/);
    assert.doesNotMatch(html, /transform: scale\(/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*transform: none/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*width: 100%/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*height: 100%/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*width: var\(--nx-doc-logo-w\)/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*height: var\(--nx-doc-logo-h\)/);
  });

  test('branding column is 20% narrower than document column', () => {
    const medium = resolveSectionedBrandingLayout('medium');
    assert.equal(medium.branding_col_width_px, 336);
    assert.equal(medium.doc_col_width_px, 420);
    assert.ok(medium.branding_col_width_px < medium.doc_col_width_px);
    assert.ok(
      Math.abs(medium.branding_col_width_px / medium.doc_col_width_px - 0.8) < 0.01,
    );
    const html = sectionedHtml('data:image/png;base64,portrait');
    assert.match(html, /--nx-doc-logo-w:\s*271px/);
    assert.match(html, /--nx-doc-logo-h:\s*102px/);
    assert.match(html, /--nx-doc-branding-col:\s*336px/);
    assert.match(html, /--nx-doc-doc-col:\s*420px/);
  });

  test('studio logo size large paints exact 319×120 without empty frame padding', () => {
    const medium = resolveSectionedBrandingLayout('medium');
    const large = resolveSectionedBrandingLayout('large');
    assert.equal(large.scale, 1);
    assert.equal(large.logo_block_width_px, 319);
    assert.equal(large.logo_block_height_px, 120);
    assert.equal(large.branding_col_width_px, medium.branding_col_width_px);
    assert.equal(large.doc_col_width_px, medium.doc_col_width_px);
    assert.ok(large.logo_block_height_px > medium.logo_block_height_px);
    assert.ok(large.logo_block_width_px > medium.logo_block_width_px);

    const html = renderIncomeBrandedPreviewHtml({
      branding: resolveBrandingProfile(
        { ...baseRow, logo_size_key: 'large' },
        { logo_data_url: 'data:image/png;base64,landscape', signature_data_url: null },
      ),
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
    assert.match(html, /--nx-doc-logo-h:\s*120px/);
    assert.match(html, /--nx-doc-logo-w:\s*319px/);
    assert.match(html, /--nx-doc-logo-scale:\s*1(?:\.0)?/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-img[\s\S]*object-fit: fill/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__logo-frame[\s\S]*height: var\(--nx-doc-logo-h\)/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__branding[\s\S]*text-align: left/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__doc-column[\s\S]*align-items: flex-start/);
    assert.match(html, /\.nx-doc--sectioned[\s\S]*padding-inline:\s*19px 0/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__upper[\s\S]*grid-template-columns: 1fr 0\.8fr/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__table[\s\S]*width:\s*100%/);
    assert.match(html, /\.nx-doc--sectioned[\s\S]*max-width:\s*794px/);
    assert.match(html, /\.nx-doc--sectioned \.nx-doc__doc-title[\s\S]*font-size:\s*32px/);
  });
});
