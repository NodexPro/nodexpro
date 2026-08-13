/**
 * P0 — preliminary-edit preview sync + performance contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const conversionServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.service.ts'),
  'utf8',
);
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
const wizardModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const detailsStepSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
  'utf8',
);
const retainerSetupSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);

test('A/B — Preview flushes pending editor state before generate_income_document_preview', () => {
  assert.match(wizardModalSource, /flushPendingEdits/);
  assert.match(detailsStepSource, /flushPendingEdits/);
  const previewFn = wizardModalSource.slice(
    wizardModalSource.indexOf('const handleGeneratePreview'),
    wizardModalSource.indexOf('const handleGeneratePreview') + 1200,
  );
  const flushIdx = previewFn.indexOf('flushPendingEdits');
  const generateIdx = previewFn.indexOf('generate_preview');
  assert.ok(flushIdx >= 0, 'preview flushes pending edits');
  assert.ok(generateIdx > flushIdx, 'flush happens before generate_preview command');
});

test('C — Preview uses backend totals engine via generateIncomeDocumentPreview staging draft', () => {
  assert.match(draftEditorSource, /export async function generateIncomeDocumentPreview/);
  const genIdx = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const genBody = draftEditorSource.slice(genIdx, genIdx + 1800);
  assert.match(genBody, /loadWizardDraftRow/);
  assert.match(genBody, /wizardDraftMutationOverlay/);
  assert.match(genBody, /preview_generated_at/);
  assert.doesNotMatch(genBody, /income_documents/);
});

test('D/E — Preview does not allocate number / create new document', () => {
  const genIdx = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const genBody = draftEditorSource.slice(genIdx, genIdx + 1800);
  assert.doesNotMatch(genBody, /allocateIncomeDocumentNumber/);
  assert.doesNotMatch(genBody, /\.insert\(\{/);
});

test('F — Save Changes still updates same preliminary document after flush', () => {
  const saveWizard = wizardModalSource.slice(
    wizardModalSource.indexOf('const handleSaveDraft'),
    wizardModalSource.indexOf('const handleSaveDraft') + 1100,
  );
  assert.match(saveWizard, /flushPendingEdits/);
  assert.match(saveWizard, /save_draft/);
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 9000);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
});

test('G — No stale GET after preview/save command; wizard_patch merge is truth', () => {
  assert.match(wizardModalSource, /mergeIncomeWorkspaceWizardPatch/);
  assert.match(wizardModalSource, /workspace_aggregate_mode === 'wizard_patch'/);
  assert.doesNotMatch(
    wizardModalSource.slice(
      wizardModalSource.indexOf('const handleGeneratePreview'),
      wizardModalSource.indexOf('const handleGeneratePreview') + 1600,
    ),
    /fetchIncomeWorkspace|loadAggregate\(/,
  );
});

test('H — Preview source is staging draft, not issued source snapshot', () => {
  const genIdx = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const genEnd = draftEditorSource.indexOf(
    'export async function buildReadOnlyIncomeDocumentPreviewOverlay',
  );
  const genBody = draftEditorSource.slice(genIdx, genEnd > genIdx ? genEnd : genIdx + 900);
  assert.match(genBody, /loadWizardDraftRow/);
  assert.match(genBody, /wizardDraftMutationOverlay/);
  assert.doesNotMatch(genBody, /buildReadOnlyIncomeDocumentPreviewOverlay/);
  assert.doesNotMatch(genBody, /from\('income_documents'\)/);
  assert.match(detailsBuildersSource, /renderUnifiedIncomeDocumentHtml/);
});

test('I — Performance audit: redundant sequential ops identified and removed', () => {
  const buildRespIdx = conversionServiceSource.indexOf('async function buildConversionCommandResponse');
  const buildResp = conversionServiceSource.slice(buildRespIdx, buildRespIdx + 8000);
  assert.match(buildResp, /pencil_lean_open|leanDetails:\s*true/);
  assert.match(buildResp, /skip the unused full aggregate|When a staging\/target draft is present/);
  assert.match(buildResp, /else \{\s*workspace = await buildIncomeWorkspaceAggregate/);

  // wizard_patch skips second branding rebuild
  assert.match(commandsSource, /includeBrandingProfile:\s*false/);

  // non-preview mutations use lean rebuild
  assert.match(draftEditorSource, /lean:\s*!generatingPreview/);
  assert.match(draftEditorSource, /skip_branding_profile_aggregate:\s*true/);
  assert.match(draftEditorSource, /hasRetainerTemplateMarker/);

  // preview payload loads are parallelized
  assert.match(detailsBuildersSource, /await Promise\.all\(\[/);
  assert.match(detailsBuildersSource, /loadIssuerPreviewBlock/);
  assert.match(detailsBuildersSource, /loadResolvedBrandingProfileForDocumentType/);
});

test('J — Pencil open uses lean wizard_patch; conversion still refreshes tab aggregates', () => {
  const buildRespIdx = conversionServiceSource.indexOf('async function buildConversionCommandResponse');
  const buildResp = conversionServiceSource.slice(buildRespIdx, buildRespIdx + 8000);
  assert.match(buildResp, /pencil_lean_open/);
  assert.match(buildResp, /buildIncomeWorkspaceWizardPatchAggregate/);
  assert.match(buildResp, /buildWorkEngineInvoicesTabAggregate/);
  assert.match(buildResp, /work_engine_invoices_tab_aggregate/);
});

test('K — Quote / Deal edit path shares same Preview flush + staging generate', () => {
  assert.match(wizardModalSource, /sessionActions\?\.preview/);
  assert.match(wizardModalSource, /flushPendingEdits/);
  assert.match(detailsStepSource, /lineFlushRegistry|onRegisterFlush/);
});

test('L — Retainer preview path unchanged (retainer setup still owns its own generate)', () => {
  assert.match(retainerSetupSource, /preview_income_recurring_document_profile_settings/);
  assert.doesNotMatch(retainerSetupSource, /detailsStepRef/);
  assert.doesNotMatch(retainerSetupSource, /flushPendingEdits/);
  assert.match(draftEditorSource, /hasRetainerTemplateMarker/);
});

test('Autosave strategy remains debounce + explicit flush (no keystroke flood)', () => {
  assert.match(detailsStepSource, /setTimeout\(flushSettingChange, 400\)/);
  assert.match(detailsStepSource, /setTimeout\(\(\) => \{\s*void runCommand\('update_notes'/);
  assert.match(detailsStepSource, /flushPendingEdits/);
});
