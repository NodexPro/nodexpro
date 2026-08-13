/**
 * P0 — preliminary-edit Preview + Save 409 contract (A–J).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  allowedConversionTargetsForSource,
  buildPreliminaryDocumentEditMode,
  buildWizardSessionActions,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const supabaseErrorsSource = readFileSync(
  join(dir, '../../src/shared/supabase-errors.ts'),
  'utf8',
);
const wizardModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const detailsStepSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
  'utf8',
);
const migration159 = readFileSync(
  join(dir, '../../../../supabase/migrations/159_income_preliminary_document_edit_in_place.sql'),
  'utf8',
);

const quoteSettings = {
  vat_mode: 'standard',
  [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'quote-doc-123',
};

function generatePreviewFn(): string {
  const start = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const end = draftEditorSource.indexOf(
    'export async function buildReadOnlyIncomeDocumentPreviewOverlay',
  );
  return draftEditorSource.slice(start, end > start ? end : start + 2200);
}

function saveInPlaceFn(): string {
  const start = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  return draftEditorSource.slice(start, start + 12000);
}

function previewHandler(): string {
  const start = wizardModalSource.indexOf('const handleGeneratePreview');
  return wizardModalSource.slice(start, start + 2200);
}

function saveHandler(): string {
  const start = wizardModalSource.indexOf('const handleSaveDraft');
  return wizardModalSource.slice(start, start + 1400);
}

test('A — Preview from edited Deal Invoice opens ready-to-print current document', () => {
  const previewFn = previewHandler();
  assert.match(previewFn, /flushPendingEdits/);
  assert.match(previewFn, /generate_preview/);
  assert.match(wizardModalSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.match(wizardModalSource, /readyToPrintPreviewOpen/);
  assert.match(previewFn, /footerActions\?\.mode === 'preliminary_edit'/);
  assert.match(previewFn, /setReadyToPrintPreviewOpen\(true\)/);
  assert.match(detailsBuildersSource, /renderUnifiedIncomeDocumentHtml/);
  assert.match(generatePreviewFn(), /wizardDraftMutationOverlay/);
  assert.doesNotMatch(generatePreviewFn(), /savePreliminaryDocumentEditIfNeeded/);
});

test('B — Preview includes dirty line without ✓', () => {
  const previewFn = previewHandler();
  const flushIdx = previewFn.indexOf('flushPendingEdits');
  const generateIdx = previewFn.indexOf('generate_preview');
  assert.ok(flushIdx >= 0 && generateIdx > flushIdx);
  assert.match(detailsStepSource, /lineFlushRegistry|onRegisterFlush/);
  assert.match(detailsStepSource, /if \(registration\.isDirty\(\)\)/);
});

test('C — Preview preserves original number', () => {
  assert.match(draftEditorSource, /loadPreliminaryEditSourceDocumentNumber/);
  assert.match(detailsBuildersSource, /preliminarySourceIdentity\?\.document_number/);
  assert.match(
    detailsBuildersSource,
    /!preliminaryEditSourceId && row\.document_type != null/,
  );
  const genBody = generatePreviewFn();
  assert.match(genBody, /document_number_preview: cachedDocumentNumber/);
  assert.doesNotMatch(genBody, /allocateIncomeDocumentNumber/);
  assert.doesNotMatch(genBody, /previewNextIncomeDocumentNumber/);
});

test('D — Save updates same source row', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveHandler(), /flushPendingEdits/);
  assert.match(saveHandler(), /save_draft/);
  assert.match(saveBody, /\.from\('income_documents'\)[\s\S]*\.update\(\{/);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.doesNotMatch(saveBody, /\.insert\(\{/);
});

test('E — Save preserves number', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /document_number:\s*source\.document_number/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
  assert.match(migration159, /NEW\.document_number is not distinct from OLD\.document_number/);
});

test('F — Save creates no second document', () => {
  const saveBody = saveInPlaceFn();
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
  assert.doesNotMatch(saveBody, /income_document_conversions/);
  assert.doesNotMatch(saveBody, /\.from\('income_documents'\)[\s\S]*\.insert\(\{/);
});

test('G — 409 root cause fixed (159 first-branch identity pins + mapped trigger)', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /document_status:\s*'issued'/);
  assert.match(saveBody, /actor_user_id:\s*source\.actor_user_id/);
  assert.match(saveBody, /source_draft_id:\s*source\.source_draft_id/);
  assert.match(saveBody, /accounting_posting_status:\s*source\.accounting_posting_status/);
  assert.match(saveBody, /cancelled_at:\s*source\.cancelled_at/);
  assert.match(saveBody, /save_preliminary_edit:update_income_documents/);
  assert.match(supabaseErrorsSource, /INCOME_DOCUMENT_IMMUTABLE_AFTER_ISSUE/);
  assert.match(migration159, /OLD\.document_type in \('quote', 'deal_invoice'\)/);
  assert.match(migration159, /NEW\.document_status = 'issued'/);
});

test('H — normal new-document wizard unchanged', () => {
  const normal = buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: null,
  });
  assert.equal(normal.footer.mode, 'wizard');
  assert.equal(normal.footer.show_back, true);
  assert.equal(normal.footer.show_next, true);
  assert.equal(normal.footer.show_issue, true);
  assert.equal(normal.save.label, 'שמירת טיוטה');
  const previewFn = previewHandler();
  assert.match(previewFn, /advanceToPreview && previewStepIndex >= 0/);
  assert.match(previewFn, /setStepIndex\(previewStepIndex\)/);
});

test('I — Quote edit works same way as Deal Invoice', () => {
  assert.equal(isPreliminaryEditableType('quote'), true);
  assert.equal(isPreliminaryEditableType('deal_invoice'), true);
  for (const documentType of ['quote', 'deal_invoice'] as const) {
    const actions = buildWizardSessionActions({
      canEdit: true,
      canIssue: true,
      editMode: buildPreliminaryDocumentEditMode({
        documentSettingsJson: quoteSettings,
        documentType,
        documentNumberPreview: '88',
      }),
    });
    assert.equal(actions.footer.mode, 'preliminary_edit');
    assert.equal(actions.preview.command, 'generate_income_document_preview');
    assert.equal(actions.save.command, 'save_income_document_draft');
    assert.equal(actions.footer.show_issue, false);
  }
  assert.match(commandsSource, /INCOME_COMMAND_GENERATE_PREVIEW/);
  assert.match(commandsSource, /INCOME_COMMAND_SAVE_DRAFT/);
});

test('J — Tax invoices unchanged', () => {
  assert.equal(isPreliminaryEditableType('tax_invoice'), false);
  assert.equal(isPreliminaryEditableType('tax_invoice_receipt'), false);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});
