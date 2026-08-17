/**
 * Credit Note editor session/footer — שמירה finalizes via issue_income_document.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  buildPreliminaryDocumentEditMode,
  buildWizardSessionActions,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const wizardModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const tabHostSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const ledgerServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-income-ledger-card.service.ts'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const creditServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
  'utf8',
);

function creditNoteActions(overrides?: { canEdit?: boolean; canIssue?: boolean }) {
  return buildWizardSessionActions({
    canEdit: overrides?.canEdit ?? true,
    canIssue: overrides?.canIssue ?? true,
    editMode: null,
    documentType: 'credit_tax_invoice',
  });
}

test('1 — credit_note primary command is issue_income_document', () => {
  const actions = creditNoteActions();
  assert.equal(actions.save.command, 'issue_income_document');
  assert.equal(actions.save.enabled, true);
  assert.equal(actions.footer.mode, 'credit_note');
});

test('2 — credit_note primary label remains שמירה', () => {
  const actions = creditNoteActions();
  assert.equal(actions.save.label, 'שמירה');
});

test('3 — save_income_document_draft is NOT the credit_note primary action', () => {
  const actions = creditNoteActions();
  assert.notEqual(actions.save.command, 'save_income_document_draft');
});

test('4 — preview remains generate_income_document_preview', () => {
  const actions = creditNoteActions();
  assert.equal(actions.preview.command, 'generate_income_document_preview');
  assert.equal(actions.preview.icon, 'eye');
  assert.equal(actions.preview.presentation, 'icon');
});

test('4b — credit preview HTML uses canonical sectioned paper, not zone chrome', () => {
  const previewHtmlStart = detailsBuildersSource.indexOf('const previewBranding');
  const previewHtmlSlice = detailsBuildersSource.slice(
    previewHtmlStart,
    detailsBuildersSource.indexOf('const deliveryEmail'),
  );
  assert.match(previewHtmlSlice, /document_type === 'credit_tax_invoice'/);
  assert.match(previewHtmlSlice, /document_style_key: 'sectioned'/);
  assert.match(previewHtmlSlice, /renderUnifiedIncomeDocumentHtml/);
  assert.doesNotMatch(previewHtmlSlice, /renderIncomeBrandedPreviewHtml\(/);
});

test('5 — credit issue response refreshes invoices tab + credit document list', () => {
  const issueHandler = commandsSource.slice(
    commandsSource.indexOf('if (command === INCOME_COMMAND_ISSUE_DOCUMENT)'),
    commandsSource.indexOf('if (command === INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT)'),
  );
  assert.match(issueHandler, /document_type_key === 'credit_tax_invoice'/);
  assert.match(issueHandler, /buildWorkEngineInvoicesTabAggregate/);
  assert.match(issueHandler, /documentTypeKey:\s*'credit_tax_invoice'/);
  assert.match(issueHandler, /work_engine_invoices_tab_aggregate/);
  assert.match(issueHandler, /work_engine_invoices_client_documents_by_type_aggregate/);
});

test('6 — issued Credit appears in ledger only when document_status is issued', () => {
  assert.match(ledgerServiceSource, /document_type', 'credit_tax_invoice'/);
  assert.match(ledgerServiceSource, /document_status', 'issued'/);
  assert.match(ledgerServiceSource, /loadLedgerCreditDocuments/);
});

test('7 — original invoice remaining collectible changes only after issue consume', () => {
  assert.match(issueSource, /assertAndConsumeCreditOnIssue/);
  assert.match(creditServiceSource, /callConsumeIncomeTaxInvoiceCreditRpc/);
});

test('8 — draft Credit alone does not increment issued credit counter', () => {
  assert.match(panelSource, /credit_count/);
  assert.match(panelSource, /\.eq\('document_status', 'issued'\)/);
});

test('9 — Eye is header-only for credit_note; footer has no Eye', () => {
  const headerSlice = wizardModalSource.slice(
    wizardModalSource.indexOf('<div className="nx-modal-header">'),
    wizardModalSource.indexOf('<div className="nx-modal-body">'),
  );
  const footerSlice = wizardModalSource.slice(
    wizardModalSource.indexOf('<div className="nx-modal-footer nx-tax-nested-modal-footer">'),
  );
  assert.match(headerSlice, /previewUsesEye/);
  assert.match(headerSlice, /WizardPreviewEyeIcon/);
  assert.doesNotMatch(footerSlice, /WizardPreviewEyeIcon/);
  assert.doesNotMatch(footerSlice, /nx-we-retainer-schedule__preview-eye/);
});

test('10 — wizard primary executes backend save.command; no document-type rules in React', () => {
  assert.match(wizardModalSource, /sessionActions\?\.save\?\.command/);
  assert.match(wizardModalSource, /issue_income_document/);
  assert.match(wizardModalSource, /flushPendingEdits/);
  assert.match(wizardModalSource, /cmds\.issue_document/);
  assert.match(tabHostSource, /work_engine_invoices_tab_aggregate/);
  assert.doesNotMatch(wizardModalSource, /document_type_key === 'credit_tax_invoice'/);
  assert.doesNotMatch(wizardModalSource, /documentType === 'credit_tax_invoice'/);
  assert.match(detailsBuildersSource, /documentType:\s*row\.document_type/);
});

test('11 — normal + מסמך wizard and preliminary-edit stay unchanged', () => {
  const normal = buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: null,
    documentType: 'tax_invoice',
  });
  assert.equal(normal.footer.mode, 'wizard');
  assert.equal(normal.footer.show_back, true);
  assert.equal(normal.footer.show_next, true);
  assert.equal(normal.footer.show_issue, true);
  assert.equal(normal.save.command, 'save_income_document_draft');
  assert.equal(normal.save.label, 'שמירת טיוטה');
  assert.equal(normal.preview.icon ?? null, null);
  assert.equal(normal.footer.close_control, 'text');

  const preliminary = buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: buildPreliminaryDocumentEditMode({
      documentSettingsJson: {
        [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'quote-1',
      },
      documentType: 'quote',
      documentNumberPreview: '100',
    }),
    documentType: 'quote',
  });
  assert.equal(preliminary.footer.mode, 'preliminary_edit');
  assert.equal(preliminary.save.command, 'save_income_document_draft');
  assert.equal(preliminary.save.label, 'שמירה');
  assert.equal(preliminary.preview.icon ?? null, null);
  assert.equal(preliminary.issue.enabled, false);
  assert.equal(preliminary.footer.show_issue, false);
});

test('credit_note footer chrome: X, no back/next/issue, close after finalize', () => {
  const actions = creditNoteActions();
  assert.equal(actions.footer.close_control, 'icon');
  assert.equal(actions.footer.show_back, false);
  assert.equal(actions.footer.show_next, false);
  assert.equal(actions.footer.show_preview, true);
  assert.equal(actions.footer.show_save, true);
  assert.equal(actions.footer.show_issue, false);
  assert.equal(actions.footer.close_after_save, true);
});

test('credit_note primary disabled without issue permission', () => {
  const actions = creditNoteActions({ canEdit: true, canIssue: false });
  assert.equal(actions.save.enabled, false);
  assert.equal(actions.save.command, null);
  assert.equal(actions.save.disabled_reason, 'נדרשת הרשאת הפקה');
});
