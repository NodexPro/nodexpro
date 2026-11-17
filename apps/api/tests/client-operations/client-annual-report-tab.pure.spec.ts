import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annualTabViewTaxYears,
  buildAnnualFilingYearBoard,
  buildAnnualOlderTaxYearOptions,
  buildAnnualYearPresentationFlags,
  checklistFileIdsForFilingYear,
  fileTypeLabelFromMeta,
  provenYearScopedChecklistFiles,
  resolveCurrentAnnualTaxYear,
  resolveWorkingTaxYear,
  uniqueLinkedFileIds,
  workingDocumentRowsForTaxYear,
} from '../../src/domains/client-operations/client-annual-report-tab.pure.js';
import { buildAnnualYearFolders } from '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js';
import { reportingKindAffectsRowTone } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-annual-report-tab.service.ts'),
  'utf8',
);
const operationalSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
  'utf8',
);
const migration217 = readFileSync(
  join(dir, '../../../../supabase/migrations/217_client_annual_document_tax_year.sql'),
  'utf8',
);

test('שודר for 2025 sets filing status הוגש for 2025 only; 2026 stays לא הוגש', () => {
  const board = buildAnnualFilingYearBoard({
    currentTaxYear: 2026,
    workingTaxYear: 2026,
    canEdit: true,
    submissions: [{ tax_year: 2025, submitted_on: '2026-04-10' }],
  });
  assert.deepEqual(
    board.map((row) => ({ year: row.tax_year, code: row.filing_status.code, filed: row.filed })),
    [
      { year: 2026, code: 'not_filed', filed: false },
      { year: 2025, code: 'filed', filed: true },
      { year: 2024, code: 'not_filed', filed: false },
    ],
  );
  assert.equal(board[0]?.filing_status.label_key, 'clientOperations.annual.notFiledStatus');
  assert.equal(board[1]?.filing_status.label_key, 'clientOperations.annual.filedStatus');
  assert.equal(board[1]?.submitted_on, '2026-04-10');
  assert.equal(board[0]?.is_working, true);
  assert.equal(board[1]?.is_working, false);
});

test('year list is backend-owned from current tax year, not hardcoded 2024/2025/2026', () => {
  assert.equal(resolveCurrentAnnualTaxYear(new Date('2027-02-01T00:00:00.000Z')), 2027);
  const board = buildAnnualFilingYearBoard({
    currentTaxYear: 2027,
    workingTaxYear: 2027,
    canEdit: false,
    submissions: [{ tax_year: 2025, submitted_on: '2026-04-10' }],
  });
  assert.deepEqual(
    board.map((row) => row.tax_year),
    [2027, 2026, 2025],
  );
  assert.equal(board[2]?.filed, true);
  assert.equal(board[0]?.can_select_working, false);
});

test('rolling board follows 2026 → 2027 → 2028 without frontend year lists', () => {
  assert.equal(resolveCurrentAnnualTaxYear(new Date('2026-06-15T00:00:00.000Z')), 2026);
  assert.equal(resolveCurrentAnnualTaxYear(new Date('2027-01-01T00:00:00.000Z')), 2027);
  assert.equal(resolveCurrentAnnualTaxYear(new Date('2028-12-31T23:59:59.000Z')), 2028);
  assert.deepEqual(
    buildAnnualFilingYearBoard({
      currentTaxYear: 2026,
      workingTaxYear: 2026,
      canEdit: true,
      submissions: [],
    }).map((row) => row.tax_year),
    [2026, 2025, 2024],
  );
  assert.deepEqual(
    buildAnnualFilingYearBoard({
      currentTaxYear: 2027,
      workingTaxYear: 2027,
      canEdit: true,
      submissions: [],
    }).map((row) => row.tax_year),
    [2027, 2026, 2025],
  );
  assert.deepEqual(
    buildAnnualFilingYearBoard({
      currentTaxYear: 2028,
      workingTaxYear: 2028,
      canEdit: true,
      submissions: [],
    }).map((row) => row.tax_year),
    [2028, 2027, 2026],
  );
});

test('older tax year outside the last three remains selectable for a late annual filing', () => {
  const older = buildAnnualOlderTaxYearOptions({
    currentTaxYear: 2026,
    workingTaxYear: 2023,
    canEdit: true,
    boardYears: [2026, 2025, 2024],
    knownYears: [{ tax_year: 2023, submitted_on: null }],
  });
  assert.equal(older.some((row) => row.tax_year === 2026), false);
  assert.equal(older.some((row) => row.tax_year === 2024), false);
  const late = older.find((row) => row.tax_year === 2023);
  assert.equal(late?.can_select, true);
  assert.equal(late?.is_working, true);
  assert.equal(late?.filed, false);
  assert.deepEqual(
    annualTabViewTaxYears({
      boardYears: [2026, 2025, 2024],
      olderYears: older.map((row) => row.tax_year),
      workingTaxYear: 2023,
    }).slice(0, 4),
    [2026, 2025, 2024, 2023],
  );
});

