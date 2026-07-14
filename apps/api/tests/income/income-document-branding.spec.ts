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
  normalizeLegacyDocumentColorThemeKey,
  matchColorThemeKeyFromLegacyColors,
  normalizeStudioDocumentStyleKey,
  renderEmailTemplateFriendly,
  resolveBrandingPreviewThemePalette,
  getStudioNavigationSections,
  getStudioColorThemePresets,
  buildStudioSampleIssuerIdentityPreview,
  buildStudioSampleLivePreview,
  resolveBrandingProfile,
  resolveBrandingProfileForDocumentTypeGroup,
  buildDocumentTypeStyleGroups,
  resolveColorThemePreset,
  resolveDocumentStyleTemplate,
} from '../../src/domains/income/income-document-branding.pure.js';
import { renderIncomeBrandedPreviewHtml, renderStudioSamplePreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

test('color theme presets expose 14 studio themes including NodexPro premium default', () => {
  const presets = getColorThemePresets();
  assert.equal(presets.length, 14);
  assert.ok(presets.every((p) => p.print_safe));
  const premium = presets.find((p) => p.key === 'nodexpro_premium');
  assert.ok(premium);
  assert.equal(premium!.label, 'NodexPro Premium');
  assert.equal(premium!.table_header_color, '#5B4DFF');
  assert.equal(premium!.recipient_block_background, '#F8F9FD');
  assert.equal(premium!.recipient_block_border, '#E6E8F2');
  assert.equal(premium!.text_on_light, '#1C2333');
  const blackWhite = presets.find((p) => p.key === 'black_white');
  assert.ok(blackWhite);
  assert.equal(blackWhite!.label, 'שחור לבן');
});

test('studio color catalog exposes full fixed palette', () => {
  const presets = getStudioColorThemePresets();
  assert.equal(presets.length, 14);
  assert.ok(presets.some((p) => p.key === 'nodexpro_premium'));
  assert.ok(presets.some((p) => p.key === 'black_white' && p.studio_label === 'שחור לבן'));
  assert.ok(presets.some((p) => p.key === 'pastel_purple'));
  assert.ok(presets.some((p) => p.key === 'pale_peach'));
  assert.ok(!presets.some((p) => p.key === 'elegant_gold'));
  assert.ok(!presets.some((p) => p.key === 'modern_blue'));
});

test('studio navigation exposes seven SaaS sections', () => {
  const sections = getStudioNavigationSections();
  assert.equal(sections.length, 7);
  assert.ok(sections.some((s) => s.key === 'branding'));
  assert.ok(sections.some((s) => s.key === 'document_content'));
  assert.ok(sections.every((s) => s.description.trim().length > 0));
});

test('document type style groups default to classic and nodexpro premium', () => {
  const groups = buildDocumentTypeStyleGroups({});
  assert.equal(groups.length, 4);
  assert.ok(groups.every((g) => g.effective_document_style_key === 'classic'));
  assert.ok(groups.every((g) => g.effective_color_theme_key === DEFAULT_COLOR_THEME_KEY));
  assert.equal(DEFAULT_COLOR_THEME_KEY, 'nodexpro_premium');
});

test('document type group overrides resolve effective style for preview', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'classic',
    color_theme_key: 'black_white',
    primary_color: '#111827',
    secondary_color: '#ffffff',
    table_header_color: '#111827',
    totals_color: '#111827',
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
    document_type_style_overrides: {
      tax_group: { document_style_key: 'classic', color_theme_key: 'red' },
    },
  };
  const resolved = resolveBrandingProfileForDocumentTypeGroup(row, { logo_data_url: null, signature_data_url: null }, 'tax_group');
  assert.equal(resolved.color_theme_key, 'red');
  const html = renderStudioSamplePreviewHtml(resolved, 'חשבונית מס');
  assert.match(html, /חשבונית מס/);
  assert.match(html, /לקוח לדוגמה/);
  assert.doesNotMatch(html, /Test4/);
});

