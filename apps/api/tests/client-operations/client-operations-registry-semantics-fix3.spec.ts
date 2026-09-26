/**
 * FIX 3 — מ״ה ניכויים / שכר / PCN registry semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIncomeTaxDeductionsRegistryCell,
  computeOperationalPeriodApplicability,
  resolvePayrollApplicabilityFromDeductionsFiles,
  type OperationalPeriodSnapshotInputs,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';
import {
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  formatPcnRegistryDisplay,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { formatQuickProfilePayrollDisplayHe } from '../../src/domains/client-operations/client-operations-client-quick-profile.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const registryView = readFileSync(
  join(dir, '../../../../apps/web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const registryCmd = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const periodSvc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-operational-period.service.ts'),
  'utf8',
);

const base = (o: Partial<OperationalPeriodSnapshotInputs> = {}): OperationalPeriodSnapshotInputs => ({
  vat_type: 'yes',
  vat_frequency: 'monthly',
  payroll_flag: false,
  income_tax_advance_enabled: false,
  income_tax_advance_frequency: null,
  income_tax_deductions_enabled: true,
  income_tax_deductions_file_number: null,
  income_tax_deductions_frequency: null,
  national_insurance_type: null,
  national_insurance_monthly_amount: null,
  national_insurance_deductions_file_number: null,
  ...o,
});

// ——— מ״ה ניכויים ———

test('1 — no IT deductions file → cell not configured (dash)', () => {
  const cell = buildIncomeTaxDeductionsRegistryCell({
    configured: false,
    due: false,
    completed: false,
  });
  assert.equal(cell.configured, false);
  assert.equal(cell.editable, false);
  assert.equal(cell.value, null);
});

test('2 — file + monthly + due month → active checkbox', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-09',
    base({
      income_tax_deductions_file_number: '935',
      income_tax_deductions_frequency: 'monthly',
    }),
  );
  assert.equal(appl.income_tax_deductions_applicable, true);
  const cell = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: true,
    completed: false,
  });
  assert.equal(cell.applicable, true);
  assert.equal(cell.editable, true);
  assert.equal(cell.completed, false);
});

test('3 — file + bi_monthly + even VAT-cadence month → active', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-08',
    base({
      income_tax_deductions_file_number: '935',
      income_tax_deductions_frequency: 'bi_monthly',
    }),
  );
  assert.equal(appl.income_tax_deductions_applicable, true);
});

test('4 — file + bi_monthly + non-reporting month → disabled checkbox NOT dash', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-09',
    base({
      income_tax_deductions_file_number: '935',
      income_tax_deductions_frequency: 'bi_monthly',
    }),
  );
  assert.equal(appl.income_tax_deductions_applicable, false);
  const cell = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: false,
    completed: false,
  });
  assert.equal(cell.configured, true);
  assert.equal(cell.due, false);
  assert.equal(cell.editable, false);
  assert.equal(cell.applicable, false);
});

test('5/6 — file + semi_annual Jan/Jun → active', () => {
  for (const key of ['2026-01', '2026-06'] as const) {
    const appl = computeOperationalPeriodApplicability(
      key,
      base({
        income_tax_deductions_file_number: '935',
        income_tax_deductions_frequency: 'semi_annual',
      }),
    );
    assert.equal(appl.income_tax_deductions_applicable, true, key);
  }
});

test('7 — file + semi_annual February → disabled checkbox NOT dash', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-02',
    base({
      income_tax_deductions_file_number: '935',
      income_tax_deductions_frequency: 'semi_annual',
    }),
  );
  assert.equal(appl.income_tax_deductions_applicable, false);
  const cell = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: false,
    completed: null,
  });
  assert.equal(cell.configured, true);
  assert.equal(cell.editable, false);
});

test('8 — disabled checkbox cannot execute completion command (source)', () => {
  assert.match(registryCmd, /set_income_tax_deductions_reported/);
  assert.match(registryCmd, /income_tax_deductions_applicable/);
  assert.match(registryView, /!cell\?\.configured \|\| !cell\.due \|\| !cell\.editable/);
  assert.match(registryView, /disabled=\{!active/);
});

test('completed due month → checked', () => {
  const cell = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: true,
    completed: true,
  });
  assert.equal(cell.completed, true);
  assert.equal(cell.value, true);
});

// ——— שכר ———

test('9 — no IT + no NI file → payroll false', () => {
  assert.equal(
    resolvePayrollApplicabilityFromDeductionsFiles({
      income_tax_deductions_file_number: null,
      national_insurance_deductions_file_number: null,
    }),
    false,
  );
});

test('10 — IT file only → payroll every month', () => {
  const applOdd = computeOperationalPeriodApplicability(
    '2026-09',
    base({ income_tax_deductions_file_number: '111', income_tax_deductions_frequency: 'bi_monthly' }),
  );
  const applEven = computeOperationalPeriodApplicability(
    '2026-08',
    base({ income_tax_deductions_file_number: '111', income_tax_deductions_frequency: 'bi_monthly' }),
  );
  assert.equal(applOdd.payroll_applicable, true);
  assert.equal(applEven.payroll_applicable, true);
  // IT deductions still cadence-gated:
  assert.equal(applOdd.income_tax_deductions_applicable, false);
  assert.equal(applEven.income_tax_deductions_applicable, true);
});

test('11 — NI file only → payroll every month', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-09',
    base({
      income_tax_deductions_file_number: null,
      national_insurance_deductions_file_number: 'NI-9',
    }),
  );
  assert.equal(appl.payroll_applicable, true);
});

test('12 — both files → payroll every month', () => {
  const appl = computeOperationalPeriodApplicability(
    '2026-09',
    base({
      income_tax_deductions_file_number: 'IT',
      income_tax_deductions_frequency: 'monthly',
      national_insurance_deductions_file_number: 'NI',
    }),
  );
  assert.equal(appl.payroll_applicable, true);
});

test('13 — payroll completion still uses salary_data_received (source)', () => {
  assert.match(periodSvc, /loadPayrollPeriodSalaryDataReceived/);
  assert.match(periodSvc, /salary_data_received/);
});

test('14 — either file → Quick Profile שכר = כן', () => {
  assert.equal(formatQuickProfilePayrollDisplayHe(true), 'כן');
});

test('15 — neither file → Quick Profile שכר = לא', () => {
  assert.equal(formatQuickProfilePayrollDisplayHe(false), 'לא');
});

test('16 — tax reconcile still uses atomic RPC (source)', () => {
  assert.match(periodSvc, /replace_client_operations_period_applicability_snapshot/);
  assert.match(
    readFileSync(
      join(dir, '../../src/domains/client-operations/client-tax-settings.service.ts'),
      'utf8',
    ),
    /reconcileCurrentOpenPeriodApplicabilitySnapshotForClient/,
  );
});

test('17 — historical snapshots remain frozen (source contract)', () => {
  assert.match(periodSvc, /isCurrentOpenOperationalPeriodKey/);
  assert.doesNotMatch(periodSvc, /disable trigger/i);
});

// ——— PCN ———

test('18 — vat_due_type pcn → PCN', () => {
  assert.equal(formatPcnRegistryDisplay('pcn'), 'PCN');
});

test('19 — not pcn → empty (not dash)', () => {
  assert.equal(formatPcnRegistryDisplay('regular'), '');
  assert.equal(formatPcnRegistryDisplay('not_relevant'), '');
  assert.equal(formatPcnRegistryDisplay(null), '');
});

test('20 — PCN column immediately precedes מע״מ', () => {
  const keys = CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => c.key);
  const pcn = keys.indexOf('pcn');
  const vat = keys.indexOf('vat');
  assert.ok(pcn >= 0 && vat >= 0);
  assert.equal(pcn + 1, vat);
  const col = CLIENT_OPERATIONS_REGISTRY_COLUMNS[pcn];
  assert.equal(col.label, 'PCN');
  assert.ok((col.default_width_px ?? 0) >= 48 && (col.default_width_px ?? 0) <= 56);
});

test('21 — no frontend PCN derivation from frequency', () => {
  assert.doesNotMatch(registryView, /vat_due_type\s*===\s*['"]pcn['"]/);
  assert.match(registryView, /col\.key === 'pcn'/);
});

test('22 — no PCN completion command', () => {
  assert.doesNotMatch(registryCmd, /set_pcn|pcn_reported|complete_pcn/);
});

test('FE renders disabled ITD checkbox when configured+not due', () => {
  assert.match(registryView, /income_tax_deductions_cell/);
  assert.match(registryView, /יש תיק ניכויים — אין דיווח בחודש זה/);
  assert.match(registryView, /set_income_tax_deductions_reported/);
});

test('payroll no longer driven by profile payroll_flag alone (pure)', () => {
  const noFilesButFlag = computeOperationalPeriodApplicability(
    '2026-09',
    base({ payroll_flag: true, income_tax_deductions_file_number: null }),
  );
  assert.equal(noFilesButFlag.payroll_applicable, false);
});
