import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeDocumentAllocationNumberField,
  defaultIncomeTaxAllocationNumberPolicy,
} from '../../src/domains/income/income-document-allocation-number.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const previewStepSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomePreviewStep.tsx'),
  'utf8',
);
const previewSidebarSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentPreviewSidebar.tsx'),
  'utf8',
);
const retainerPreviewModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx'),
  'utf8',
);
const wizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const retainerSetupSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const metaRowSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeAllocationNumberMetaRow.tsx'),
  'utf8',
);
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-branding-preview.renderer.ts'),
  'utf8',
);

test('income wizard allocation sidebar uses backend display_value and editable flag', () => {
  assert.match(previewSidebarSource, /allocation_number_field/);
  assert.match(previewSidebarSource, /WorkEngineIncomeAllocationNumberMetaRow/);
  assert.match(metaRowSource, /field\.display_value/);
  assert.match(metaRowSource, /field\.editable/);
  assert.match(metaRowSource, /field\.tooltip/);
  assert.match(metaRowSource, /field\.disabled_reason/);
  assert.match(previewStepSource, /WorkEngineIncomeDocumentPreviewSidebar/);
  assert.doesNotMatch(previewSidebarSource, /shouldShow.*allocation/i);
});

test('income wizard pencil appears next to allocation label in metadata row', () => {
  assert.match(previewSidebarSource, /WorkEngineIncomeAllocationNumberMetaRow/);
  assert.match(metaRowSource, /nx-we-preview-sidebar__label-group/);
  assert.match(metaRowSource, /field\.label/);
  assert.doesNotMatch(rendererSource, /nx-we-preview-sidebar__edit-btn/);
  assert.doesNotMatch(rendererSource, /docPreviewIcon\('edit'\)/);
});

test('retainer preview modal renders one document canvas without sidebar', () => {
  assert.doesNotMatch(retainerPreviewModalSource, /WorkEngineIncomeDocumentPreviewSidebar/);
  assert.doesNotMatch(retainerPreviewModalSource, /nx-we-preview-sidebar/);
  assert.doesNotMatch(retainerPreviewModalSource, /documentDetailsStep/);
  assert.doesNotMatch(retainerPreviewModalSource, /nx-we-preview-layout/);
  assert.match(retainerPreviewModalSource, /nx-we-retainer-preview-modal__canvas/);
  assert.match(retainerPreviewModalSource, /nx-we-preview-paper__content/);
});

test('retainer allocation action uses metadata row not toolbar', () => {
  assert.match(retainerPreviewModalSource, /WorkEngineIncomeAllocationNumberMetaRow/);
  assert.match(retainerPreviewModalSource, /variant="inline"/);
  assert.doesNotMatch(retainerPreviewModalSource, /resolveCycleDraftPreviewAllocationButton/);
  assert.doesNotMatch(retainerPreviewModalSource, /PreviewAllocationIcon/);
  assert.doesNotMatch(retainerPreviewModalSource, /nx-we-preview-sidebar/);
});

test('allocation edit visibility comes from backend field descriptor', () => {
  assert.match(retainerSetupSource, /handleSaveCycleDraftAllocationNumber/);
  assert.match(retainerSetupSource, /update_allocation_number/);
  assert.match(retainerSetupSource, /mergeIncomeWorkspaceWizardPatch/);
  assert.doesNotMatch(retainerSetupSource, /documentDetailsStep=/);
});

test('income wizard save calls update_income_document_allocation_number and refreshes aggregate', () => {
  assert.match(wizardSource, /update_allocation_number/);
  assert.match(wizardSource, /income_workspace_aggregate/);
  assert.doesNotMatch(wizardSource, /fetch\(.*allocation/i);
});

test('allocation display_value comes from backend descriptor including placeholder', () => {
  const field = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: null,
    canEdit: true,
    isIssued: false,
  });
  assert.equal(field.display_value, 'הזינו מספר הקצאה');
  assert.equal(field.editable, true);
  assert.equal(field.tooltip, 'עריכת מספר הקצאה');
});

test('disabled allocation tooltip comes from backend descriptor', () => {
  const field = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: '123456789',
    canEdit: true,
    isIssued: true,
  });
  assert.equal(field.editable, false);
  assert.match(field.tooltip ?? field.disabled_reason ?? '', /לאחר הפקת המסמך/);
});

test('preview and pdf renderer share one document structure without edit controls', () => {
  assert.match(rendererSource, /renderIncomeBrandedPreviewHtml/);
  assert.doesNotMatch(rendererSource, /pencil/i);
  assert.doesNotMatch(rendererSource, /nx-we-preview-sidebar__edit-btn/);
  assert.doesNotMatch(rendererSource, /we-cycle-draft-preview-allocation/);
});
