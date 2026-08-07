import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(dir, '../../src', relativePath), 'utf8');
}

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('save_income_document_draft with recurring_cycle_review refreshes review and schedule setup aggregate', () => {
  const incomeCommandsSource = readSource('domains/income/income-commands.service.ts');
  const saveBlockStart = incomeCommandsSource.indexOf('if (command === INCOME_COMMAND_SAVE_DRAFT)');
  const saveBlockEnd = incomeCommandsSource.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)', saveBlockStart);
  const saveBlock = incomeCommandsSource.slice(saveBlockStart, saveBlockEnd);
  assert.ok(saveBlock.includes('parseRecurringCycleReviewCommandContext(body)'));
  assert.ok(saveBlock.includes('refreshRecurringCycleDraftReviewMutationCase'));
  assert.ok(saveBlock.includes('includeDraftListAggregates: true'));
  assert.ok(saveBlock.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(saveBlock.includes('work_engine_invoice_retainer_setup_aggregate'));
  assert.ok(saveBlock.includes('work_engine_invoices_tab_aggregate'));
  assert.ok(saveBlock.includes('work_engine_invoices_client_documents_by_type_aggregate'));
});

test('generate_income_document_preview with recurring_cycle_review refreshes review without draft-list aggregates', () => {
  const incomeCommandsSource = readSource('domains/income/income-commands.service.ts');
  const previewBlockStart = incomeCommandsSource.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)');
  const previewBlockEnd = incomeCommandsSource.indexOf(
    'if (command === INCOME_COMMAND_UPDATE_DISCOUNT)',
    previewBlockStart,
  );
  const previewBlock = incomeCommandsSource.slice(previewBlockStart, previewBlockEnd);
  assert.ok(previewBlock.includes('resolveIncomeWizardMutationIssuerScope'));
  assert.ok(previewBlock.includes('refreshRecurringCycleDraftReviewMutationCase'));
  assert.ok(previewBlock.includes('includeDraftListAggregates: false'));
  assert.ok(previewBlock.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(previewBlock.includes('work_engine_invoice_retainer_setup_aggregate'));
  assert.ok(!previewBlock.includes('work_engine_invoices_client_documents_by_type_aggregate'));
});

test('schedule projection uses generated draft totals for waiting-review cycles', () => {
  const scheduleSource = readSource(
    'domains/work-engine/work-engine-invoice-retainer-schedule-projection.service.ts',
  );
  assert.ok(scheduleSource.includes('loadGeneratedDraftScheduleAmountsById'));
  assert.ok(scheduleSource.includes('scheduleAmountFromDraftTotalsPreview'));
  assert.ok(
    scheduleSource.includes('cycle?.generated_draft_id && !cycle.generated_document_id'),
  );
});

test('editor review Save uses generate_preview; שמור טיוטה uses save_draft; zero hidden GET', () => {
  const editorModalSource = readWebSource(
    'components/work-engine/WorkEngineRecurringCycleDraftReviewModal.tsx',
  );
  const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  assert.ok(editorModalSource.includes('handleReviewSave'));
  assert.ok(editorModalSource.includes('handleSaveAsUserDraft'));
  assert.ok(editorModalSource.includes('recurring_cycle_review:'));
  assert.ok(editorModalSource.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(editorModalSource.includes('work_engine_invoice_retainer_setup_aggregate'));
  assert.ok(!editorModalSource.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
  const saveHandlerStart = setupModalSource.indexOf('const handleCycleDraftEditorSaveSuccess');
  const saveHandlerEnd = setupModalSource.indexOf('const handleGeneratePreview', saveHandlerStart);
  const saveHandlerBlock = setupModalSource.slice(saveHandlerStart, saveHandlerEnd);
  assert.ok(saveHandlerBlock.includes('handleCycleOverrideSetupSaved'));
  assert.ok(!saveHandlerBlock.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
});

test('IncomeCommandResponse exposes refreshed retainer setup aggregate', () => {
  const incomeTypesSource = readSource('domains/income/income.types.ts');
  assert.ok(incomeTypesSource.includes('work_engine_invoice_retainer_setup_aggregate?'));
});
