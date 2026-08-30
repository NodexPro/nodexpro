/**
 * P4.2 — documents-by-type selectedYear bounds reach the DB query (no multi-year hydrate + Node filter).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  documentsByTypeSelectedYearBounds,
  isDraftActivityInSelectedYear,
  isIssueDateInSelectedYear,
} from '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type-year.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const readModelSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const feLoadPure = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/work-engine-client-documents-by-type-load.pure.ts',
  ),
  'utf8',
);
const feModal = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx',
  ),
  'utf8',
);

test('1 — selectedYear bounds are half-open [Y-01-01, (Y+1)-01-01)', () => {
  assert.deepEqual(documentsByTypeSelectedYearBounds(2024), {
    startInclusive: '2024-01-01',
    endExclusive: '2025-01-01',
  });
  assert.deepEqual(documentsByTypeSelectedYearBounds(2026), {
    startInclusive: '2026-01-01',
    endExclusive: '2027-01-01',
  });
});

test('2 — issued issue_date semantics: before Jan 1 excluded, on/after next Jan 1 excluded, inside kept', () => {
  assert.equal(isIssueDateInSelectedYear('2023-12-31', 2024), false);
  assert.equal(isIssueDateInSelectedYear('2024-01-01', 2024), true);
  assert.equal(isIssueDateInSelectedYear('2024-06-15', 2024), true);
  assert.equal(isIssueDateInSelectedYear('2024-12-31', 2024), true);
  assert.equal(isIssueDateInSelectedYear('2025-01-01', 2024), false);
  assert.equal(isIssueDateInSelectedYear(null, 2024), false);
});

test('3 — draft activity semantics: updated_at || created_at calendar year', () => {
  assert.equal(
    isDraftActivityInSelectedYear('2023-12-31T23:00:00.000Z', null, 2024),
    false,
  );
  assert.equal(
    isDraftActivityInSelectedYear('2024-01-01T00:00:00.000Z', null, 2024),
    true,
  );
  assert.equal(
    isDraftActivityInSelectedYear('2025-01-01T00:00:00.000Z', null, 2024),
    false,
  );
  // falsy updated_at → created_at
  assert.equal(isDraftActivityInSelectedYear(null, '2024-03-01T12:00:00.000Z', 2024), true);
  assert.equal(isDraftActivityInSelectedYear('', '2023-03-01T12:00:00.000Z', 2024), false);
});

test('4 — issued DB query applies issue_date year bounds (selectedYear reaches query)', () => {
  assert.match(readModelSource, /documentsByTypeSelectedYearBounds\(params\.selectedYear\)/);
  assert.match(readModelSource, /\.gte\('issue_date',\s*startInclusive\)/);
  assert.match(readModelSource, /\.lt\('issue_date',\s*endExclusive\)/);
});

test('5 — draft DB query applies updated_at year bounds', () => {
  assert.match(readModelSource, /\.gte\('updated_at',\s*startInclusive\)/);
  assert.match(readModelSource, /\.lt\('updated_at',\s*endExclusive\)/);
});

test('6 — hot path no longer multi-year hydrate + Node filterCandidatesByYear', () => {
  assert.doesNotMatch(readModelSource, /function filterCandidatesByYear/);
  assert.doesNotMatch(readModelSource, /filterCandidatesByYear\(/);
  // Full candidates load requires selectedYear before query
  assert.match(readModelSource, /selectedYear:\s*number/);
  assert.match(readModelSource, /selectedYear = resolveSelectedYear/);
  assert.match(readModelSource, /loadIssuedDocumentCandidates\(\{[\s\S]*selectedYear,/);
  assert.match(readModelSource, /loadDraftCandidates\(\{[\s\S]*selectedYear,/);
});

test('7 — available_years uses lightweight date-only / timestamp-only scan (not enriched rows)', () => {
  assert.match(readModelSource, /async function loadIssuedAvailableYears/);
  assert.match(readModelSource, /async function loadDraftAvailableYears/);
  assert.match(
    readModelSource,
    /loadIssuedAvailableYears[\s\S]*\.select\('issue_date, represented_client_id, issuer_business_id, acting_mode'\)/,
  );
  assert.match(
    readModelSource,
    /loadDraftAvailableYears[\s\S]*\.select\(\s*'updated_at, created_at, represented_client_id, issuer_business_id, acting_mode'/,
  );
});

test('8 — org / issuer / recipient scoping predicates remain on candidate queries', () => {
  assert.match(readModelSource, /\.eq\('organization_id',\s*params\.orgId\)/);
  assert.match(readModelSource, /officeClientDocumentsOrFilter\(params\.representedClientId\)/);
  assert.match(readModelSource, /\.eq\('income_customer_id',\s*params\.incomeCustomerId\)/);
  assert.match(readModelSource, /belongsToOfficeClientRow\(/);
  assert.match(readModelSource, /excludeSelfModeActingFilter\(\)/);
});

test('9 — enrichment stays batched (Promise.all + by-ids loaders; no per-row await loop)', () => {
  assert.match(readModelSource, /await Promise\.all\(\[/);
  assert.match(readModelSource, /loadEmailAttemptCountsByDocumentIds\(params\.orgId,\s*documentIds\)/);
  assert.match(readModelSource, /loadDocflowAttemptCountsByDocumentIds\(params\.orgId,\s*documentIds\)/);
  assert.match(readModelSource, /sumPostedAllocationsForIncomeDocuments\(params\.orgId,\s*documentIds\)/);
  assert.doesNotMatch(readModelSource, /for\s*\([^)]+\)\s*\{\s*await /);
});

test('10 — frontend still supplies year to backend; does not filter documents by year locally', () => {
  assert.match(feLoadPure, /year_change/);
  assert.match(feLoadPure, /resolveClientDocumentsByTypeYearForFetch/);
  assert.doesNotMatch(feModal, /filter\(.*year/);
  assert.doesNotMatch(feModal, /available_years\.filter/);
  assert.doesNotMatch(feModal, /rows\.filter\([^)]*year/);
});
