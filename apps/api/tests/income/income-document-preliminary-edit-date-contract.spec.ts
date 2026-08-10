/**
 * P0 — preliminary-edit date replay heal + original issue_date floor.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE,
  PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE,
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  decidePreliminaryEditDocumentDateGuard,
  decidePreliminaryEditStagingDateHeal,
  decidePreliminaryEditIssueGuard,
  buildPreliminaryDocumentEditMode,
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
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const retainerDateSource = readFileSync(
  join(dir, '../../src/domains/income/income-retainer-template-document-date.pure.ts'),
  'utf8',
);

const prelimSettings = {
  vat_mode: 'standard',
  [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: 'deal-2001',
};

test('A — replay heal fills null staging document_date from source.issue_date', () => {
  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: null,
    stagingDueDate: null,
    sourceIssueDate: '2026-08-08',
    sourceDueDate: null,
  });
  assert.equal(heal.document_date, '2026-08-08');
  assert.match(conversionServiceSource, /healPreliminaryEditStagingDraftDates/);
  assert.match(conversionServiceSource, /decidePreliminaryEditStagingDateHeal/);
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  const beginBody = conversionServiceSource.slice(beginIdx, beginIdx + 3500);
  assert.match(beginBody, /existingEditDraftId/);
  assert.match(beginBody, /healPreliminaryEditStagingDraftDates/);
  assert.match(beginBody, /replay:\s*true/);
});

test('B — replay preserves already-edited staging document_date', () => {
  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: '2026-08-10',
    stagingDueDate: '2026-08-20',
    sourceIssueDate: '2026-08-08',
    sourceDueDate: '2026-08-15',
  });
  assert.equal(heal.document_date, undefined);
  assert.equal(heal.due_date, undefined);
  assert.deepEqual(heal, {});
});

test('C — missing due_date heals from source due_date', () => {
  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: '2026-08-08',
    stagingDueDate: null,
    sourceIssueDate: '2026-08-08',
    sourceDueDate: '2026-08-22',
  });
  assert.equal(heal.document_date, undefined);
  assert.equal(heal.due_date, '2026-08-22');
});

test('D — existing edited due_date is preserved', () => {
  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: '2026-08-08',
    stagingDueDate: '2026-09-01',
    sourceIssueDate: '2026-08-08',
    sourceDueDate: '2026-08-22',
  });
  assert.equal(heal.due_date, undefined);
});

test('E — aggregate document_date exposes min_value = source.issue_date', () => {
  assert.match(detailsBuildersSource, /preliminaryEditDocumentDateMin/);
  assert.match(detailsBuildersSource, /min_value:\s*preliminaryEditDocumentDateMin/);
  assert.match(detailsBuildersSource, /readPreliminaryEditSourceDocumentId/);
  assert.match(detailsBuildersSource, /loadPreliminaryEditSourceIssueDateForSchema|issue_date/);
  const mode = buildPreliminaryDocumentEditMode({
    documentSettingsJson: prelimSettings,
    documentType: 'deal_invoice',
    documentNumberPreview: '2001',
  });
  assert.equal(mode?.source_document_id, 'deal-2001');
  assert.equal(mode?.source_document_number, '2001');
  assert.equal(mode?.source_document_type, 'deal_invoice');
});

test('F — update document_date to original issue_date is allowed', () => {
  const decision = decidePreliminaryEditDocumentDateGuard({
    documentSettingsJson: prelimSettings,
    originalIssueDate: '2026-08-08',
    requestedDocumentDate: '2026-08-08',
  });
  assert.equal(decision.action, 'allow');
});

test('G — update document_date after original issue_date is allowed', () => {
  const decision = decidePreliminaryEditDocumentDateGuard({
    documentSettingsJson: prelimSettings,
    originalIssueDate: '2026-08-08',
    requestedDocumentDate: '2026-08-09',
  });
  assert.equal(decision.action, 'allow');
});

test('H — update document_date before original issue_date is rejected', () => {
  const decision = decidePreliminaryEditDocumentDateGuard({
    documentSettingsJson: prelimSettings,
    originalIssueDate: '2026-08-08',
    requestedDocumentDate: '2026-08-07',
  });
  assert.equal(decision.action, 'reject');
  if (decision.action !== 'reject') throw new Error('expected reject');
  assert.equal(decision.code, PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_CODE);
  assert.equal(decision.message, PRELIMINARY_EDIT_DATE_BEFORE_ORIGINAL_MESSAGE);
  assert.match(draftEditorSource, /assertPreliminaryEditDocumentDateAllowed/);
  assert.match(draftEditorSource, /decidePreliminaryEditDocumentDateGuard/);
  assert.match(draftEditorSource, /updateIncomeDocumentDraftSettings/);
});

test('I — rejected earlier date path does not mutate source before guard', () => {
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 5000);
  const guardIdx = saveBody.indexOf('assertPreliminaryEditDocumentDateAllowed');
  const updateIdx = saveBody.indexOf(".from('income_documents')");
  const updateCallIdx = saveBody.indexOf('.update({', updateIdx);
  assert.ok(guardIdx >= 0, 'save path has date guard');
  assert.ok(updateCallIdx > guardIdx, 'source update happens after date guard');
});

test('J — Save still keeps same document ID and same document number', () => {
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 9000);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
});

test('K — Issue guard still blocks numbering / new document', () => {
  const decision = decidePreliminaryEditIssueGuard(prelimSettings);
  assert.equal(decision.action, 'reject');
  const fnIdx = issueServiceSource.indexOf('async function issueNewDocumentFromDraft');
  const body = issueServiceSource.slice(fnIdx, fnIdx + 20000);
  const guardIdx = body.indexOf('decidePreliminaryEditIssueGuard');
  const numberingIdx = body.indexOf('() => allocateIncomeDocumentNumber');
  assert.ok(guardIdx >= 0);
  assert.ok(numberingIdx > guardIdx);
});

test('L — normal new Quote/Deal draft flow unchanged (no prelim marker ⇒ noop date guard)', () => {
  const decision = decidePreliminaryEditDocumentDateGuard({
    documentSettingsJson: { vat_mode: 'standard' },
    originalIssueDate: '2026-08-08',
    requestedDocumentDate: '2026-08-01',
  });
  assert.equal(decision.action, 'noop');
  assert.match(conversionServiceSource, /export async function executeConvertIncomeDocumentToDraft/);
  const convertIdx = conversionServiceSource.indexOf(
    'export async function executeConvertIncomeDocumentToDraft',
  );
  const convertHead = conversionServiceSource.slice(convertIdx, convertIdx + 2000);
  assert.doesNotMatch(convertHead, /healPreliminaryEditStagingDraftDates/);
});

test('M — retainer flow date rule unchanged', () => {
  assert.match(retainerDateSource, /retainer_template_document_date_before_today/);
  assert.match(retainerDateSource, /assertRetainerTemplateDocumentDateNotBeforeToday/);
  assert.doesNotMatch(retainerDateSource, /preliminary_edit_date_before_original/);
});

test('empty string staging dates heal like null', () => {
  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: '   ',
    stagingDueDate: '',
    sourceIssueDate: '2026-08-08',
    sourceDueDate: '2026-08-30',
  });
  assert.equal(heal.document_date, '2026-08-08');
  assert.equal(heal.due_date, '2026-08-30');
});

test('non-preliminary settings never reject earlier dates via floor guard', () => {
  assert.equal(
    decidePreliminaryEditDocumentDateGuard({
      documentSettingsJson: null,
      originalIssueDate: '2026-08-08',
      requestedDocumentDate: '2026-01-01',
    }).action,
    'noop',
  );
});
