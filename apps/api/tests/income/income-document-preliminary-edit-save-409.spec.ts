/**
 * P0 — preliminary-edit Save 409: 159-allowed UPDATE contract only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE,
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  allowedConversionTargetsForSource,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const conversionPureSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.pure.ts'),
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

function saveInPlaceFn(): string {
  const start = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  return draftEditorSource.slice(start, start + 12000);
}

function updatePayload(): string {
  const saveBody = saveInPlaceFn();
  const start = saveBody.indexOf('.update({');
  const end = saveBody.indexOf('.eq(\'organization_id\'', start);
  return saveBody.slice(start, end > start ? end : start + 2500);
}

function generatePreviewFn(): string {
  const start = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const end = draftEditorSource.indexOf(
    'export async function buildReadOnlyIncomeDocumentPreviewOverlay',
  );
  return draftEditorSource.slice(start, end > start ? end : start + 2200);
}

test('A — Save edited Deal Invoice uses in-place update command path', () => {
  assert.equal(isPreliminaryEditableType('deal_invoice'), true);
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /\.from\('income_documents'\)[\s\S]*\.update\(\{/);
  assert.match(saveBody, /\.eq\('document_type', source\.document_type\)/);
  assert.match(wizardModalSource, /cmds\.save_draft/);
  assert.match(wizardModalSource, /flushPendingEdits/);
});

test('B — Save edited Quote uses the same in-place path', () => {
  assert.equal(isPreliminaryEditableType('quote'), true);
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /isPreliminaryEditableType\(source\.document_type\)/);
  assert.match(saveBody, /isPreliminaryEditableType\(row\.document_type\)/);
});

test('C — same source id', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.doesNotMatch(updatePayload(), /document_status:\s*'issued'/);
});

test('D — same number', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(updatePayload(), /document_number:\s*source\.document_number/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
  assert.match(migration159, /NEW\.document_number is not distinct from OLD\.document_number/);
});

test('E — edited lines persisted', () => {
  assert.match(updatePayload(), /lines_snapshot_json:\s*validation\.draft_lines_json/);
});

test('F — totals persisted', () => {
  assert.match(updatePayload(), /totals_snapshot_json:\s*totalsSnapshot/);
});

test('G — no duplicate document', () => {
  const saveBody = saveInPlaceFn();
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
  assert.doesNotMatch(saveBody, /income_document_conversions/);
  assert.doesNotMatch(saveBody, /\.from\('income_documents'\)[\s\S]*\.insert\(\{/);
});

test('H — Preview still works and does not UPDATE income_documents', () => {
  const genBody = generatePreviewFn();
  assert.match(genBody, /wizardDraftMutationOverlay/);
  assert.doesNotMatch(genBody, /savePreliminaryDocumentEditIfNeeded/);
  assert.doesNotMatch(genBody, /from\('income_documents'\)/);
  assert.match(wizardModalSource, /WorkEngineInvoiceRetainerPreviewModal/);
});

test('I — earlier-date guard still works', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /assertPreliminaryEditDocumentDateAllowed/);
  assert.match(conversionPureSource, new RegExp(PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE));
  assert.match(conversionPureSource, new RegExp(PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY));
});

test('J — Tax documents unchanged', () => {
  assert.equal(isPreliminaryEditableType('tax_invoice'), false);
  assert.equal(isPreliminaryEditableType('tax_invoice_receipt'), false);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});

test('159 UPDATE contract omits identity/accounting/cancel columns', () => {
  const payload = updatePayload();
  assert.doesNotMatch(payload, /actor_user_id:/);
  assert.doesNotMatch(payload, /acting_mode:/);
  assert.doesNotMatch(payload, /source_draft_id:/);
  assert.doesNotMatch(payload, /accounting_posting_status:/);
  assert.doesNotMatch(payload, /accounting_entry_id:/);
  assert.doesNotMatch(payload, /cancelled_at:/);
  assert.doesNotMatch(payload, /organization_id:/);
  assert.match(payload, /income_customer_id:/);
  assert.match(payload, /customer_snapshot_json:/);
  assert.match(payload, /issue_date:/);
  assert.match(payload, /due_date:/);
  assert.match(payload, /currency:/);
  assert.match(payload, /language:/);
  assert.match(payload, /notes:/);
  assert.match(payload, /customer_po_reference:/);
  assert.match(migration159, /OLD\.document_type in \('quote', 'deal_invoice'\)/);
});
