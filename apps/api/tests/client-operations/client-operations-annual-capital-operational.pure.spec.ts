import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pureSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.ts'),
  'utf8',
);

function resolveAnnualReportTaxYearForOperationalPeriodForContract(operationalPeriodKey: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(operationalPeriodKey);
  if (!match) throw new Error(`Invalid operational_period_key: ${operationalPeriodKey}`);
  return Number(match[1]) - 1;
}

function buildAnnualReportCellForContract(input: {
  taxYear: number;
  instanceId: string | null;
  operationalTargetDate: string | null;
  canEdit: boolean;
}) {
  return {
    applicable: true,
    editable: input.canEdit,
    tax_year: input.taxYear,
    instance_id: input.instanceId,
    operational_target_date: input.operationalTargetDate,
  };
}

function buildCapitalDeclarationCellForContract(input: {
  openInstance: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
  } | null;
  canEdit: boolean;
}) {
  if (!input.openInstance) {
    return {
      applicable: true,
      editable: input.canEdit,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      assignment_state: 'unassigned',
      can_open: false,
    };
  }
  return {
    applicable: true,
    editable: input.canEdit,
    instance_id: input.openInstance.id,
    tax_year: input.openInstance.tax_year,
    operational_target_date: input.openInstance.operational_target_date,
    assignment_state: 'assigned',
    can_open: false,
  };
}

function formatOperationalDateDisplayHeForContract(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).trim());
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

test('annual report tax year resolves from operational period year minus one', () => {
  assert.match(pureSource, /export function resolveAnnualReportTaxYearForOperationalPeriod/);
  assert.match(pureSource, /return parts\.year - 1/);
  assert.equal(resolveAnnualReportTaxYearForOperationalPeriodForContract('2026-08'), 2025);
  assert.equal(resolveAnnualReportTaxYearForOperationalPeriodForContract('2026-01'), 2025);
  assert.equal(resolveAnnualReportTaxYearForOperationalPeriodForContract('2026-12'), 2025);
  assert.equal(resolveAnnualReportTaxYearForOperationalPeriodForContract('2027-01'), 2026);
});

test('annual report cell is always applicable and carries backend date truth', () => {
  assert.match(pureSource, /export function buildAnnualReportCell/);
  assert.match(pureSource, /applicable:\s*true/);
  assert.deepEqual(
    buildAnnualReportCellForContract({
      taxYear: 2025,
      instanceId: 'annual-1',
      operationalTargetDate: '2026-09-30',
      canEdit: true,
    }),
    {
      applicable: true,
      editable: true,
      tax_year: 2025,
      instance_id: 'annual-1',
      operational_target_date: '2026-09-30',
    },
  );
});

test('capital declaration cell exposes N/A open affordance until an open instance exists', () => {
  assert.match(pureSource, /export function buildCapitalDeclarationCell/);
  assert.match(pureSource, /assignment_state:\s*'unassigned'/);
  assert.deepEqual(
    buildCapitalDeclarationCellForContract({
      openInstance: null,
      canEdit: true,
    }),
    {
      applicable: true,
      editable: true,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      assignment_state: 'unassigned',
      can_open: false,
    },
  );

  assert.deepEqual(
    buildCapitalDeclarationCellForContract({
      openInstance: {
        id: 'capital-1',
        tax_year: 2025,
        operational_target_date: '2026-10-01',
      },
      canEdit: true,
    }),
    {
      applicable: true,
      editable: true,
      instance_id: 'capital-1',
      tax_year: 2025,
      operational_target_date: '2026-10-01',
      assignment_state: 'assigned',
      can_open: false,
    },
  );
});

test('operational dates display as Hebrew day/month/year from date-only input', () => {
  assert.match(pureSource, /export function formatOperationalDateDisplayHe/);
  assert.equal(formatOperationalDateDisplayHeForContract('2026-09-30'), '30/09/2026');
  assert.equal(formatOperationalDateDisplayHeForContract(null), '—');
  assert.equal(formatOperationalDateDisplayHeForContract('not-a-date'), '—');
});

