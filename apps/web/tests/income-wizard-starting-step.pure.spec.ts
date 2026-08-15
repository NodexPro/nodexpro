import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIncomeWizardStartingStepKey } from '../src/income/income-wizard-starting-step.pure.ts';

const WIZARD_STEPS = [
  { key: 'issuer_choice' },
  { key: 'document_type' },
  { key: 'recipient' },
  { key: 'document_details' },
  { key: 'preview' },
  { key: 'issue' },
];

test('backend wizard_starting_step_key wins when present', () => {
  assert.equal(
    resolveIncomeWizardStartingStepKey({
      steps: WIZARD_STEPS,
      wizard_starting_step_key: 'preview',
      active_wizard_draft_id: 'draft-1',
      has_document_details_step: true,
    }),
    'preview',
  );
});

test('credit/convert draft with details opens document_details, not issuer_choice', () => {
  assert.equal(
    resolveIncomeWizardStartingStepKey({
      steps: WIZARD_STEPS,
      wizard_starting_step_key: null,
      active_wizard_draft_id: 'credit-draft-1',
      has_document_details_step: true,
    }),
    'document_details',
  );
});

test('empty new-document wizard stays on first backend step', () => {
  assert.equal(
    resolveIncomeWizardStartingStepKey({
      steps: WIZARD_STEPS,
      wizard_starting_step_key: null,
      active_wizard_draft_id: null,
      has_document_details_step: false,
    }),
    null,
  );
});

const dir = dirname(fileURLToPath(import.meta.url));
const tabHostSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);
const shellSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
  'utf8',
);
const wizardSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const creditConfirmSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineTaxInvoiceCreditConfirmModal.tsx'),
  'utf8',
);
const retainerSetupSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);

test('credit handoff opens WorkEngineIncomeDocumentWizardModal, not retainer setup', () => {
  const creditHandlerStart = shellSource.indexOf('const handleConfirmTaxInvoiceCredit');
  const creditHandlerEnd = shellSource.indexOf('if (!panel?.visible)');
  assert.ok(creditHandlerStart >= 0 && creditHandlerEnd > creditHandlerStart);
  const creditHandler = shellSource.slice(creditHandlerStart, creditHandlerEnd);

  assert.match(creditHandler, /onOpenConvertedDraft/);
  assert.match(creditHandler, /income_workspace_aggregate/);
  assert.match(creditHandler, /converted_draft_id/);
  assert.doesNotMatch(creditHandler, /setRetainerSetupOpen\(true\)/);
  assert.doesNotMatch(creditHandler, /setRetainerCustomerOpen\(true\)/);
  assert.doesNotMatch(creditHandler, /WorkEngineInvoiceRetainerSetupModal/);

  assert.match(tabHostSource, /onOpenConvertedDraft=\{async \(\{ workspaceAggregate \}\) => \{/);
  assert.match(tabHostSource, /setWizardInitialAgg\(workspaceAggregate\)/);
  assert.match(tabHostSource, /setWizardOpen\(true\)/);
  assert.match(tabHostSource, /WorkEngineIncomeDocumentWizardModal/);
  assert.match(wizardSource, /resolveIncomeWizardStartingStepKey/);

  assert.doesNotMatch(creditConfirmSource, /WorkEngineInvoiceRetainerSetupModal/);
  assert.doesNotMatch(creditConfirmSource, /ריטיינר/);
  assert.doesNotMatch(retainerSetupSource, /begin_income_tax_invoice_credit/);
  assert.doesNotMatch(retainerSetupSource, /credit_tax_invoice/);
});