test('checklist + filing files of 2025 live in one folder; re-file does not duplicate the folder', () => {
  const folders = buildAnnualYearFolders({
    submissions: [
      {
        submission_id: 's-2025-a',
        tax_year: 2025,
        submitted_on: '2026-04-10',
        files: [
          {
            file_asset_id: 'check-1',
            file_name: '106.pdf',
            source_kind: 'checklist',
            source_kind_label_key: 'clientOperations.registry.reporting.annualCapital.checklistFile',
            can_open: true,
          },
        ],
      },
      {
        submission_id: 's-2025-b',
        tax_year: 2025,
        submitted_on: '2026-04-11',
        files: [
          {
            file_asset_id: 'form-1',
            file_name: '1301.pdf',
            source_kind: 'form_1301',
            source_kind_label_key: 'clientOperations.registry.reporting.annualCapital.form1301',
            can_open: true,
          },
          {
            file_asset_id: 'check-1',
            file_name: '106.pdf',
            source_kind: 'checklist',
            source_kind_label_key: 'clientOperations.registry.reporting.annualCapital.checklistFile',
            can_open: true,
          },
        ],
      },
    ],
  });
  assert.equal(folders.length, 1);
  assert.equal(folders[0]?.folder_key, '2025');
  assert.deepEqual(
    folders[0]?.files.map((file) => file.file_asset_id),
    ['check-1', 'form-1'],
  );
});

test('2025 files stay out of the 2026 working set; unscoped archive rows are not invented into a year', () => {
  const rows = [
    { id: 'legacy', tax_year: null, file_asset_id: 'legacy-file' },
    { id: 'y2025', tax_year: 2025, file_asset_id: 'file-2025' },
    { id: 'y2026', tax_year: 2026, file_asset_id: null },
  ];
  const working2026 = workingDocumentRowsForTaxYear(rows, {
    yearColumnSupported: true,
    workingTaxYear: 2026,
    tabScope: 'annual_report',
  });
  assert.deepEqual(
    working2026.map((row) => row.id),
    ['y2026'],
  );
  const filing2025 = checklistFileIdsForFilingYear(rows, {
    yearColumnSupported: true,
    taxYear: 2025,
    tabScope: 'annual_report',
  });
  assert.deepEqual(filing2025, ['file-2025']);
  assert.deepEqual(
    checklistFileIdsForFilingYear(rows, {
      yearColumnSupported: true,
      taxYear: 0,
      tabScope: 'annual_report',
    }),
    [],
  );
  assert.deepEqual(provenYearScopedChecklistFiles(rows, 0).map((row) => row.id), []);
  assert.deepEqual(
    provenYearScopedChecklistFiles(rows, 2025).map((row) => row.id),
    ['y2025'],
  );
  const legacyAll = workingDocumentRowsForTaxYear(rows, {
    yearColumnSupported: false,
    workingTaxYear: 2026,
    tabScope: 'annual_report',
  });
  assert.equal(legacyAll.length, 3);
});

test('archive documents are not deleted by year isolation; capital stays unscoped', () => {
  const rows = [
    { id: 'y2025', tax_year: 2025, file_asset_id: 'file-2025' },
    { id: 'y2024', tax_year: 2024, file_asset_id: 'file-2024' },
  ];
  const working = workingDocumentRowsForTaxYear(rows, {
    yearColumnSupported: true,
    workingTaxYear: 2026,
    tabScope: 'annual_report',
  });
  assert.equal(working.length, 0);
  assert.equal(rows.length, 2);
  const capital = workingDocumentRowsForTaxYear(rows, {
    yearColumnSupported: true,
    workingTaxYear: 2026,
    tabScope: 'capital_declaration',
  });
  assert.equal(capital.length, 2);
});

test('annual KPI for the selected reporting period is not owned by the annual tab year board', () => {
  assert.equal(reportingKindAffectsRowTone('annual'), false);
  assert.equal(resolveWorkingTaxYear({ profileWorkingTaxYear: null, currentTaxYear: 2026 }), 2026);
  assert.equal(resolveWorkingTaxYear({ profileWorkingTaxYear: 2025, currentTaxYear: 2026 }), 2025);
});