test('document style templates expose studio archetypes including sectioned', () => {
  const templates = getDocumentStyleTemplates();
  assert.equal(templates.length, 4);
  assert.deepEqual(
    templates.map((t) => t.key),
    ['classic', 'modern', 'elegant', 'sectioned'],
  );
  assert.ok(templates.every((t) => t.mini_preview_markup.includes('nx-studio-style-mini')));
  assert.ok(templates.some((t) => t.mini_preview_markup.includes('nx-studio-style-mini__banner')));
  assert.ok(templates.some((t) => t.mini_preview_markup.includes('nx-studio-style-mini--modern')));
  assert.ok(templates.some((t) => t.mini_preview_markup.includes('nx-studio-style-mini--elegant')));
  assert.ok(templates.some((t) => t.mini_preview_markup.includes('nx-studio-style-mini--sectioned')));
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
  assert.equal(resolved.color_theme_key, 'dark_blue');
  assert.ok(resolved.color_theme);
});

test('applyColorThemeToColorColumns syncs stored color columns from theme', () => {
  const theme = resolveColorThemePreset('teal')!;
  const cols = applyColorThemeToColorColumns(theme);
  assert.equal(cols.color_theme_key, 'teal');
  assert.equal(cols.table_header_color, theme.table_header_color);
  assert.equal(cols.totals_color, theme.totals_accent_color);
});

test('preview uses unified layout, theme tokens, and draft number label', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: 'סלוגן',
    document_style_key: 'elegant',
    color_theme_key: 'dark_blue',
    primary_color: '#1f559a',
    secondary_color: '#ffffff',
    table_header_color: '#1f559a',
    totals_color: '#1f559a',
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
  assert.match(html, /nx-doc nx-doc--unified/);
  assert.match(html, /nx-doc__upper-sheet/);
  assert.match(html, /nx-doc__sheet-section--1/);
  assert.match(html, /nx-doc__sheet-section--6/);
  assert.match(html, /nx-doc__customer-name/);
  assert.match(html, /nx-doc__summary/);
  assert.match(html, /nx-doc__platform-footer/);
  assert.match(html, /Test4/);
  assert.match(html, /טיוטה/);
  assert.match(html, /Heebo, Arial, Helvetica, "Segoe UI", sans-serif/);
  assert.match(html, />לכבוד</);
  assert.doesNotMatch(html, /type="color"/i);
  assert.doesNotMatch(html, /nx-doc__header--elegant/);
});

test('formatDocumentNumberDisplay shows draft label when no number', () => {
  assert.equal(formatDocumentNumberDisplay(null), 'טיוטה');
  assert.equal(formatDocumentNumberDisplay(''), 'טיוטה');
  assert.equal(formatDocumentNumberDisplay('1001'), '1001');
});

test('legacy black_white theme resolves to nodexpro premium at document render', () => {
  assert.equal(normalizeLegacyDocumentColorThemeKey('black_white'), 'nodexpro_premium');
  assert.equal(normalizeLegacyDocumentColorThemeKey('dark_blue'), 'dark_blue');
});

test('matchColorThemeKeyFromLegacyColors maps known blue palette', () => {
  assert.equal(matchColorThemeKeyFromLegacyColors('#1f4b99', '#1f4b99', '#1f4b99'), 'nodexpro_premium');
  assert.equal(matchColorThemeKeyFromLegacyColors('#5B4DFF', '#5B4DFF', '#5B4DFF'), 'nodexpro_premium');
  assert.equal(matchColorThemeKeyFromLegacyColors('#1f559a', '#1f559a', '#1f559a'), 'dark_blue');
});

test('resolveDocumentStyleTemplate accepts three studio archetypes', () => {
  assert.ok(resolveDocumentStyleTemplate('classic'));
  assert.ok(resolveDocumentStyleTemplate('modern'));
  assert.ok(resolveDocumentStyleTemplate('elegant'));
  assert.equal(resolveDocumentStyleTemplate('minimal')?.key, 'modern');
  assert.equal(resolveDocumentStyleTemplate('classic_blue'), null);
});

