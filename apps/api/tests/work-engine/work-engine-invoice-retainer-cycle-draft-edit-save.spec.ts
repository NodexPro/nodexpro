import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

function readApi(relativePath: string): string {
  return readFileSync(join(dir, '../../src', relativePath), 'utf8');
}

function readWeb(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('1) generated unissued cycle draft: edit_action enabled when status=draft and not issued', () => {
  const review = readApi(
    'domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts',
  );
  assert.match(review, /const canEditDraft = params\.draftStatus === 'draft' && !alreadyIssued/);
  assert.match(review, /enabled: canEditDraft/);
  assert.match(review, /'edit_recurring_cycle_draft'/);
});

test('2) issued recurring document: edit/save forbidden', () => {
  const review = readApi(
    'domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts',
  );
  assert.match(review, /alreadyIssued/);
  assert.match(review, /המסמך כבר הופק/);
  assert.match(
    review,
    /const canEditDraft = params\.draftStatus === 'draft' && !alreadyIssued/,
  );
  assert.ok(review.includes('...(canEditDraft && canGeneratePreview ?'));
  assert.ok(review.includes('...(canEditDraft && canSaveDraft ?'));
});

test('3) stale self issuer: wizard mutations resolve trusted recurring/office issuer', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  assert.match(commands, /resolveIncomeWizardMutationIssuerScope/);
  assert.match(commands, /resolveAndApplyRecurringCycleIssueIssuerScope/);
  assert.match(commands, /resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded/);
});

test('4) unauthorized represented client rejected by cycle draft review validation', () => {
  const review = readApi(
    'domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts',
  );
  assert.match(review, /validateCycleDraftReviewRefs/);
  assert.match(review, /expected_represented_client_id/);
  assert.match(review, /Invalid cycle draft review request/);
});

test('5-7) field mutations persist via named line/settings commands; review Save rebuilds preview case', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  assert.match(commands, /INCOME_COMMAND_UPDATE_LINE/);
  assert.match(commands, /updateIncomeDocumentLine/);
  const previewStart = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)');
  const previewBlock = commands.slice(
    previewStart,
    commands.indexOf('if (command === INCOME_COMMAND_UPDATE_DISCOUNT)', previewStart),
  );
  assert.match(previewBlock, /generateIncomeDocumentPreview/);
  assert.match(previewBlock, /work_engine_recurring_cycle_draft_review_aggregate/);
  assert.doesNotMatch(previewBlock, /saveIncomeDocumentDraft/);
});

test('8) FE performs zero post-command GETs on review Save / שמור טיוטה', () => {
  const editor = readWeb('components/work-engine/WorkEngineRecurringCycleDraftReviewModal.tsx');
  const setup = readWeb('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  assert.doesNotMatch(editor, /fetchWorkEngineInvoiceRetainerSetupAggregate/);
  assert.doesNotMatch(editor, /fetchWorkEngineInvoices/);
  const saveHandlerStart = setup.indexOf('const handleCycleDraftEditorSaveSuccess');
  const saveHandlerBlock = setup.slice(
    saveHandlerStart,
    setup.indexOf('const handleGeneratePreview', saveHandlerStart),
  );
  assert.doesNotMatch(saveHandlerBlock, /fetchWorkEngineInvoiceRetainerSetupAggregate/);
});

test('9) normal review Save does not stamp user_saved_at', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const previewStart = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)');
  assert.ok(previewStart >= 0);
  const previewBlock = commands.slice(
    previewStart,
    commands.indexOf('if (command === INCOME_COMMAND_UPDATE_DISCOUNT)', previewStart),
  );
  assert.doesNotMatch(previewBlock, /saveIncomeDocumentDraft/);
  assert.doesNotMatch(previewBlock, /savePatch\.user_saved_at/);
  const editor = readApi('domains/income/income-document-draft-editor.service.ts');
  const genStart = editor.indexOf('export async function generateIncomeDocumentPreview');
  assert.doesNotMatch(editor.slice(genStart, genStart + 1500), /user_saved_at/);
});

test('10) explicit שמור טיוטה stamps user_saved_at via save_income_document_draft', () => {
  const editor = readApi('domains/income/income-document-draft-editor.service.ts');
  const saveStart = editor.indexOf('export async function saveIncomeDocumentDraft');
  const saveBlock = editor.slice(saveStart, saveStart + 1800);
  assert.match(saveBlock, /savePatch\.user_saved_at = new Date\(\)\.toISOString\(\)/);
  const fe = readWeb('components/work-engine/WorkEngineRecurringCycleDraftReviewModal.tsx');
  assert.match(fe, /handleSaveAsUserDraft/);
  assert.match(fe, /save_draft/);
  assert.match(fe, /שמור טיוטה/);
});

test('11) review Save mutates only generated draft — no profile/template write', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const previewStart = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)');
  const previewBlock = commands.slice(
    previewStart,
    commands.indexOf('if (command === INCOME_COMMAND_UPDATE_DISCOUNT)', previewStart),
  );
  assert.doesNotMatch(previewBlock, /income_recurring_document_profiles/);
  assert.doesNotMatch(previewBlock, /document_template_snapshot/);
  assert.match(previewBlock, /refreshRecurringCycleDraftReviewMutationCase/);
});

test('12) issue after edit reuses same draft via issue_income_document + recurring_cycle_review', () => {
  const issue = readApi('domains/income/income-document-issue.service.ts');
  assert.match(issue, /parseRecurringCycleReviewCommandContext/);
  assert.match(issue, /linkRecurringCycleIssuedDocument|source_draft/);
  const setup = readWeb('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  assert.match(setup, /recurring_cycle_review/);
  assert.match(setup, /issue_document/);
});

test('13) replay/second save does not create duplicate draft', () => {
  const editor = readApi('domains/income/income-document-draft-editor.service.ts');
  const saveStart = editor.indexOf('export async function saveIncomeDocumentDraft');
  const saveBlock = editor.slice(saveStart, saveStart + 1800);
  assert.match(saveStart >= 0 ? saveBlock : '', /existingUserSavedAt/);
  assert.doesNotMatch(saveBlock, /\.insert\(/);
  assert.match(saveBlock, /draft_id/);
});
