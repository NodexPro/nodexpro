import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_COLOR_THEME_KEY,
  DEFAULT_DOCUMENT_STYLE_KEY,
  applyColorThemeToColorColumns,
  encodeEmailTemplateFromFriendly,
  formatDocumentNumberDisplay,
  getColorThemePresets,
  getDocumentStyleTemplates,
  getEmailTemplateTokens,
  matchColorThemeKeyFromLegacyColors,
  renderEmailTemplateFriendly,
  resolveBrandingProfile,
  resolveColorThemePreset,
  resolveDocumentStyleTemplate,
} from '../../src/domains/income/income-document-branding.pure.js';
import { renderIncomeBrandedPreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

test('color theme presets expose 8 studio themes', () => {
  const presets = getColorThemePresets();
  assert.equal(presets.length, 8);
  assert.ok(presets.every((p) => p.print_safe));
  assert.ok(presets.some((p) => p.key === 'modern_blue'));
  assert.ok(presets.some((p) => p.key === 'nodexpro_gradient'));
});

test('document style templates expose 4 layout archetypes', () => {
  const templates = getDocumentStyleTemplates();
  assert.equal(templates.length, 4);
  assert.ok(templates.some((t) => t.key === 'classic'));
  assert.ok(templates.some((t) => t.key === 'elegant'));
  assert.ok(templates.every((t) => t.mini_preview_markup.includes('nx-studio-style-mini')));
});

test('invalid color theme key is rejected by resolver', () => {
  assert.equal(resolveColorThemePreset('not_a_theme'), null);
});

test('legacy profile without studio keys maps to defaults', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'classic_blue',
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
  assert.equal(resolved.color_theme_key, 'modern_blue');
  assert.ok(resolved.color_theme);
});

test('applyColorThemeToColorColumns syncs stored color columns from theme', () => {
  const theme = resolveColorThemePreset('emerald')!;
  const cols = applyColorThemeToColorColumns(theme);
  assert.equal(cols.color_theme_key, 'emerald');
  assert.equal(cols.table_header_color, theme.table_header_color);
  assert.equal(cols.totals_color, theme.totals_accent_color);
});

test('preview uses theme tokens, elegant layout, and draft number label', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: 'סלוגן',
    document_style_key: 'elegant',
    color_theme_key: 'executive_navy',
    primary_color: '#1e293b',
    secondary_color: '#f8fafc',
    table_header_color: '#1e293b',
    totals_color: '#334155',
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
    docTypeLabel: 'הצעת מחיר',
    numberPreview: null,
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

  const theme = branding.color_theme;
  assert.match(html, new RegExp(theme.recipient_accent_color.replace('#', '#')));
  assert.match(html, new RegExp(theme.table_header_color.replace('#', '#')));
  assert.match(html, /nx-doc__header--elegant/);
  assert.match(html, /Test4/);
  assert.match(html, /טיוטה/);
  assert.match(html, /Arial, Helvetica, "Segoe UI", sans-serif/);
  assert.match(html, /לכבוד:/);
  assert.doesNotMatch(html, /type="color"/i);
});

test('formatDocumentNumberDisplay shows draft label when no number', () => {
  assert.equal(formatDocumentNumberDisplay(null), 'טיוטה');
  assert.equal(formatDocumentNumberDisplay(''), 'טיוטה');
  assert.equal(formatDocumentNumberDisplay('1001'), '1001');
});

test('matchColorThemeKeyFromLegacyColors maps known blue palette', () => {
  assert.equal(matchColorThemeKeyFromLegacyColors('#1f4b99', '#1f4b99', '#1f4b99'), 'modern_blue');
});

test('resolveDocumentStyleTemplate accepts four archetypes', () => {
  assert.ok(resolveDocumentStyleTemplate('minimal'));
  assert.equal(resolveDocumentStyleTemplate('classic_blue'), null);
});

test('frontend panel source uses studio aggregate only', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(
    new URL('../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(panel, /type="color"/);
  assert.match(panel, /document_branding_studio/);
  assert.match(panel, /nx-branding-studio-style-card/);
  assert.match(panel, /dangerouslySetInnerHTML/);
});

test('preview draft command is registered and does not persist', async () => {
  const { readFile } = await import('node:fs/promises');
  const commands = await readFile(
    new URL('../../src/domains/income/income-commands.service.ts', import.meta.url),
    'utf8',
  );
  const service = await readFile(
    new URL('../../src/domains/income/income-document-branding.service.ts', import.meta.url),
    'utf8',
  );
  assert.match(commands, /INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT/);
  assert.match(commands, /executeUpdateIncomeDocumentBrandingProfilePreviewDraft/);
  assert.match(service, /export async function previewIncomeDocumentBrandingProfileDraft/);
  assert.match(service, /renderStudioSamplePreviewHtml\(resolved\)/);
  assert.match(service, /email_template_preview/);
});

test('frontend panel debounces backend preview refresh', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(
    new URL('../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /onPreviewDraft/);
  assert.match(panel, /buildBrandingPreviewDraftBody/);
  assert.match(panel, /previewRequestRef/);
  assert.match(panel, /250/);
});

test('email template tokens expose Hebrew labels and example values', () => {
  const tokens = getEmailTemplateTokens();
  assert.equal(tokens.length, 4);
  assert.deepEqual(
    tokens.map((t) => t.key),
    ['document_type', 'document_number', 'client_name', 'business_name'],
  );
  assert.ok(tokens.every((t) => t.label && t.token && t.example_value));
  assert.equal(tokens[0]?.label, 'סוג מסמך');
  assert.equal(tokens[0]?.example_value, 'הצעת מחיר');
});

test('email template friendly render and encode roundtrip', () => {
  const tokens = getEmailTemplateTokens();
  const storedSubject = '{{document_type}} מספר {{document_number}}';
  const storedBody =
    'שלום,\n\nמצורפת {{document_type}} מספר {{document_number}}.\n\nתודה רבה.';

  const friendlySubject = renderEmailTemplateFriendly(storedSubject, tokens);
  const friendlyBody = renderEmailTemplateFriendly(storedBody, tokens);

  assert.equal(friendlySubject, 'הצעת מחיר מספר טיוטה');
  assert.match(friendlyBody, /שלום,/);
  assert.match(friendlyBody, /מצורפת הצעת מחיר מספר טיוטה/);

  assert.equal(encodeEmailTemplateFromFriendly(friendlySubject, tokens), storedSubject);
  assert.equal(encodeEmailTemplateFromFriendly(friendlyBody, tokens), storedBody);
});

test('branding studio aggregate exposes email template metadata', async () => {
  const { readFile } = await import('node:fs/promises');
  const service = await readFile(
    new URL('../../src/domains/income/income-document-branding.service.ts', import.meta.url),
    'utf8',
  );
  assert.match(service, /email_template_tokens/);
  assert.match(service, /email_template_editor/);
  assert.match(service, /email_template_preview/);
  assert.match(service, /buildEmailTemplateStudioParts/);
});

test('email tab UI uses friendly fields and Hebrew token chips', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(
    new URL('../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /email_subject_friendly/);
  assert.match(panel, /email_body_friendly/);
  assert.match(panel, /משתנים זמינים/);
  assert.match(panel, /nx-branding-studio-email-token/);
  assert.match(panel, /buildBrandingModalSaveBody[\s\S]*email_subject_friendly/);
  assert.doesNotMatch(panel, /hint="\{\{document_type\}\}/);
  assert.doesNotMatch(panel, /value=\{draft\.email_subject_template\}/);
});
