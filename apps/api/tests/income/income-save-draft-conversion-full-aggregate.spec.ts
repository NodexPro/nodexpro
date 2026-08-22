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

function saveDraftHandlerBlock(): string {
  const commands = readApi('domains/income/income-commands.service.ts');
  const start = commands.indexOf('if (command === INCOME_COMMAND_SAVE_DRAFT)');
  assert.ok(start >= 0, 'SAVE_DRAFT handler missing');
  const end = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)', start);
  assert.ok(end > start, 'SAVE_DRAFT handler end not found');
  return commands.slice(start, end);
}

test('conversion-sourced SAVE_DRAFT (no reviewContext) returns full aggregate mode', () => {
  const block = saveDraftHandlerBlock();
  assert.ok(block.includes('conversion_source'));
  assert.ok(block.includes('buildIncomeWorkspaceAggregate'));
  assert.ok(block.includes("workspace_aggregate_mode: 'full'"));
  assert.ok(block.includes('recipientOverlayForDraftRow'));
  assert.ok(block.includes('loadWizardDraftRow'));
});

test('conversion-sourced SAVE_DRAFT does not return wizard_patch for that branch', () => {
  const block = saveDraftHandlerBlock();
  const conversionBranchStart = block.indexOf('conversion_source');
  assert.ok(conversionBranchStart >= 0);
  const conversionBranch = block.slice(
    conversionBranchStart,
    block.indexOf('return wizardDraftCommandResponse', conversionBranchStart),
  );
  assert.ok(conversionBranch.includes('buildIncomeWorkspaceAggregate'));
  assert.ok(!conversionBranch.includes('wizardDraftCommandResponse'));
  assert.ok(!conversionBranch.includes("workspace_aggregate_mode: 'wizard_patch'"));
});

test('normal non-conversion SAVE_DRAFT without reviewContext still uses wizard_patch path', () => {
  const block = saveDraftHandlerBlock();
  assert.ok(block.includes('return wizardDraftCommandResponse(ctx, command, scope, {}, overlay)'));
  // Conversion branch is gated; lean path remains the default when conversion_source is absent.
  assert.match(
    block,
    /if \(conversionSource\)[\s\S]*return \{\s*ok:\s*true,[\s\S]*workspace_aggregate_mode:\s*'full'[\s\S]*\}\s*;\s*\}\s*return wizardDraftCommandResponse/,
  );
});

test('retainer / reviewContext SAVE_DRAFT path remains unchanged', () => {
  const block = saveDraftHandlerBlock();
  assert.ok(block.includes('parseRecurringCycleReviewCommandContext(body)'));
  assert.ok(block.includes('refreshRecurringCycleDraftReviewMutationCase'));
  assert.ok(block.includes('includeDraftListAggregates: true'));
  assert.ok(block.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(block.includes('work_engine_invoice_retainer_setup_aggregate'));
  assert.ok(block.includes('work_engine_invoices_tab_aggregate'));
  assert.ok(block.includes('work_engine_invoices_client_documents_by_type_aggregate'));
  // Review path does not force wizard_patch and is independent of conversion full branch.
  const reviewReturn = block.slice(block.indexOf('const refreshed = await refreshRecurringCycleDraftReviewMutationCase'));
  assert.ok(!reviewReturn.includes("workspace_aggregate_mode: 'wizard_patch'"));
  assert.ok(!reviewReturn.includes("workspace_aggregate_mode: 'full'"));
});

test('conversion_source on details step still comes from income_document_conversions', () => {
  const builders = readApi('domains/income/income-document-details-step.builders.ts');
  assert.ok(builders.includes('loadConversionDraftSourceRef'));
  assert.ok(builders.includes(".from('income_document_conversions')"));
  assert.ok(builders.includes('conversion_source: conversionSource'));
  assert.ok(builders.includes('target_draft_id'));
});

test('full aggregate builder supplies schema/branding/recipient truth lean patch omitted', () => {
  const workspace = readApi('domains/income/income-workspace-aggregate.service.ts');
  const fullFn = workspace.slice(
    workspace.indexOf('export async function buildIncomeWorkspaceAggregate'),
    workspace.indexOf('logAggregatePayloadBreakdown(INCOME_WORKSPACE_AGGREGATE_KEY'),
  );
  assert.ok(fullFn.includes('resolveAvailableDocumentTypes'));
  assert.ok(fullFn.includes('buildDocumentCreationSchema'));
  assert.ok(fullFn.includes('buildDocumentBrandingProfileAggregate'));
  assert.ok(fullFn.includes('buildIncomeRecipientSearchModel'));
  assert.ok(fullFn.includes('loadCustomers'));
  assert.ok(fullFn.includes('document_details_step: wizardDraftOverlay.document_details_step'));

  const leanFn = workspace.slice(
    workspace.indexOf('export async function buildIncomeWorkspaceWizardPatchAggregate'),
    workspace.indexOf('export async function buildIncomeWorkspaceAggregate'),
  );
  assert.ok(leanFn.includes("available_document_types: []"));
  assert.ok(leanFn.includes('emptyIncomeTableModel'));
});

test('frontend handleSaveDraft still full-replaces when mode is not wizard_patch', () => {
  const wizard = readWeb('components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx');
  const start = wizard.indexOf('const handleSaveDraft = async');
  assert.ok(start >= 0);
  const block = wizard.slice(start, start + 2500);
  assert.ok(block.includes("workspace_aggregate_mode === 'wizard_patch'"));
  assert.ok(block.includes('mergeIncomeWorkspaceWizardPatch'));
  assert.ok(block.includes('payload.income_workspace_aggregate'));
  // Non-patch branch assigns aggregate directly (full replace).
  assert.match(
    block,
    /workspace_aggregate_mode === 'wizard_patch'\s*\?\s*mergeIncomeWorkspaceWizardPatch\(prev, payload\.income_workspace_aggregate\)\s*:\s*payload\.income_workspace_aggregate/,
  );
});

test('other wizard mutations were not migrated off wizard_patch', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const wizardFn = commands.slice(
    commands.indexOf('async function wizardDraftCommandResponse'),
    commands.indexOf('async function recipientCommandResponse'),
  );
  assert.ok(wizardFn.includes('buildIncomeWorkspaceWizardPatchAggregate'));
  assert.ok(wizardFn.includes("workspace_aggregate_mode: 'wizard_patch'"));
  assert.ok(!wizardFn.includes('buildIncomeWorkspaceAggregate'));

  // Line/settings still go through wizardDraftCmd → wizard_patch.
  assert.ok(commands.includes('return wizardDraftCmd(addIncomeDocumentLine)'));
  assert.ok(commands.includes('return wizardDraftCmd(updateIncomeDocumentDraftSettings)'));
});
