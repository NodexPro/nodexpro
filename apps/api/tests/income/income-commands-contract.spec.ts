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

test('income commands do not import Accounting Base', () => {
  assert.doesNotMatch(commandsSource, /accounting-base|accounting_base/i);
});

test('income commands do not import Work Engine', () => {
  assert.doesNotMatch(commandsSource, /work-engine|work_engine/i);
});

test('income commands do not import DocFlow', () => {
  assert.doesNotMatch(commandsSource, /from\s+['"].*docflow/i);
});

test('command response type includes income_workspace_aggregate', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /income_workspace_aggregate:\s*IncomeWorkspaceAggregate/);
});

test('select issuer command response includes both context and workspace aggregates', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(
    typesSource,
    /income_workspace_context_aggregate:\s*IncomeWorkspaceContextAggregate[\s\S]*income_workspace_aggregate:\s*IncomeWorkspaceAggregate/,
  );
  assert.match(commandsSource, /selectIssuerContextCommandResponse/);
  assert.match(commandsSource, /buildIncomeWorkspaceContextAggregate/);
});

test('workspace aggregate builder scopes queries by issuer', () => {
  assert.match(workspaceSource, /applyIssuerScopeToBuilder/);
  assert.match(workspaceSource, /represented_client_id/);
});

test('workspace aggregate includes available_document_types and document_creation_schema', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /available_document_types:\s*IncomeAvailableDocumentType\[\]/);
  assert.match(typesSource, /document_creation_schema:\s*IncomeDocumentCreationSchema/);
  assert.match(workspaceSource, /resolveAvailableDocumentTypes/);
});