test('legacy minimal saved profile resolves to modern without breaking read', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p-min',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'minimal',
    color_theme_key: 'dark_blue',
    primary_color: '#1f559a',
    secondary_color: '#ffffff',
    table_header_color: '#1f559a',
    totals_color: '#1f559a',
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
  assert.equal(normalizeStudioDocumentStyleKey('minimal'), 'modern');
  assert.equal(resolved.document_style_key, 'modern');
});

test('unified preview html applies color theme tokens across document styles', () => {
  const baseRow: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: 'סלוגן',
    document_style_key: 'classic',
    color_theme_key: 'yellow',
    primary_color: '#ffe384',
    secondary_color: '#ffe384',
    table_header_color: '#ffe384',
    totals_color: '#ffe384',
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
  const previewParams = {
    docTypeLabel: 'הצעת מחיר',
    numberPreview: null as string | null,
    issuer: { display_name: 'Test4', tax_id: '123', address: 'רחוב 1', phone: '050', email: 'a@b.c' },
    recipient: { display_name: 'לקוח', tax_id: '999', address: 'כתובת', phone: '052', email: 'c@d.e' },
    document_date: '2026-05-01',
    due_date: null,
    currency: 'ILS',
    lineRows: [] as const,
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
  };

  const classicHtml = renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile(baseRow, { logo_data_url: null, signature_data_url: null }),
    ...previewParams,
  });
  const modernHtml = renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile({ ...baseRow, document_style_key: 'modern' }, { logo_data_url: null, signature_data_url: null }),
    ...previewParams,
  });
  const elegantHtml = renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile({ ...baseRow, document_style_key: 'elegant' }, { logo_data_url: null, signature_data_url: null }),
    ...previewParams,
  });

  for (const html of [classicHtml, modernHtml, elegantHtml]) {
    assert.match(html, /class="nx-doc nx-doc--unified"/);
    assert.match(html, /nx-doc__doc-number/);
    assert.match(html, /nx-doc__bottom/);
    assert.doesNotMatch(html, /class="nx-doc nx-doc--unified nx-doc--sectioned"/);
    assert.doesNotMatch(html, /nx-doc__header--classic/);
    assert.doesNotMatch(html, /nx-doc__header--modern/);
    assert.doesNotMatch(html, /nx-doc__header--elegant/);
  }

  const sectionedHtml = renderIncomeBrandedPreviewHtml({
    branding: resolveBrandingProfile({ ...baseRow, document_style_key: 'sectioned' }, { logo_data_url: null, signature_data_url: null }),
    ...previewParams,
  });
  assert.match(sectionedHtml, /class="nx-doc nx-doc--unified nx-doc--sectioned"/);
  assert.match(sectionedHtml, /nx-doc__doc-number-pill/);
  assert.match(sectionedHtml, /nx-doc__lines/);
  assert.doesNotMatch(sectionedHtml, /<button/);
  assert.notEqual(sectionedHtml, classicHtml);

  const yellowTheme = resolveColorThemePreset('yellow')!;
  const yellowPalette = resolveBrandingPreviewThemePalette(yellowTheme);
  assert.equal(yellowPalette.totals_accent_color, '#ffe384');
  assert.match(classicHtml, /--nx-doc-theme-accent:\s*#ffe384/);
  assert.match(classicHtml, /color: var\(--nx-doc-primary\)/);
  assert.doesNotMatch(classicHtml, /#1f4b99/);
  assert.equal(classicHtml, modernHtml);
  assert.equal(modernHtml, elegantHtml);
});

test('work engine preview css does not hardcode blue on branded grand total', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(
    new URL('../../../web/src/styles/nx-work-engine-queue.css', import.meta.url),
    'utf8',
  );
  const previewPaperRules = css.slice(css.indexOf('/* Backend-owned document HTML'));
  const grandTotalStrongBlock = previewPaperRules.match(
    /\.nx-we-preview-paper__content \.nx-doc__grand-total strong\s*\{[^}]+\}/,
  )?.[0];
  assert.ok(grandTotalStrongBlock, 'expected work engine grand total strong rule');
  assert.doesNotMatch(grandTotalStrongBlock!, /#1f4b99/i);
  assert.match(grandTotalStrongBlock!, /color:\s*var\(--nx-doc-primary\)/);
  assert.doesNotMatch(previewPaperRules, /#1f4b99/i);
  assert.doesNotMatch(previewPaperRules, /\.nx-doc__grand-total\s*\{[^}]*color:/);
  assert.doesNotMatch(previewPaperRules, /\.nx-doc__table thead th/);
});

