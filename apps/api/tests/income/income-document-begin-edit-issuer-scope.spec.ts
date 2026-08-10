/**
 * Regression: begin_edit must not call the public select-issuer command guard.
 * That path throws: "command must be select_income_issuer_context".
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
const issuerContextSource = readFileSync(
  join(dir, '../../src/domains/income/income-issuer-context.service.ts'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const migration159 = readFileSync(
  join(dir, '../../../../supabase/migrations/159_income_preliminary_document_edit_in_place.sql'),
  'utf8',
);

test('applySelectIncomeIssuerContext rejects non-select command with proven error text', () => {
  assert.match(
    issuerContextSource,
    /command must be \$\{INCOME_COMMAND_SELECT_ISSUER\}/,
  );
  assert.match(issuerContextSource, /command !== INCOME_COMMAND_SELECT_ISSUER/);
});

test('begin_edit uses applyOfficialIncomeIssuerContext, not applySelectIncomeIssuerContext', () => {
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  assert.ok(beginIdx > 0);
  const beginBody = conversionServiceSource.slice(beginIdx, beginIdx + 3500);
  assert.match(beginBody, /applyOfficialIncomeIssuerContext/);
  assert.doesNotMatch(beginBody, /applySelectIncomeIssuerContext/);
  assert.match(
    beginBody,
    /source:\s*INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT/,
  );
});

test('conversion service no longer imports applySelectIncomeIssuerContext', () => {
  assert.doesNotMatch(
    conversionServiceSource,
    /import\s*\{[^}]*applySelectIncomeIssuerContext/,
  );
  assert.match(
    conversionServiceSource,
    /import\s*\{[^}]*applyOfficialIncomeIssuerContext/,
  );
});

test('convert/cancel internal scope switches also use official helper', () => {
  assert.doesNotMatch(conversionServiceSource, /applySelectIncomeIssuerContext\s*\(/);
  const convertIdx = conversionServiceSource.indexOf(
    'export async function executeConvertIncomeDocumentToDraft',
  );
  const cancelIdx = conversionServiceSource.indexOf(
    'export async function executeCancelIncomePreliminaryDocument',
  );
  assert.ok(convertIdx > 0);
  assert.ok(cancelIdx > 0);
  assert.match(
    conversionServiceSource.slice(convertIdx, convertIdx + 4500),
    /applyOfficialIncomeIssuerContext/,
  );
  assert.match(
    conversionServiceSource.slice(cancelIdx, cancelIdx + 2500),
    /applyOfficialIncomeIssuerContext/,
  );
});

test('begin_edit opens hidden same-number staging draft, not a new visible preliminary document', () => {
  const beginIdx = conversionServiceSource.indexOf(
    'export async function executeBeginEditIncomePreliminaryDocument',
  );
  const convertIdx = conversionServiceSource.indexOf(
    'export async function executeConvertIncomeDocumentToDraft',
  );
  const beginBody = conversionServiceSource.slice(
    beginIdx,
    convertIdx > beginIdx ? convertIdx : beginIdx + 12000,
  );
  assert.match(beginBody, /PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY/);
  assert.match(beginBody, /document_number_preview:\s*source\.document_number/);
  assert.match(beginBody, /document_date:\s*source\.issue_date/);
  assert.match(beginBody, /user_saved_at:\s*null/);
});

test('save draft detects preliminary edit marker and updates the original document in place', () => {
  assert.match(draftEditorSource, /savePreliminaryDocumentEditIfNeeded/);
  const saveIdx = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  const saveBody = draftEditorSource.slice(saveIdx, saveIdx + 9000);
  assert.match(saveBody, /preliminaryEditSourceDocumentId/);
  assert.match(saveBody, /\.from\('income_documents'\)[\s\S]*\.update\(\{/);
  assert.match(saveBody, /document_number:\s*source\.document_number/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.match(saveBody, /\.eq\('document_status', 'issued'\)/);
  assert.match(saveBody, /\.from\('income_document_drafts'\)[\s\S]*source\.source_draft_id/);
  assert.match(saveBody, /user_saved_at:\s*null/);
  assert.doesNotMatch(saveBody, /issue_income_document|allocate|income_document_conversions/);
});

test('settings updates preserve preliminary edit marker until save', () => {
  assert.match(draftEditorSource, /function preservePreliminaryEditMarker/);
  assert.match(draftEditorSource, /PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY/);
  assert.match(draftEditorSource, /updateIncomeDocumentDiscount[\s\S]*preservePreliminaryEditMarker/);
  assert.match(draftEditorSource, /updateIncomeDocumentDraftSettings[\s\S]*preservePreliminaryEditMarker/);
});

test('migration 159 allows only active quote/deal in-place edits with fixed identity', () => {
  assert.match(migration159, /NEW\.document_status = 'issued'/);
  assert.match(migration159, /OLD\.document_type in \('quote', 'deal_invoice'\)/);
  assert.match(migration159, /NEW\.document_number is not distinct from OLD\.document_number/);
  assert.match(migration159, /NEW\.source_draft_id is not distinct from OLD\.source_draft_id/);
  assert.match(migration159, /NEW\.accounting_entry_id is not distinct from OLD\.accounting_entry_id/);
  assert.match(migration159, /income_documents business fields are immutable after issue/);
});
