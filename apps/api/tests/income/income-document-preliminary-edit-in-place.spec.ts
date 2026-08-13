/**
 * P0 — preliminary Quote / Deal Invoice edit-in-place contract.
 * Source/static + pure guards. Issue must reject before numbering.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_CANNOT_ISSUE_CODE,
  PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE,
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  allowedConversionTargetsForSource,
  buildPreliminaryDocumentEditMode,
  buildPreliminaryEditAction,
  buildWizardSessionActions,
  decidePreliminaryEditIssueGuard,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const conversionServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.service.ts'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const workspaceAggSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const wizardModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const migration159 = readFileSync(
  join(dir, '../../../../supabase/migrations/159_income_preliminary_document_edit_in_place.sql'),
  'utf8',
);

const quoteSettings = {
  vat_mode: 'standard',
  [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'quote-doc-123',
};

test('A — Quote pencil opens same-number / same-date staging edit session', () => {
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  const beginBody = conversionServiceSource.slice(beginIdx, beginIdx + 5500);
  assert.match(beginBody, /document_date:\s*source\.issue_date/);
  assert.match(beginBody, /document_number_preview:\s*source\.document_number/);
  assert.match(beginBody, /PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY/);
  assert.match(beginBody, /user_saved_at:\s*null/);

  const mode = buildPreliminaryDocumentEditMode({
    documentSettingsJson: quoteSettings,
    documentType: 'quote',
    documentNumberPreview: '123',
  });
  assert.deepEqual(mode, {
    type: 'preliminary_document_edit',
    source_document_id: 'quote-doc-123',
    source_document_number: '123',
    source_document_type: 'quote',
  });
});

test('B/C — Save updates same income_documents row and never invents a new number', () => {
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 9000);
  assert.match(saveBody, /\.from\('income_documents'\)[\s\S]*\.update\(\{/);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber|income_document_conversions/);
  assert.match(saveBody, /issue_date:\s*documentDate/);
  assert.match(migration159, /NEW\.document_number is not distinct from OLD\.document_number/);
});

test('D — Deal Invoice is preliminary-editable same as Quote', () => {
  assert.equal(isPreliminaryEditableType('deal_invoice'), true);
  assert.equal(isPreliminaryEditableType('quote'), true);
  const mode = buildPreliminaryDocumentEditMode({
    documentSettingsJson: {
      [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'deal-doc-9',
    },
    documentType: 'deal_invoice',
    documentNumberPreview: '9001',
  });
  assert.equal(mode?.source_document_type, 'deal_invoice');
  assert.equal(mode?.source_document_number, '9001');
});

test('E — issue_income_document rejects preliminary edit staging draft', () => {
  const decision = decidePreliminaryEditIssueGuard(quoteSettings);
  assert.equal(decision.action, 'reject');
  if (decision.action !== 'reject') throw new Error('expected reject');
  assert.equal(decision.code, PRELIMINARY_EDIT_CANNOT_ISSUE_CODE);
  assert.equal(decision.message, PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE);
  assert.match(issueServiceSource, /decidePreliminaryEditIssueGuard/);
  assert.match(issueServiceSource, /preliminaryEditGuard\.code/);
});

test('F/G — Issue rejection is before numbering and before income_documents insert', () => {
  const fnIdx = issueServiceSource.indexOf('async function issueNewDocumentFromDraft');
  assert.ok(fnIdx > 0);
  const body = issueServiceSource.slice(fnIdx, fnIdx + 20000);
  const guardIdx = body.indexOf('decidePreliminaryEditIssueGuard');
  const numberingIdx = body.indexOf('() => allocateIncomeDocumentNumber');
  const insertMatch = body.match(/\.from\('income_documents'\)\s*\.insert\(\{/);
  const insertIdx = insertMatch?.index ?? -1;
  assert.ok(guardIdx >= 0, 'guard present');
  assert.ok(numberingIdx > guardIdx, 'numbering after guard');
  assert.ok(insertIdx > guardIdx, 'document insert after guard');
  assert.ok(insertIdx > numberingIdx, 'document insert after numbering');
});

test('H — double Pencil reuses open staging edit session', () => {
  assert.match(conversionServiceSource, /findOpenPreliminaryEditDraft/);
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  const beginBody = conversionServiceSource.slice(beginIdx, beginIdx + 3500);
  assert.match(beginBody, /existingEditDraftId/);
  assert.match(beginBody, /healPreliminaryEditStagingDraftDates/);
  assert.match(beginBody, /replay:\s*true/);
});

test('I — cancelled preliminary document cannot edit', () => {
  const edit = buildPreliminaryEditAction({
    sourceStatus: 'cancelled_future',
    canEdit: true,
  });
  assert.equal(edit.enabled, false);
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  const beginBody = conversionServiceSource.slice(beginIdx, beginIdx + 2000);
  assert.match(beginBody, /Cancelled documents cannot be edited/);
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 3500);
  assert.match(saveBody, /Cancelled preliminary document cannot be edited/);
});

test('J — conversion + targets remain unchanged', () => {
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.match(conversionServiceSource, /export async function executeConvertIncomeDocumentToDraft/);
  assert.match(conversionServiceSource, /income_document_conversions/);
});

test('K — normal issue path still allocates numbers when not preliminary-edit', () => {
  assert.equal(decidePreliminaryEditIssueGuard({ vat_mode: 'standard' }).action, 'allow');
  assert.equal(decidePreliminaryEditIssueGuard(null).action, 'allow');
  assert.match(issueServiceSource, /allocateIncomeDocumentNumber/);
});

test('L — tax documents remain immutable / not preliminary-editable', () => {
  assert.equal(isPreliminaryEditableType('tax_invoice'), false);
  assert.equal(isPreliminaryEditableType('tax_invoice_receipt'), false);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice_receipt'), true);
});

test('Aggregate edit_mode + session_actions disable Issue / rename Save', () => {
  const mode = buildPreliminaryDocumentEditMode({
    documentSettingsJson: quoteSettings,
    documentType: 'quote',
    documentNumberPreview: '123',
  });
  const actions = buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: mode,
  });
  assert.equal(actions.save.label, 'שמירה');
  assert.equal(actions.save.enabled, true);
  assert.equal(actions.preview.enabled, true);
  assert.equal(actions.issue.enabled, false);
  assert.equal(actions.issue_and_send.enabled, false);
  assert.equal(actions.issue.disabled_reason, PRELIMINARY_EDIT_CANNOT_ISSUE_MESSAGE);
  assert.equal(actions.footer.mode, 'preliminary_edit');
  assert.equal(actions.footer.show_back, false);
  assert.equal(actions.footer.show_next, false);
  assert.equal(actions.footer.show_issue, false);
  assert.equal(actions.footer.close_after_save, true);
  assert.equal(actions.footer.close_control, 'icon');

  const normal = buildWizardSessionActions({
    canEdit: true,
    canIssue: true,
    editMode: null,
  });
  assert.equal(normal.save.label, 'שמירת טיוטה');
  assert.equal(normal.issue.enabled, true);

  assert.match(detailsBuildersSource, /buildPreliminaryDocumentEditMode/);
  assert.match(detailsBuildersSource, /buildWizardSessionActions/);
  assert.match(workspaceAggSource, /edit_mode:/);
  assert.match(wizardModalSource, /sessionActions\?\.save\?\.label/);
  assert.match(wizardModalSource, /footerActions\?\.mode === 'preliminary_edit'/);
});
