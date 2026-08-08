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
