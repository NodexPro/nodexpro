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
const wizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-branding-preview.renderer.ts'),
  'utf8',
);

test('allocation sidebar uses backend display_value and editable flag for pencil', () => {
  assert.match(previewStepSource, /allocation_number_field/);
  assert.match(previewStepSource, /field\.display_value/);
  assert.match(previewStepSource, /field\.editable/);
  assert.match(previewStepSource, /field\.tooltip/);
  assert.match(previewStepSource, /field\.disabled_reason/);
  assert.doesNotMatch(previewStepSource, /shouldShow.*allocation/i);
});

test('pencil appears only when editable=true in preview sidebar', () => {
  assert.match(previewStepSource, /\{field\.editable \? \(/);
  assert.doesNotMatch(rendererSource, /nx-we-preview-sidebar__edit-btn/);
  assert.doesNotMatch(rendererSource, /docPreviewIcon\('edit'\)/);
});

test('save calls update_income_document_allocation_number and refreshes aggregate', () => {
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
});