test('saved document style and theme are reflected in preview html output', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'elegant',
    color_theme_key: 'yellow',
    primary_color: '#ffe384',
    secondary_color: '#ffe384',
    table_header_color: '#ffe384',
    totals_color: '#ffe384',
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
  assert.equal(resolved.document_style_key, 'elegant');
  assert.equal(resolved.color_theme_key, 'yellow');
  const html = renderIncomeBrandedPreviewHtml({
    branding: resolved,
    docTypeLabel: 'חשבונית מס',
    numberPreview: '1001',
    issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
    recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
    document_date: '2026-05-01',
    due_date: '2026-06-01',
    currency: 'ILS',
    lineRows: [],
    totals: {
      subtotal_before_discount: '2,220.51 ₪',
      discount: null,
      subtotal_after_discount: '2,220.51 ₪',
      vat_label: 'מע״מ',
      vat: '375.49 ₪',
      grand_total: '2,596.00 ₪',
    },
    notes: null,
    company_subtitle: null,
  });
  assert.match(html, /nx-doc nx-doc--unified/);
  assert.match(html, /--nx-doc-theme-accent:\s*#ffe384/);
  assert.doesNotMatch(html, /#1f4b99/);
  assert.match(html, /nodexpro\.com/);
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
  assert.match(service, /renderStudioSamplePreviewHtml\(resolved, groupDef\.sample_document_type_label\)/);
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
  assert.match(service, /advanced_layout_visible: false/);
  assert.match(service, /layout_templates: \[\]/);
});

test('studio style UI renders aggregate templates only', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(
    new URL('../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /styleTemplates\.map/);
  assert.doesNotMatch(panel, /מתקדם — פריסת בלוקים/);
  assert.doesNotMatch(panel, /key: 'minimal'/);
  assert.doesNotMatch(panel, /key: "minimal"/);
  assert.doesNotMatch(panel, /layout_template_key/);
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

test('studio sample issuer identity uses placeholder business data only', () => {
  const identity = buildStudioSampleIssuerIdentityPreview();
  assert.equal(identity.business_name, 'שם העסק');
  assert.equal(identity.tax_id, '123456789');
  assert.equal(identity.sample_only_label, 'תצוגת דוגמה בלבד');
  assert.equal(identity.source_badge_label, 'תצוגת דוגמה בלבד');
  assert.match(identity.helper_text ?? '', /דוגמה בלבד/);
});

test('studio sample live preview labels sample-only and uses example customer', () => {
  const row: IncomeBrandingProfileRow = {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'classic',
    primary_color: '#2563eb',
    secondary_color: '#7c3aed',
    table_header_color: '#2563eb',
    totals_color: '#2563eb',
    client_block_position: 'right',
    footer_text: null,
    bank_name: null,
    bank_branch: null,
    bank_account: null,
    iban: null,
    swift: null,
    email_subject_template: null,
    email_body_template: null,
    customer_notes: null,
    terms_and_conditions: null,
    logo_size_key: 'medium',
    color_theme_key: 'professional_blue',
    display_options_json: null,
    payment_methods_json: null,
  };
  const resolved = resolveBrandingProfile(row, { logo_data_url: null, signature_data_url: null });
  const preview = buildStudioSampleLivePreview({
    preview_html: renderStudioSamplePreviewHtml(resolved),
  });
  assert.equal(preview.sample_only_label, 'תצוגת דוגמה בלבד');
  assert.equal(preview.preview_footnote, 'המסמך הסופי נוצר בשרת.');
  assert.match(preview.preview_html, /לקוח לדוגמה/);
  assert.doesNotMatch(preview.preview_html, /Test4/);
});
