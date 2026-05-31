import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DOCUMENT_STYLE_KEY,
  INCOME_DOCUMENT_STYLE_PRESETS,
  applyDocumentStyleToColorColumns,
  getDocumentStylePresets,
  matchDocumentStyleKeyFromLegacyColors,
  resolveBrandingProfile,
  resolveDocumentStylePreset,
} from '../../src/domains/income/income-document-branding.pure.js';
import { renderIncomeBrandedPreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

test('aggregate style presets expose 8 document styles', () => {
  const presets = getDocumentStylePresets();
  assert.equal(presets.length, 8);
  assert.ok(presets.every((p) => p.print_safe));
  assert.ok(presets.some((p) => p.key === 'classic_blue'));
  assert.ok(presets.some((p) => p.key === 'nodexpro_gradient'));
});

test('invalid document style key is rejected by resolver', () => {
  assert.equal(resolveDocumentStylePreset('not_a_style'), null);
});

test('legacy profile without document_style_key maps to default backend style', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: '',
    primary_color: '#999999',
    secondary_color: '#eeeeee',
    table_header_color: '#888888',
    totals_color: '#777777',
    client_block_position: 'right',
    footer_text: null,
    bank_name: null,
    bank_branch: null,
    bank_account: null,
    swift: null,
    iban: null,
    email_subject_template: null,
    email_body_template: null,
    customer_notes: null,
    terms_and_conditions: null,
    display_options: {},
    payment_methods: [],
    document_attachments: [],
    default_payment_terms: null,
  };
  const resolved = resolveBrandingProfile(row, { logo_data_url: null, signature_data_url: null });
  assert.equal(resolved.document_style_key, DEFAULT_DOCUMENT_STYLE_KEY);
  assert.ok(resolved.document_style);
});

test('applyDocumentStyleToColorColumns syncs stored color columns from style', () => {
  const style = resolveDocumentStylePreset('soft_green')!;
  const cols = applyDocumentStyleToColorColumns(style);
  assert.equal(cols.document_style_key, 'soft_green');
  assert.equal(cols.table_header_color, style.table_header_color);
  assert.equal(cols.totals_color, style.totals_accent_color);
});

test('preview uses selected style tokens and keeps issuer name readable', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: 'סלוגן',
    document_style_key: 'calm_red',
    primary_color: '#8b3a3a',
    secondary_color: '#faf3f3',
    table_header_color: '#8b3a3a',
    totals_color: '#8b3a3a',
    client_block_position: 'right',
    footer_text: null,
    bank_name: null,
    bank_branch: null,
    bank_account: null,
    swift: null,
    iban: null,
    email_subject_template: null,
    email_body_template: null,
    customer_notes: null,
    terms_and_conditions: null,
    display_options: {},
    payment_methods: [],
    document_attachments: [],
    default_payment_terms: null,
  };
  const branding = resolveBrandingProfile(row, { logo_data_url: null, signature_data_url: null });
  const html = renderIncomeBrandedPreviewHtml({
    branding,
    docTypeLabel: 'חשבונית מס',
    numberPreview: '1001',
    issuer: { display_name: 'Test4', tax_id: '123', address: 'רחוב 1', phone: '050', email: 'a@b.c' },
    recipient: { display_name: 'לקוח', tax_id: '999', address: 'כתובת', phone: '052', email: 'c@d.e' },
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

  const style = branding.document_style;
  assert.match(html, new RegExp(style.recipient_block_background.replace('#', '#')));
  assert.match(html, new RegExp(style.table_header_color.replace('#', '#')));
  assert.match(html, new RegExp(style.totals_accent_color.replace('#', '#')));
  assert.match(html, /nx-doc__issuer-name/);
  assert.match(html, /Test4/);
  assert.match(html, /#172033/);
  assert.doesNotMatch(html, /type="color"/i);
  assert.match(html, /לכבוד:/);
  assert.match(html, /max-width:\s*260px/);
  assert.match(html, /max-height:\s*120px/);
});

test('matchDocumentStyleKeyFromLegacyColors maps known blue palette', () => {
  assert.equal(
    matchDocumentStyleKeyFromLegacyColors('#1f4b99', '#1f4b99', '#1f4b99'),
    'classic_blue',
  );
});

test('frontend panel source does not expose hex color inputs', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(
    new URL('../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(panel, /type="color"/);
  assert.doesNotMatch(panel, /ColorPresetPicker/);
  assert.match(panel, /DocumentStylePicker/);
  assert.match(panel, /document_style_presets/);
});

test('service applies document_style_key on modal patch', async () => {
  const { readFile } = await import('node:fs/promises');
  const service = await readFile(
    new URL('../../src/domains/income/income-document-branding.service.ts', import.meta.url),
    'utf8',
  );
  assert.match(service, /document_style_key/);
  assert.match(service, /BRANDING_DOCUMENT_STYLE_INVALID/);
  assert.match(service, /document_style_presets/);
});
