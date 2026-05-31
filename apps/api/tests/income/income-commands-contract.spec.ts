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

test('issue_income_document command is registered', () => {
  assert.match(commandsSource, /INCOME_COMMAND_ISSUE_DOCUMENT/);
  assert.match(commandsSource, /executeIssueIncomeDocument/);
});

test('workspace aggregate includes issued documents table', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /issued_documents_table_model/);
  assert.match(workspaceSource, /loadIssuedDocuments/);
  assert.match(workspaceSource, /income_documents/);
});

test('retry_income_document_accounting_posting command is registered', () => {
  assert.match(commandsSource, /INCOME_COMMAND_RETRY_ACCOUNTING_POSTING/);
  assert.match(commandsSource, /retryAccountingPostingForIssuedDocument/);
});

test('issued document rows expose accounting_posting_status', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /accounting_posting_status/);
  assert.match(workspaceSource, /accounting_status_label/);
});

test('retry_income_document_pdf_render command is registered', () => {
  assert.match(commandsSource, /INCOME_COMMAND_RETRY_PDF_RENDER/);
  assert.match(commandsSource, /renderIncomeDocumentPdf/);
});

test('issued document rows expose pdf_render_status', () => {
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /pdf_render_status/);
  assert.match(typesSource, /pdf_download_path/);
  assert.match(workspaceSource, /pdf_status_label/);
});

test('resume_income_document_draft command is registered and returns starting step key', () => {
  assert.match(commandsSource, /INCOME_COMMAND_RESUME_DRAFT/);
  assert.match(commandsSource, /resumeIncomeDocumentDraftFromContext/);
  assert.match(commandsSource, /starting_step_key/);
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(typesSource, /wizard_starting_step_key\?:\s*string\s*\|\s*null/);
});

test('generate_income_document_preview command is registered and returns wizard_patch', () => {
  assert.match(commandsSource, /INCOME_COMMAND_GENERATE_PREVIEW/);
  assert.match(commandsSource, /generateIncomeDocumentPreview/);
  assert.match(commandsSource, /wizard_patch/);
  const detailsSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
    'utf8',
  );
  assert.match(detailsSource, /buildIncomeIssuerSnapshotForScope/);
  assert.doesNotMatch(detailsSource, /from\('clients'\)[\s\S]*address_json/);
});

test('update_income_document_discount command is registered', () => {
  assert.match(commandsSource, /INCOME_COMMAND_UPDATE_DISCOUNT/);
  assert.match(commandsSource, /updateIncomeDocumentDiscount/);
  const detailsSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
    'utf8',
  );
  assert.match(detailsSource, /document_discount/);
  assert.match(detailsSource, /totals_block/);
});

test('document branding aggregate exposes document style presets', async () => {
  const { readFile } = await import('node:fs/promises');
  const types = await readFile(
    new URL('../../src/domains/income/income-document-branding.types.ts', import.meta.url),
    'utf8',
  );
  assert.match(types, /document_style_presets/);
  assert.match(types, /selected_document_style_key/);
  assert.match(types, /document_style_key/);
});

test('document branding profile commands and aggregate are registered', () => {
  assert.match(commandsSource, /INCOME_COMMAND_UPDATE_BRANDING_PROFILE/);
  assert.match(commandsSource, /INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO/);
  assert.match(commandsSource, /INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE/);
  assert.match(commandsSource, /executeUploadIncomeDocumentLogo/);
  const detailsSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
    'utf8',
  );
  assert.match(detailsSource, /document_branding_profile/);
  assert.match(detailsSource, /renderIncomeBrandedPreviewHtml/);
  assert.doesNotMatch(detailsSource, /PROG4BIZ/);
});

test('income workspace aggregate exposes document branding settings entrypoint', () => {
  const aggSource = readFileSync(
    join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
    'utf8',
  );
  const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');
  assert.match(aggSource, /document_branding_profile/);
  assert.match(aggSource, /document_branding_settings_entrypoint/);
  assert.match(aggSource, /buildDocumentBrandingSettingsEntrypoint/);
  assert.match(typesSource, /document_branding_settings_entrypoint/);
  assert.match(commandsSource, /brandingCommandResponse/);
});
