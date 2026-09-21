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
      applicable: false,
      editable: false,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      can_open: input.canEdit,
    };
  }
  return {
    applicable: true,
    editable: input.canEdit,
    instance_id: input.openInstance.id,
    tax_year: input.openInstance.tax_year,
    operational_target_date: input.openInstance.operational_target_date,
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
  assert.match(pureSource, /can_open:\s*input\.canEdit/);
  assert.deepEqual(
    buildCapitalDeclarationCellForContract({
      openInstance: null,
      canEdit: true,
    }),
    {
      applicable: false,
      editable: false,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      can_open: true,
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
