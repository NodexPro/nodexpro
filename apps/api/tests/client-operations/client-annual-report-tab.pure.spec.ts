import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAnnualFilingYearBoard,
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
  assert.equal(open?.show_missing_as_active_problem, true);
  assert.equal(open?.show_filed_confirmation, false);
  assert.equal(buildAnnualYearPresentationFlags({ tax_year: 0, filed: false, submitted_on: null, canEdit: true }), null);
});

test('annual tab service keeps Core → Commands → Aggregate: named command, refreshed truth, tenant/RBAC/audit/i18n', () => {
  assert.match(serviceSrc, /select_annual_working_tax_year/);
  assert.match(serviceSrc, /filing_years/);
  assert.match(serviceSrc, /year_views/);
  assert.match(serviceSrc, /working_tax_year/);
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
