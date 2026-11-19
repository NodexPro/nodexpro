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

test('registry projection uses event timestamps and does not treat submitted_on as the filed month', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const registrySource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(serviceSource, /projectAnnualCapitalCycleOntoPeriod/);
  assert.match(serviceSource, /filingConfirmedAt: tabSubmission\?\.created_at/);
  assert.match(serviceSource, /operational_period_key: input.operationalPeriodKey/);
  assert.match(registrySource, /operationalPeriodKey: selectedPeriodKey/);
  assert.match(registrySource, /loadCapitalDeclarationInstancesForClients/);
  assert.doesNotMatch(
    serviceSource.slice(
      serviceSource.indexOf('export function projectAnnualReportCells'),
      serviceSource.indexOf('export async function loadAnnualReportSubmissionsForTaxYear'),
    ),
    /submitted_on.*square_chrome/,
  );
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

test('registry month tabs project annual/capital cycles from event timestamps, not global filed', async () => {
  const {
    projectAnnualCapitalCycleOntoPeriod,
    buildAnnualPeriodCycles,
    buildCapitalPeriodCycles,
    applyAnnualPeriodProjection,
    applyCapitalPeriodProjection,
    buildAnnualReportCell,
    buildCapitalDeclarationCell,
    operationalPeriodKeyFromEventTimestamp,
  } = await import('../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js');

  assert.equal(operationalPeriodKeyFromEventTimestamp('2026-01-12T08:00:00.000Z'), '2026-01');
  assert.equal(operationalPeriodKeyFromEventTimestamp('2026-10-03T22:30:00.000Z'), '2026-10');
  assert.equal(operationalPeriodKeyFromEventTimestamp(null), null);

  const annualCycles = buildAnnualPeriodCycles({
    instance: {
      id: 'annual-1',
      tax_year: 2025,
      operational_target_date: '2026-01-20',
      status: 'completed',
      created_at: '2026-01-05T10:00:00.000Z',
      updated_at: '2026-10-12T10:00:00.000Z',
    },
    filingConfirmedAt: '2026-10-12T10:00:00.000Z',
  });
  const jan = projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-01', cycles: annualCycles });
  const sep = projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-09', cycles: annualCycles });
  const oct = projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-10', cycles: annualCycles });
  const nov = projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-11', cycles: annualCycles });
  assert.equal(jan.kind, 'assigned');
  assert.equal(jan.operational_target_date, '2026-01-20');
  assert.equal(sep.kind, 'assigned');
  assert.equal(sep.cycle_closed, true);
  assert.equal(oct.kind, 'filed');
  assert.equal(oct.operational_target_date, '2026-01-20');
  assert.equal(nov.kind, 'empty');
  assert.equal(nov.operational_target_date, null);

  const annualCell = buildAnnualReportCell({
    taxYear: 2025,
    instanceId: 'annual-1',
    operationalTargetDate: '2026-01-20',
    canEdit: true,
    submissions: [{ tax_year: 2025, submitted_on: '2026-09-30' }],
  });
  assert.equal(annualCell.filing.square_chrome, 'filed');
  const janCell = applyAnnualPeriodProjection(annualCell, jan, true);
  const octCell = applyAnnualPeriodProjection(annualCell, oct, true);
  const novCell = applyAnnualPeriodProjection(annualCell, nov, true);
  assert.equal(janCell.filing.square_chrome, 'empty');
  assert.equal(janCell.operational_target_date, '2026-01-20');
  assert.equal(janCell.editable, false);
  assert.equal(octCell.filing.square_chrome, 'filed');
  assert.equal(octCell.operational_target_date, '2026-01-20');
  assert.equal(novCell.filing.square_chrome, 'empty');
  assert.equal(novCell.operational_target_date, null);
  assert.equal(novCell.editable, true);

  const nextAnnual = buildAnnualPeriodCycles({
    instance: {
      id: 'annual-1',
      tax_year: 2025,
      operational_target_date: '2026-11-15',
      status: 'open',
      created_at: '2026-01-05T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:00.000Z',
    },
    filingConfirmedAt: '2026-10-12T10:00:00.000Z',
  });
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-10', cycles: nextAnnual }).kind,
    'filed',
  );
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-11', cycles: nextAnnual }).kind,
    'assigned',
  );
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-11', cycles: nextAnnual }).operational_target_date,
    '2026-11-15',
  );

  const capitalCycles = buildCapitalPeriodCycles([
    {
      id: 'cap-1',
      operational_target_date: '2026-01-20',
      status: 'completed',
      opened_at: '2026-01-05T10:00:00.000Z',
      completed_at: '2026-10-12T10:00:00.000Z',
    },
  ]);
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-09', cycles: capitalCycles }).kind,
    'assigned',
  );
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-10', cycles: capitalCycles }).kind,
    'filed',
  );
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-11', cycles: capitalCycles }).kind,
    'empty',
  );

  const capitalWithNew = buildCapitalPeriodCycles([
    {
      id: 'cap-1',
      operational_target_date: '2026-01-20',
      status: 'completed',
      opened_at: '2026-01-05T10:00:00.000Z',
      completed_at: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'cap-2',
      operational_target_date: '2026-11-08',
      status: 'open',
      opened_at: '2026-11-03T10:00:00.000Z',
      completed_at: null,
    },
  ]);
  const novNew = projectAnnualCapitalCycleOntoPeriod({
    operationalPeriodKey: '2026-11',
    cycles: capitalWithNew,
  });
  assert.equal(novNew.kind, 'assigned');
  assert.equal(novNew.instance_id, 'cap-2');
  assert.equal(novNew.operational_target_date, '2026-11-08');
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-10', cycles: capitalWithNew }).instance_id,
    'cap-1',
  );

  const unknownStart = projectAnnualCapitalCycleOntoPeriod({
    operationalPeriodKey: '2025-12',
    cycles: [
      {
        identity: 'legacy',
        instance_id: 'cap-legacy',
        operational_target_date: '2026-01-20',
        assigned_from_period_key: null,
        filed_period_key: '2026-10',
      },
    ],
  });
  assert.equal(unknownStart.kind, 'assigned');
  assert.equal(unknownStart.legacy_unknown_assignment_start, true);

  const unknownFiled = buildCapitalPeriodCycles([
    {
      id: 'cap-legacy-filed',
      operational_target_date: '2026-01-20',
      status: 'completed',
      opened_at: '2026-01-05T10:00:00.000Z',
      completed_at: null,
    },
  ]);
  assert.equal(
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-10', cycles: unknownFiled }).kind,
    'assigned',
  );

  const liveFiled = buildCapitalDeclarationCell({
    openInstance: null,
    datedCompletedInstance: {
      id: 'cap-1',
      tax_year: null,
      operational_target_date: '2026-01-20',
      sequence_no: 1,
    },
    canEdit: true,
    submittedOn: '2026-09-01',
  });
  const novCapital = applyCapitalPeriodProjection(
    liveFiled,
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-11', cycles: capitalCycles }),
    true,
  );
  assert.equal(novCapital.filing.square_chrome, 'empty');
  assert.equal(novCapital.assignment_state, 'unassigned');
  assert.equal(novCapital.operational_target_date, null);
});

