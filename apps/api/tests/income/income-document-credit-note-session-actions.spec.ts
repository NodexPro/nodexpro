/**
 * Credit Note editor session/footer contract — backend-owned, draft-save (not Issue).
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

test('credit_note footer is backend-owned: X, no back/next, Eye preview, שמירה', () => {
  const actions = creditNoteActions();
  assert.equal(actions.footer.mode, 'credit_note');
  assert.equal(actions.footer.close_control, 'icon');
  assert.equal(actions.footer.show_back, false);
  assert.equal(actions.footer.show_next, false);
  assert.equal(actions.footer.show_preview, true);
  assert.equal(actions.footer.show_save, true);
  assert.equal(actions.footer.show_issue, false);
  assert.equal(actions.footer.close_after_save, true);
  assert.equal(actions.save.label, 'שמירה');
  assert.equal(actions.save.command, 'save_income_document_draft');
  assert.equal(actions.preview.command, 'generate_income_document_preview');
  assert.equal(actions.preview.presentation, 'icon');
  assert.equal(actions.preview.icon, 'eye');
});

test('credit_note Save is draft-save, not Issue / numbering', () => {
  const actions = creditNoteActions();
  assert.equal(actions.save.command, 'save_income_document_draft');
  assert.notEqual(actions.save.command, 'issue_income_document');
  assert.equal(actions.issue.command, 'issue_income_document');
  assert.equal(actions.issue.enabled, true);
  assert.doesNotMatch(creditServiceSource, /allocateIncomeDocumentNumber/);
});

test('normal + מסמך wizard and preliminary-edit stay unchanged', () => {
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
  assert.equal(preliminary.save.label, 'שמירה');
  assert.equal(preliminary.preview.icon ?? null, null);
  assert.equal(preliminary.issue.enabled, false);
  assert.equal(preliminary.footer.show_issue, false);
});

test('details builder passes documentType into session actions', () => {
  assert.match(detailsBuildersSource, /documentType:\s*row\.document_type/);
});

test('wizard UI consumes credit_note footer without document-type business rules', () => {
  assert.match(wizardModalSource, /footerActions\?\.mode === 'credit_note'/);
  assert.match(wizardModalSource, /preview\?\.icon === 'eye'/);
  assert.match(wizardModalSource, /nx-we-retainer-schedule__preview-eye/);
  assert.match(wizardModalSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.match(wizardModalSource, /flushPendingEdits/);
  assert.match(wizardModalSource, /cmds\.save_draft/);
  assert.match(wizardModalSource, /cmds\.generate_preview/);
  assert.doesNotMatch(wizardModalSource, /document_type_key === 'credit_tax_invoice'/);
  assert.doesNotMatch(wizardModalSource, /documentType === 'credit_tax_invoice'/);
});