test('linked file presentation stays backend-owned and unique by asset id', () => {
  assert.equal(fileTypeLabelFromMeta({ file_name: 'form-1301.pdf', mime_type: 'image/png' }), 'PDF');
  assert.equal(fileTypeLabelFromMeta({ file_name: null, mime_type: 'application/pdf' }), 'PDF');
  const unique = uniqueLinkedFileIds([
    { file_asset_id: 'a' },
    { file_asset_id: 'a' },
    { file_asset_id: 'b' },
  ]);
  assert.deepEqual(
    unique.map((row) => row.file_asset_id),
    ['a', 'b'],
  );
});

test('filed 2025 hides working checklist and missing-as-problem; 2026 not filed keeps checklist', () => {
  const filed = buildAnnualYearPresentationFlags({
    tax_year: 2025,
    filed: true,
    submitted_on: '2026-04-10',
    canEdit: true,
  });
  assert.equal(filed?.filing_tone, 'green');
  assert.equal(filed?.show_working_checklist, false);
  assert.equal(filed?.show_documents_year_heading, false);
  assert.equal(filed?.show_missing_as_active_problem, false);
  assert.equal(filed?.show_filed_confirmation, true);
  assert.equal(filed?.archive_folder_key, '2025');
  const open = buildAnnualYearPresentationFlags({
    tax_year: 2026,
    filed: false,
    submitted_on: null,
    canEdit: true,
  });
  assert.equal(open?.filing_tone, 'yellow');
  assert.equal(open?.show_working_checklist, true);
  assert.equal(open?.show_documents_year_heading, true);
  assert.equal(open?.documents_year_heading_label_key, 'clientOperations.annual.documentsForTaxYear');
  assert.equal(open?.show_missing_as_active_problem, true);
  assert.equal(open?.show_filed_confirmation, false);
  assert.equal(buildAnnualYearPresentationFlags({ tax_year: 0, filed: false, submitted_on: null, canEdit: true }), null);
});

test('GET capital tab loads existing instance folders without seeding a profile', () => {
  assert.match(serviceSrc, /loadCapitalRequirementFoldersForClient/);
  assert.match(
    serviceSrc,
    /buildCapitalFallbackReadModel\(canEditEarly\),\s*capital_folders:\s*await loadCapitalRequirementFoldersForClient/,
  );
  assert.match(serviceSrc, /Does not seed a profile or create instances/);
  assert.match(serviceSrc, /client_capital_declaration_instances/);
  const readOnlyIdx = serviceSrc.indexOf('if (options?.readOnly)');
  const elseIdx = serviceSrc.indexOf('} else {', readOnlyIdx);
  const readOnlyBlock = serviceSrc.slice(readOnlyIdx, elseIdx);
  assert.match(readOnlyBlock, /loadCapitalRequirementFoldersForClient/);
  assert.doesNotMatch(readOnlyBlock, /ensureProfile\(/);
});

test('annual tab service keeps Core → Commands → Aggregate: named command, refreshed truth, tenant/RBAC/audit/i18n', () => {
  assert.match(serviceSrc, /select_annual_working_tax_year/);
  assert.match(serviceSrc, /parseAnnualWorkingTaxYear\(payload.tax_year\)/);
  assert.doesNotMatch(serviceSrc, /filing_years\.some/);
  assert.match(serviceSrc, /filing_years/);
  assert.match(serviceSrc, /older_tax_years/);
  assert.match(serviceSrc, /year_views/);
  assert.match(serviceSrc, /working_tax_year/);
  assert.match(serviceSrc, /if \(!options\?\.readOnly\) \{/);
  assert.match(serviceSrc, /document_readiness/);
  assert.match(serviceSrc, /getAnnualTabReadModel\(ctx, clientId, scope\)/);
  assert.match(serviceSrc, /annual_report_tab\.view/);
  assert.match(serviceSrc, /annual_report_tab\.edit/);
  assert.match(serviceSrc, /AUDIT_ACTIONS\.CLIENT_ANNUAL_REPORT_UPDATED/);
  assert.match(serviceSrc, /eq\('organization_id', orgId\)/);
  assert.match(serviceSrc, /clientOperations\.annual\.filedStatus/);
  assert.match(serviceSrc, /clientOperations\.annual\.notFiledStatus/);
  assert.match(serviceSrc, /TEMPORARY_COUNTRY_PACK_PENDING/);
  assert.match(operationalSrc, /checklistFileIdsForFilingYear/);
  assert.match(operationalSrc, /tabScope: 'annual_report',\s*taxYear,/);
  assert.doesNotMatch(operationalSrc, /select\(yearColumnSupported \?/);
  assert.match(migration217, /tax_year/);
  assert.match(migration217, /working_tax_year/);
  assert.match(migration217, /NOT backfilled/i);
  assert.doesNotMatch(serviceSrc, /latestFiled/);
});