test('capital שודר copies checklist file_asset links into the instance archive then clears the working checklist', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const start = serviceSource.indexOf('export async function fileClientOperationsCapitalDeclaration');
  const slice = serviceSource.slice(start, start + 8000);
  assert.match(slice, /loadChecklistFileLinks/);
  assert.match(slice, /upsertSubmissionFileLinks/);
  assert.match(serviceSource, /source_kind: 'checklist'/);
  const upsertIdx = slice.indexOf('upsertSubmissionFileLinks');
  const resetIdx = slice.indexOf('update({ received: false, file_asset_id: null })');
  assert.ok(upsertIdx > 0 && resetIdx > upsertIdx);
  assert.match(slice, /tab_scope', 'capital_declaration'/);
  assert.doesNotMatch(slice, /storage\.from\(.*\)\.copy/);
});

test('annual in-cycle date change restores prior months from dated events and does not leak October onto January–September', async () => {
  const {
    applyAnnualPeriodProjection,
    applyCapitalPeriodProjection,
    buildAnnualPeriodCycles,
    buildAnnualReportCell,
    buildCapitalDeclarationCell,
    buildCapitalPeriodCycles,
    overlayAnnualProjectionDate,
    projectAnnualCapitalCycleOntoPeriod,
    resolveAnnualOperationalDateForPeriod,
  } = await import('../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js');

  const instance = {
    id: 'annual-1',
    tax_year: 2025,
    operational_target_date: '2026-10-18',
    status: 'completed',
    created_at: '2026-01-08T09:00:00.000Z',
    updated_at: '2026-10-12T10:00:00.000Z',
  };
  const revisions = [
    {
      instance_id: 'annual-1',
      operational_target_date: '2026-01-20',
      effective_period_key: '2026-01',
      recorded_at: '2026-01-08T09:00:00.000Z',
    },
    {
      instance_id: 'annual-1',
      operational_target_date: '2026-10-18',
      effective_period_key: '2026-10',
      recorded_at: '2026-10-04T11:00:00.000Z',
    },
  ];
  const filingConfirmedAt = '2026-10-12T10:00:00.000Z';
  const base = buildAnnualReportCell({
    taxYear: 2025,
    instanceId: instance.id,
    operationalTargetDate: instance.operational_target_date,
    canEdit: true,
    submissions: [{ tax_year: 2025, submitted_on: '2026-09-30' }],
  });

  const cellForPeriod = (operationalPeriodKey: string) => {
    const resolved = resolveAnnualOperationalDateForPeriod({
      operationalPeriodKey,
      instanceId: instance.id,
      revisions,
      instance,
    });
    const projection = overlayAnnualProjectionDate(
      projectAnnualCapitalCycleOntoPeriod({
        operationalPeriodKey,
        cycles: buildAnnualPeriodCycles({
          instance: { ...instance, operational_target_date: resolved.operational_target_date },
          filingConfirmedAt,
        }),
      }),
      resolved,
    );
    return applyAnnualPeriodProjection(base, projection, true);
  };

  const jan = cellForPeriod('2026-01');
  const sep = cellForPeriod('2026-09');
  const oct = cellForPeriod('2026-10');
  const nov = cellForPeriod('2026-11');
  assert.equal(jan.operational_target_date, '2026-01-20');
  assert.equal(jan.filing.square_chrome, 'empty');
  assert.equal(sep.operational_target_date, '2026-01-20');
  assert.equal(sep.filing.square_chrome, 'empty');
  assert.equal(oct.operational_target_date, '2026-10-18');
  assert.equal(oct.filing.square_chrome, 'filed');
  assert.equal(nov.operational_target_date, null);
  assert.equal(nov.filing.square_chrome, 'empty');

  const laterOnly = resolveAnnualOperationalDateForPeriod({
    operationalPeriodKey: '2026-09',
    instanceId: instance.id,
    revisions: [revisions[1]],
    instance,
  });
  assert.equal(laterOnly.source, 'unknown');
  assert.equal(laterOnly.operational_target_date, null);

  const unchangedAfterFiling = resolveAnnualOperationalDateForPeriod({
    operationalPeriodKey: '2026-09',
    instanceId: instance.id,
    revisions: [],
    instance: { ...instance, operational_target_date: '2026-01-20' },
  });
  assert.equal(unchangedAfterFiling.source, 'unchanged_instance');
  assert.equal(unchangedAfterFiling.operational_target_date, '2026-01-20');

  const capitalCycles = buildCapitalPeriodCycles([
    {
      id: 'cap-1',
      operational_target_date: '2026-01-20',
      status: 'completed',
      opened_at: '2026-01-05T10:00:00.000Z',
      completed_at: '2026-10-12T10:00:00.000Z',
    },
  ]);
  const capitalSep = applyCapitalPeriodProjection(
    buildCapitalDeclarationCell({
      openInstance: null,
      datedCompletedInstance: {
        id: 'cap-1',
        tax_year: null,
        operational_target_date: '2026-01-20',
        sequence_no: 1,
      },
      canEdit: true,
      submittedOn: '2026-09-01',
    }),
    projectAnnualCapitalCycleOntoPeriod({ operationalPeriodKey: '2026-09', cycles: capitalCycles }),
    true,
  );
  assert.equal(capitalSep.operational_target_date, '2026-01-20');
  assert.equal(capitalSep.assignment_state, 'assigned');
  assert.equal(capitalSep.filing.square_chrome, 'empty');

  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-annual-capital-operational.service.ts'),
    'utf8',
  );
  const registrySource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  const dateSet = serviceSource.slice(
    serviceSource.indexOf('export async function setAnnualReportOperationalTargetDate'),
    serviceSource.indexOf('export async function openCapitalDeclarationInstance'),
  );
  assert.match(dateSet, /ANNUAL_DATE_SET_RPC/);
  assert.match(dateSet, /writeAnnualDateSetAudit/);
  assert.match(dateSet, /isSupabaseMissingRpcError/);
  assert.match(dateSet, /upsertAnnualYearInstanceDate/);
  assert.doesNotMatch(dateSet, /persistAnnualDateRevision/);
  assert.match(serviceSource, /loadAnnualDateRevisionsForClients/);
  assert.match(serviceSource, /from\('audit_log'\)/);
  assert.match(serviceSource, /CLIENT_OPERATIONS_ANNUAL_REPORT_OPERATIONAL_TARGET_DATE_SET/);
  assert.match(serviceSource, /set_client_annual_report_year_instance_date/);
  assert.match(serviceSource, /client_annual_report_year_instance_date_revisions/);
  assert.match(serviceSource, /resolveAnnualOperationalDateForPeriod/);
  assert.match(serviceSource, /overlayAnnualProjectionDate/);
  assert.match(registrySource, /loadAnnualDateRevisionsForClients/);
  assert.match(registrySource, /dateRevisionsByInstanceId/);
  const capitalProject = serviceSource.slice(
    serviceSource.indexOf('export function projectCapitalDeclarationCells'),
    serviceSource.indexOf('export async function setAnnualReportOperationalTargetDate'),
  );
  assert.doesNotMatch(capitalProject, /resolveAnnualOperationalDateForPeriod/);
  assert.doesNotMatch(capitalProject, /dateRevisionsByInstanceId/);
});

