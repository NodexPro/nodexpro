/**
 * P0 — preliminary-edit simple UX + save 500 + lean response contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  buildPreliminaryDocumentEditMode,
  buildWizardSessionActions,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
  allowedConversionTargetsForSource,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const conversionServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.service.ts'),
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
const byTypeModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);

const quoteSettings = {
  vat_mode: 'standard',
  [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'quote-doc-123',
};

function preliminaryActions() {
  return buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: buildPreliminaryDocumentEditMode({
      documentSettingsJson: quoteSettings,
      documentType: 'quote',
      documentNumberPreview: '123',
    }),
  });
}

test('A — preliminary edit shows ONLY Preview + Save bottom buttons', () => {
  const actions = preliminaryActions();
  assert.equal(actions.footer.mode, 'preliminary_edit');
  assert.equal(actions.footer.show_preview, true);
  assert.equal(actions.footer.show_save, true);
  assert.equal(actions.preview.label, 'תצוגה מקדימה');
  assert.equal(actions.save.label, 'שמירה');
  assert.match(wizardModalSource, /footerActions\?\.mode === 'preliminary_edit'/);
  assert.match(wizardModalSource, /sessionActions\?\.preview\?\.label/);
  assert.match(wizardModalSource, /sessionActions\?\.save\?\.label/);
});

test('B — no הבא / הקודם / Issue / duplicate Save in edit mode', () => {
  const actions = preliminaryActions();
  assert.equal(actions.footer.show_back, false);
  assert.equal(actions.footer.show_next, false);
  assert.equal(actions.footer.show_issue, false);
  assert.equal(actions.issue.enabled, false);
  assert.equal(actions.issue_and_send.enabled, false);
  assert.match(wizardModalSource, /showBack && stepIndex > 0/);
  assert.match(wizardModalSource, /showNext && !isLastStep/);
  assert.match(wizardModalSource, /showIssue && isLastStep/);
  assert.doesNotMatch(wizardModalSource, /סיום/);
});

test('C — header has X icon, no textual סגירה in edit mode', () => {
  const actions = preliminaryActions();
  assert.equal(actions.footer.close_control, 'icon');
  assert.match(wizardModalSource, /closeControl === 'icon' \? '×' : 'סגירה'/);
});

test('D/E — Preview and Save flush dirty line without ✓', () => {
  const previewFn = wizardModalSource.slice(
    wizardModalSource.indexOf('const handleGeneratePreview'),
    wizardModalSource.indexOf('const handleGeneratePreview') + 1400,
  );
  const saveFn = wizardModalSource.slice(
    wizardModalSource.indexOf('const handleSaveDraft'),
    wizardModalSource.indexOf('const handleSaveDraft') + 1400,
  );
  assert.match(previewFn, /flushPendingEdits/);
  assert.match(saveFn, /flushPendingEdits/);
  assert.match(detailsStepSource, /lineFlushRegistry|onRegisterFlush/);
  assert.match(detailsStepSource, /flushPendingEdits/);
});

test('F/G/H — Save updates same source document and number, no second row', () => {
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 9000);
  assert.match(saveBody, /\.from\('income_documents'\)[\s\S]*\.update\(\{/);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber|\.insert\(\{/);
  assert.match(saveBody, /lines_snapshot_json:\s*validation\.draft_lines_json/);
  assert.match(saveBody, /totals_snapshot_json:\s*totalsSnapshot/);
});

test('I — production Save 500 root cause mapped + lean overlay after in-place update', () => {
  assert.match(
    supabaseErrorsSource,
    /INCOME_DOCUMENT_IMMUTABLE_AFTER_ISSUE/,
  );
  assert.match(draftEditorSource, /save_preliminary_edit:update_income_documents/);
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 12000);
  assert.match(saveBody, /lean:\s*true/);
  assert.match(saveBody, /skip_branding_profile_aggregate:\s*true/);
  assert.match(draftEditorSource, /throwIfSupabaseError\(error, 'persistWizardDraft'\)/);
});

test('J/K — normal edit mutation response has no Branding Studio / no 5MB payload', () => {
  assert.match(commandsSource, /includeBrandingProfile:\s*false/);
  assert.match(draftEditorSource, /skip_branding_profile_aggregate:\s*true/);
  assert.match(commandsSource, /serialized_workspace_bytes/);
  assert.match(commandsSource, /has_studio_live_preview/);
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveTail = draftEditorSource.slice(saveIdx, saveIdx + 12000);
  assert.match(saveTail, /skip_branding_profile_aggregate:\s*true/);
});

test('L — Pencil hot path no duplicate full workspace', () => {
  const buildIdx = conversionServiceSource.indexOf('async function buildConversionCommandResponse');
  const buildBody = conversionServiceSource.slice(buildIdx, buildIdx + 4500);
  assert.match(buildBody, /pencil_lean_open/);
  assert.match(buildBody, /leanDetails:\s*true/);
  assert.match(buildBody, /buildIncomeWorkspaceWizardPatchAggregate/);
  assert.match(buildBody, /includeBrandingProfile:\s*false/);
  assert.match(byTypeModalSource, /if \(res\.work_engine_invoices_tab_aggregate\)/);
  const editFn = byTypeModalSource.slice(
    byTypeModalSource.indexOf('const handleEditPreliminary'),
    byTypeModalSource.indexOf('const handleConvert'),
  );
  assert.doesNotMatch(editFn, /refreshInvoicesTabFromCommand/);
});

test('M — normal new-document wizard remains unchanged', () => {
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
  assert.equal(normal.footer.close_control, 'text');
});

test('N — tax documents unchanged', () => {
  assert.equal(isPreliminaryEditableType('tax_invoice'), false);
  assert.equal(isPreliminaryEditableType('tax_invoice_receipt'), false);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
});

test('O — conversion + unchanged', () => {
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.match(conversionServiceSource, /path: 'conversion_full'/);
});
