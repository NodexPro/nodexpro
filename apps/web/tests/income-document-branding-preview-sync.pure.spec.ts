import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrandingPreviewDraftBody } from '../src/components/income/IncomeDocumentBrandingSettingsPanel.tsx';
import type { IncomeBrandingStudioDraft } from '../src/income/income-document-branding-types.ts';
import {
  fingerprintBrandingPreviewDraft,
  mergePreviewDraftSelectionIntoDraft,
  shouldScheduleBrandingPreviewRequest,
} from '../src/income/income-document-branding-preview-sync.pure.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');

function sampleDraft(overrides: Partial<IncomeBrandingStudioDraft> = {}): IncomeBrandingStudioDraft {
  return {
    document_style_key: 'classic',
    color_theme_key: 'black_white',
    logo_size_key: 'medium',
    selected_document_type_group_key: 'tax_invoices',
    document_type_style_overrides: {
      tax_invoices: { document_style_key: 'classic', color_theme_key: 'black_white' },
    },
    show_logo: 'true',
    show_signature: 'true',
    show_footer: 'true',
    show_notes: 'true',
    show_payment_terms: 'true',
    show_bank_details: 'true',
    show_due_date: 'true',
    show_vat_row: 'true',
    payment_method_bank_transfer: 'true',
    payment_method_credit_card: 'false',
    payment_method_cash: 'false',
    payment_method_check: 'false',
    payment_method_paypal: 'false',
    payment_method_bit: 'false',
    company_subtitle: '',
    footer_text: '',
    bank_name: '',
    bank_branch: '',
    bank_account: '',
    iban: '',
    swift: '',
    payment_instructions: '',
    email_subject_friendly: 'subject',
    email_body_friendly: 'body',
    customer_notes: '',
    terms_and_conditions: '',
    ...overrides,
  };
}

test('fingerprint is stable for same preview-draft fields regardless of override key insertion order', () => {
  const a = sampleDraft({
    document_type_style_overrides: {
      tax_invoices: { document_style_key: 'classic', color_theme_key: 'black_white' },
      receipts: { document_style_key: 'sectioned', color_theme_key: 'navy' },
    },
  });
  const b = sampleDraft({
    document_type_style_overrides: {
      receipts: { document_style_key: 'sectioned', color_theme_key: 'navy' },
      tax_invoices: { document_style_key: 'classic', color_theme_key: 'black_white' },
    },
  });
  assert.equal(
    fingerprintBrandingPreviewDraft(a, buildBrandingPreviewDraftBody),
    fingerprintBrandingPreviewDraft(b, buildBrandingPreviewDraftBody),
  );
});

test('fingerprint changes when a preview-affecting field changes', () => {
  const base = sampleDraft();
  const edited = sampleDraft({ footer_text: 'שורה חדשה' });
  assert.notEqual(
    fingerprintBrandingPreviewDraft(base, buildBrandingPreviewDraftBody),
    fingerprintBrandingPreviewDraft(edited, buildBrandingPreviewDraftBody),
  );
});

test('initial hydration fingerprint must not schedule a preview request', () => {
  const draft = sampleDraft();
  const fp = fingerprintBrandingPreviewDraft(draft, buildBrandingPreviewDraftBody);
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: fp,
      lastAppliedFingerprint: fp,
    }),
    false,
  );
});

test('identical writeback after preview must not schedule again', () => {
  const draft = sampleDraft();
  const fp = fingerprintBrandingPreviewDraft(draft, buildBrandingPreviewDraftBody);
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: fp,
      lastAppliedFingerprint: fp,
    }),
    false,
  );
});

test('one preview-affecting edit schedules exactly when fingerprint differs', () => {
  const before = sampleDraft();
  const after = sampleDraft({ show_logo: 'false' });
  const beforeFp = fingerprintBrandingPreviewDraft(before, buildBrandingPreviewDraftBody);
  const afterFp = fingerprintBrandingPreviewDraft(after, buildBrandingPreviewDraftBody);
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: afterFp,
      lastAppliedFingerprint: beforeFp,
    }),
    true,
  );
});

test('two different edits produce two distinct fingerprints (two preview opportunities)', () => {
  const a = fingerprintBrandingPreviewDraft(sampleDraft({ footer_text: 'A' }), buildBrandingPreviewDraftBody);
  const b = fingerprintBrandingPreviewDraft(sampleDraft({ footer_text: 'B' }), buildBrandingPreviewDraftBody);
  assert.notEqual(a, b);
});

test('mergePreviewDraftSelectionIntoDraft returns same reference when selection unchanged', () => {
  const draft = sampleDraft({
    selected_document_type_group_key: 'tax_invoices',
    document_style_key: 'classic',
    color_theme_key: 'black_white',
  });
  const merged = mergePreviewDraftSelectionIntoDraft(draft, {
    selected_document_type_group_key: 'tax_invoices',
    selected_document_style_key: 'classic',
    selected_color_theme_key: 'black_white',
  });
  assert.equal(merged, draft);
});