test('annual date revisions merge audit and table rows without duplicating the same period', async () => {
  const { mergeAnnualDateRevisions } = await import(
    '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js'
  );
  const merged = mergeAnnualDateRevisions([
    {
      instance_id: 'annual-1',
      operational_target_date: '2026-01-20',
      effective_period_key: '2026-01',
      recorded_at: '2026-01-08T09:00:00.000Z',
    },
    {
      instance_id: 'annual-1',
      operational_target_date: '2026-01-20',
      effective_period_key: '2026-01',
      recorded_at: '2026-01-08T09:00:00.400Z',
    },
    {
      instance_id: 'annual-1',
      operational_target_date: '2026-10-18',
      effective_period_key: '2026-10',
      recorded_at: '2026-10-04T11:00:00.000Z',
    },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.effective_period_key, '2026-01');
  assert.equal(merged[0]?.operational_target_date, '2026-01-20');
  assert.equal(merged[1]?.effective_period_key, '2026-10');
  assert.equal(merged[1]?.operational_target_date, '2026-10-18');
});

test('migration 220 creates append-only date revisions without rewriting existing history', () => {
  const sql = readFileSync(
    join(dir, '../../../../supabase/migrations/220_client_annual_report_year_instance_date_revisions.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.client_annual_report_year_instance_date_revisions/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /set_client_annual_report_year_instance_date/);
  assert.match(sql, /on conflict \(organization_id, client_id, tax_year\)/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /update public\.client_annual_report_year_instances/i);
  assert.doesNotMatch(sql, /delete from/i);
  assert.match(sql, /Does NOT backfill from the current instance date/);
});