test('annual square and KPI tax year stay on the tab year even if another year is already filed', async () => {
  const {
    buildAnnualReportCell,
    annualFilingUsesTabTaxYear,
    buildAnnualYearFolders,
    buildCapitalRequirementFolders,
    nextCapitalDeclarationSequenceNo,
    pickVisibleCapitalInstance,
    buildCapitalDeclarationCell,
  } = await import('../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js');
  const cell = buildAnnualReportCell({
    taxYear: 2025,
    instanceId: 'annual-1',
    operationalTargetDate: '2026-10-31',
    canEdit: true,
    submissions: [
      { tax_year: 2024, submitted_on: '2025-04-01' },
      { tax_year: 2025, submitted_on: '2026-04-10' },
    ],
  });
  assert.equal(cell.filing.tab_tax_year, 2025);
  assert.equal(cell.filing.filed_for_tab_tax_year, true);
  assert.equal(cell.filing.square_chrome, 'filed');
  const otherYearOnly = buildAnnualReportCell({
    taxYear: 2025,
    instanceId: null,
    operationalTargetDate: null,
    canEdit: true,
    submissions: [{ tax_year: 2024, submitted_on: '2025-04-01' }],
  });
  assert.equal(otherYearOnly.filing.square_chrome, 'empty');
  assert.equal(otherYearOnly.filing.filed_for_tab_tax_year, false);
  assert.equal(annualFilingUsesTabTaxYear({ taxYear: 2024, tabTaxYear: 2025, confirmOtherTaxYear: false }).ok, false);
  assert.equal(annualFilingUsesTabTaxYear({ taxYear: 2024, tabTaxYear: 2025, confirmOtherTaxYear: true }).ok, true);
  const folders = buildAnnualYearFolders({
    submissions: [
      { submission_id: 's-2025', tax_year: 2025, submitted_on: '2026-04-10', files: [] },
      { submission_id: 's-2025b', tax_year: 2025, submitted_on: '2026-04-11', files: [] },
    ],
  });
  assert.equal(folders.length, 1);
  assert.equal(folders[0]?.folder_key, '2025');
  assert.equal(nextCapitalDeclarationSequenceNo([1, 3]), 4);
  const visibleCompleted = pickVisibleCapitalInstance({
    openInstance: null,
    datedCompletedInstance: {
      id: 'cap-1',
      tax_year: null,
      operational_target_date: '2026-06-01',
      sequence_no: 2,
    },
  });
  assert.equal(visibleCompleted?.status, 'completed');
  const completedCell = buildCapitalDeclarationCell({
    openInstance: null,
    datedCompletedInstance: {
      id: 'cap-1',
      tax_year: null,
      operational_target_date: '2026-06-01',
      sequence_no: 2,
    },
    canEdit: true,
    submittedOn: '2026-06-02',
  });
  assert.equal(completedCell.applicable, true);
  assert.equal(completedCell.editable, false);
  assert.equal(completedCell.can_open, true);
  assert.equal(completedCell.filing.square_chrome, 'filed');
  const capitalFolders = buildCapitalRequirementFolders({
    instances: [
      { id: 'b', sequence_no: 2, status: 'open', operational_target_date: null, submitted_on: null, files: [] },
      { id: 'a', sequence_no: 1, status: 'completed', operational_target_date: '2026-01-01', submitted_on: '2026-01-02', files: [] },
    ],
  });
  assert.deepEqual(
    capitalFolders.map((row) => row.sequence_no),
    [1, 2],
  );
  assert.equal(completedCell.assignment_state, 'filed');
  assert.equal(completedCell.filing.square_visible, true);
  assert.equal(completedCell.allowed_actions.can_open_new, true);
  assert.equal(completedCell.allowed_actions.can_set_date, false);
});

test('unassigned capital keeps calendar and square without creating an instance', async () => {
  const { buildCapitalDeclarationCell } = await import(
    '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js'
  );
  const unassigned = buildCapitalDeclarationCell({
    openInstance: null,
    canEdit: true,
  });
  assert.equal(unassigned.applicable, true);
  assert.equal(unassigned.editable, true);
  assert.equal(unassigned.assignment_state, 'unassigned');
  assert.equal(unassigned.filing.square_visible, true);
  assert.equal(unassigned.filing.can_open_modal, true);
  assert.equal(unassigned.allowed_actions.can_file, true);
  assert.equal(unassigned.can_open, false);
  const assigned = buildCapitalDeclarationCell({
    openInstance: {
      id: 'capital-open',
      tax_year: 2025,
      operational_target_date: null,
    },
    canEdit: true,
  });
  assert.equal(assigned.assignment_state, 'assigned');
  assert.equal(assigned.filing.square_visible, true);
  assert.equal(assigned.filing.square_chrome, 'empty');
  assert.equal(assigned.allowed_actions.can_open_modal, true);
});

