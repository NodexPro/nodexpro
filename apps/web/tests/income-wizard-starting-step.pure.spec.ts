import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveIncomeWizardStartingStepIndex,
  resolveIncomeWizardStartingStepKey,
} from '../src/income/income-wizard-starting-step.pure.ts';

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
  assert.equal(resolveIncomeWizardStartingStepIndex(WIZARD_STEPS, null), 0);
});

test('row-scoped new document with issuer_context starts at document_type', () => {
  assert.equal(
    resolveIncomeWizardStartingStepKey({
      steps: WIZARD_STEPS,
      wizard_starting_step_key: null,
      active_wizard_draft_id: null,
      has_document_details_step: false,
      has_issuer_context: true,
    }),
    'document_type',
  );
  assert.equal(
    resolveIncomeWizardStartingStepIndex(WIZARD_STEPS, {
      issuer_context: { issuer_business_id: 'issuer-1' },
      active_wizard_draft_id: null,
    }),
    1,
  );
});

test('credit draft first paint is document_details index, not issuer_choice', () => {
  assert.equal(
    resolveIncomeWizardStartingStepIndex(WIZARD_STEPS, {
      wizard_starting_step_key: 'document_details',
      active_wizard_draft_id: 'credit-draft-1',
      document_details_step: { document_type_key: 'credit_tax_invoice' },
    }),
    3,
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
  assert.match(creditHandler, /setRetainerSetupOpen\(false\)/);
  assert.match(creditHandler, /income_workspace_aggregate/);
  assert.doesNotMatch(creditHandler, /setRetainerSetupOpen\(true\)/);
  assert.doesNotMatch(creditHandler, /setRetainerCustomerOpen\(true\)/);
  assert.doesNotMatch(creditHandler, /WorkEngineInvoiceRetainerSetupModal/);

  assert.match(tabHostSource, /onOpenNewDocument=\{async \(workspaceAggregate\) => \{/);
  assert.match(tabHostSource, /setWizardInitialAgg\(workspaceAggregate\)/);
  assert.match(shellSource, /select_income_recipient/);
  assert.doesNotMatch(shellSource, /open_end_customer_settings/);
  assert.match(
    shellSource,
    /select_income_recipient[\s\S]*?income_customer_id: incomeCustomerId/,
  );
  assert.doesNotMatch(
    shellSource,
    /select_income_recipient[\s\S]*?display_name/,
  );
  assert.match(wizardSource, /has_issuer_context: Boolean\(workspaceAgg\?\.issuer_context\)/);

  assert.match(tabHostSource, /onOpenConvertedDraft=\{async \(\{ workspaceAggregate \}\) => \{/);
  assert.match(tabHostSource, /setWizardInitialAgg\(workspaceAggregate\)/);
  assert.match(tabHostSource, /setWizardOpen\(true\)/);
  assert.match(tabHostSource, /WorkEngineIncomeDocumentWizardModal/);
  assert.match(tabHostSource, /setWizardInitialAgg\(null\);\s*setWizardOpen\(true\)/);
  assert.match(wizardSource, /resolveIncomeWizardStartingStepIndex/);
  assert.match(wizardSource, /<WorkEngineDocumentDetailsStep/);
  assert.match(wizardSource, /nx-we-income-wizard-overlay/);
  assert.match(wizardSource, /createPortal/);
  assert.doesNotMatch(wizardSource, /CreditNoteEditor|credit-note-editor|creditNoteForm/);
  assert.match(retainerSetupSource, /<WorkEngineDocumentDetailsStep/);

  assert.doesNotMatch(creditConfirmSource, /WorkEngineInvoiceRetainerSetupModal/);
  assert.doesNotMatch(creditConfirmSource, /ריטיינר/);

  assert.match(wizardSource, /footerActions\?\.mode === 'credit_note'/);
  assert.match(wizardSource, /preview\?\.icon === 'eye'/);
  assert.match(wizardSource, /sessionActions\?\.save\?\.command/);
  assert.match(wizardSource, /issue_income_document/);
  assert.match(wizardSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.match(
    wizardSource,
    /s\.key === 'preview'[\s\S]*?footerActions\?\.mode === 'credit_note'[\s\S]*?footerActions\?\.mode === 'conversion'/,
  );
  assert.match(wizardSource, /nx-we-retainer-preview-overlay--above-wizard/);
  assert.match(wizardSource, /cmds\.generate_preview/);
  assert.match(wizardSource, /flushPendingEdits/);
  assert.doesNotMatch(wizardSource, /fetchWorkEngineInvoicesClientDocumentsByTypeAggregate/);
  assert.doesNotMatch(wizardSource, /nx-we-retainer-schedule__preview-eye/);
  assert.doesNotMatch(wizardSource, /document_type_key === 'credit_tax_invoice'/);
  assert.doesNotMatch(retainerSetupSource, /begin_income_tax_invoice_credit/);
  assert.doesNotMatch(retainerSetupSource, /credit_tax_invoice/);
});
