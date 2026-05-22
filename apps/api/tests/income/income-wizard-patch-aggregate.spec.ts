import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const workspaceSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);

test('wizard draft commands use lightweight wizard_patch aggregate builder', () => {
  assert.ok(commandsSource.includes('buildIncomeWorkspaceWizardPatchAggregate'));
  assert.ok(commandsSource.includes("workspace_aggregate_mode: 'wizard_patch'"));
  const fnBody = commandsSource.slice(
    commandsSource.indexOf('async function wizardDraftCommandResponse'),
    commandsSource.indexOf('async function recipientCommandResponse'),
  );
  assert.ok(fnBody.includes('buildIncomeWorkspaceWizardPatchAggregate'));
  assert.ok(!fnBody.includes('buildIncomeWorkspaceAggregate'));
});

test('wizard patch aggregate skips heavy workspace table loads', () => {
  assert.ok(workspaceSource.includes('buildIncomeWorkspaceWizardPatchAggregate'));
  assert.ok(workspaceSource.includes('emptyIncomeTableModel'));
  const fnBody = workspaceSource.slice(
    workspaceSource.indexOf('export async function buildIncomeWorkspaceWizardPatchAggregate'),
    workspaceSource.indexOf('export async function buildIncomeWorkspaceAggregate'),
  );
  assert.ok(!fnBody.includes('loadIssuedDocuments'));
  assert.ok(!fnBody.includes('loadCustomers'));
  assert.ok(!fnBody.includes('countScoped'));
});

test('line mutations share single validation + overlay build path', () => {
  assert.ok(draftEditorSource.includes('wizardDraftMutationOverlay'));
  assert.ok(draftEditorSource.includes('document_number_preview'));
  assert.ok(draftEditorSource.includes('recipient_display_name'));
});