test('capital date command creates an instance instead of requiring one on GET', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const start = serviceSource.indexOf('export async function setCapitalDeclarationOperationalTargetDate');
  const end = serviceSource.indexOf('export async function completeCapitalDeclarationInstance');
  const slice = serviceSource.slice(start, end);
  assert.match(slice, /openCapitalDeclarationInstance/);
  assert.doesNotMatch(slice, /No open capital declaration instance for this client/);
  assert.match(slice, /date == null/);
});

test('annual tax year options treat a missing submitted_on as not filed', async () => {
  const { buildAnnualTaxYearOptions } = await import(
    '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js'
  );
  const options = buildAnnualTaxYearOptions({
    tabTaxYear: 2025,
    submissions: [
      { tax_year: 2025, submitted_on: '2026-04-10' },
      { tax_year: 2024, submitted_on: null },
    ],
  });
  assert.equal(options.find((row) => row.tax_year === 2025)?.already_filed, true);
  assert.equal(options.find((row) => row.tax_year === 2024)?.already_filed, false);
});

test('capital file command creates an instance when none exists', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const start = serviceSource.indexOf('export async function fileClientOperationsCapitalDeclaration');
  const slice = serviceSource.slice(start);
  assert.match(slice, /openCapitalDeclarationInstance/);
  assert.doesNotMatch(slice, /CAPITAL_FILING_INSTANCE_REQUIRED/);
});

test('completed capital without a calendar date still files the square and keeps the assigned date', async () => {
  const { buildCapitalDeclarationCell, pickVisibleCapitalInstance } = await import(
    '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js'
  );
  const completed = buildCapitalDeclarationCell({
    openInstance: null,
    datedCompletedInstance: {
      id: 'cap-filed',
      tax_year: null,
      operational_target_date: null,
      sequence_no: 1,
    },
    canEdit: true,
    submittedOn: '2026-06-02',
  });
  assert.equal(completed.filing.square_chrome, 'filed');
  assert.equal(completed.assignment_state, 'filed');
  assert.equal(completed.operational_target_date, null);
  assert.equal(completed.filing.submitted_on, '2026-06-02');
  assert.equal(completed.allowed_actions.can_set_date, false);
  assert.equal(completed.allowed_actions.can_open_new, true);
  const openPreferred = pickVisibleCapitalInstance({
    openInstance: {
      id: 'cap-new',
      tax_year: null,
      operational_target_date: '2026-11-01',
      status: 'open',
    },
    datedCompletedInstance: {
      id: 'cap-filed',
      tax_year: null,
      operational_target_date: null,
      status: 'completed',
    },
  });
  assert.equal(openPreferred?.id, 'cap-new');
  assert.equal(openPreferred?.status, 'open');
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const loader = serviceSource.slice(
    serviceSource.indexOf('export async function loadLatestDatedCompletedCapitalInstancesForClients'),
    serviceSource.indexOf('export async function loadAnnualSubmissionFactsForClients'),
  );
  assert.doesNotMatch(loader, /operational_target_date',\s*'is',\s*null/);
});

test('capital שודר copies checklist file_asset links into the instance archive then clears the working checklist', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const start = serviceSource.indexOf('export async function fileClientOperationsCapitalDeclaration');
  const slice = serviceSource.slice(start, start + 4500);
  assert.match(slice, /loadChecklistFileLinks/);
  assert.match(slice, /upsertSubmissionFileLinks/);
  assert.match(serviceSource, /source_kind: 'checklist'/);
  const upsertIdx = slice.indexOf('upsertSubmissionFileLinks');
  const resetIdx = slice.indexOf('update({ received: false, file_asset_id: null })');
  assert.ok(upsertIdx > 0 && resetIdx > upsertIdx);
  assert.match(slice, /tab_scope', 'capital_declaration'/);
  assert.doesNotMatch(slice, /storage\.from\(.*\)\.copy/);
});