test('simulated open→response cycle does not re-request when selection echo matches', () => {
  let lastApplied: string | null = null;
  let requestCount = 0;

  const hydrated = sampleDraft();
  lastApplied = fingerprintBrandingPreviewDraft(hydrated, buildBrandingPreviewDraftBody);

  // Idle after open: no schedule
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: fingerprintBrandingPreviewDraft(hydrated, buildBrandingPreviewDraftBody),
      lastAppliedFingerprint: lastApplied,
    }),
    false,
  );

  // User edit
  const edited = sampleDraft({ company_subtitle: 'Acme' });
  const editedFp = fingerprintBrandingPreviewDraft(edited, buildBrandingPreviewDraftBody);
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: editedFp,
      lastAppliedFingerprint: lastApplied,
    }),
    true,
  );
  requestCount += 1;
  lastApplied = editedFp;

  // Apply response selection echo (same values) — must not schedule again
  const afterEcho = mergePreviewDraftSelectionIntoDraft(edited, {
    selected_document_type_group_key: edited.selected_document_type_group_key,
    selected_document_style_key: edited.document_style_key,
    selected_color_theme_key: edited.color_theme_key,
  });
  assert.equal(afterEcho, edited);
  assert.equal(
    shouldScheduleBrandingPreviewRequest({
      canPreview: true,
      busy: false,
      draftFingerprint: fingerprintBrandingPreviewDraft(afterEcho, buildBrandingPreviewDraftBody),
      lastAppliedFingerprint: lastApplied,
    }),
    false,
  );
  assert.equal(requestCount, 1);
});

test('panel still renders backend studio_live_preview.preview_html (no FE-generated HTML)', () => {
  const panelSrc = readFileSync(
    join(webRoot, 'src/components/income/IncomeDocumentBrandingSettingsPanel.tsx'),
    'utf8',
  );
  assert.match(panelSrc, /preview\.preview_html/);
  assert.match(panelSrc, /dangerouslySetInnerHTML=\{\{\s*__html:\s*preview\.preview_html\s*\}\}/);
  assert.doesNotMatch(panelSrc, /renderStudioSamplePreviewHtml|renderIncomeBrandedPreviewHtml/);
  assert.match(panelSrc, /fingerprintBrandingPreviewDraft/);
  assert.match(panelSrc, /shouldScheduleBrandingPreviewRequest/);
  assert.match(panelSrc, /mergePreviewDraftSelectionIntoDraft/);
  assert.match(panelSrc, /lastAppliedPreviewFingerprintRef/);
  assert.match(panelSrc, /previewRequestRef/);
});

test('preview draft command remains update_income_document_branding_profile_preview_draft', () => {
  const incomeApi = readFileSync(join(webRoot, 'src/api/income.ts'), 'utf8');
  assert.match(incomeApi, /update_income_document_branding_profile_preview_draft/);
  const types = readFileSync(join(webRoot, 'src/income/income-document-branding-types.ts'), 'utf8');
  assert.match(types, /command:\s*'update_income_document_branding_profile_preview_draft'/);
});

test('Branding Studio CSS: tighter gutters, gap, and 12/37/51 columns', () => {
  const css = readFileSync(join(webRoot, 'src/styles/nx-branding-studio.css'), 'utf8');
  assert.match(css, /\.nx-income-branding-overlay--studio\s*\{[^}]*padding:\s*20px\s+12px;/s);
  assert.match(css, /\.nx-income-branding-modal--studio\s*\{[^}]*calc\(100vw\s*-\s*24px\)/s);
  assert.match(css, /\.nx-income-branding-modal--studio\s*\{[^}]*calc\(100vh\s*-\s*40px\)/s);
  assert.match(css, /\.nx-branding-studio\s*\{[^}]*grid-template-columns:\s*12%\s+37%\s+51%;/s);
  assert.match(css, /\.nx-branding-studio\s*\{[^}]*gap:\s*12px;/s);
  // Tablet/mobile fallback preserved (single column)
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*\.nx-branding-studio\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test('global .nx-modal not redefined in Branding Studio stylesheet', () => {
  const css = readFileSync(join(webRoot, 'src/styles/nx-branding-studio.css'), 'utf8');
  assert.doesNotMatch(css, /(^|\n)\.nx-modal\s*\{/);
});

test('canonical sectioned document renderer remains server-side (API file present, panel does not invent HTML)', () => {
  const panelSrc = readFileSync(
    join(webRoot, 'src/components/income/IncomeDocumentBrandingSettingsPanel.tsx'),
    'utf8',
  );
  assert.doesNotMatch(panelSrc, /nx-doc--sectioned/);
  const saveBody = readFileSync(
    join(webRoot, 'src/components/income/IncomeDocumentBrandingSettingsPanel.tsx'),
    'utf8',
  );
  assert.match(saveBody, /export function buildBrandingModalSaveBody/);
});
