import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNiDeductionsRegistryCell,
  coverageEndPeriodKeyForNiDeductions126Cycle,
  deriveHorizonNiDeductions126Cycles,
  isNiDeductions126CycleActivatedByPeriod,
  isNiDeductions126CycleCoverageEligible,
  resolveOutstandingNiDeductions126Cycles,
  selectNextNiDeductions126CycleToComplete,
} from '../../src/domains/client-operations/client-operations-ni-deductions-126.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pureSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-ni-deductions-126.pure.ts'),
  'utf8',
);
const registryServiceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-ni-deductions-registry.service.ts'),
  'utf8',
);
const migration174 = readFileSync(
  join(dir, '../../../../supabase/migrations/174_client_ni_deductions_126_cycles.sql'),
  'utf8',
);

const BOUNDARY_2025_01 = '2025-01';

test('coverage end is June for H1 and December for ANNUAL', () => {
  assert.equal(
    coverageEndPeriodKeyForNiDeductions126Cycle({ reporting_year: 2026, cycle_type: 'h1' }),
    '2026-06',
  );
  assert.equal(
    coverageEndPeriodKeyForNiDeductions126Cycle({ reporting_year: 2026, cycle_type: 'annual' }),
    '2026-12',
  );
});

test('historical boundary 2026-03: prior-year cycles excluded; 2026-H1/ANNUAL eligible', () => {
  const earliest = '2026-03';
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2025, cycle_type: 'h1' }, earliest),
    false,
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2025, cycle_type: 'annual' }, earliest),
    false,
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'h1' }, earliest),
    true,
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'annual' }, earliest),
    true,
  );

  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [{ reporting_year: 2026, cycle_type: 'h1' }],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2027-01',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [
      { reporting_year: 2026, cycle_type: 'h1' },
      { reporting_year: 2026, cycle_type: 'annual' },
    ],
  );
});

test('historical boundary 2026-09: 2026-H1 excluded; 2026-ANNUAL eligible from Jan 2027', () => {
  const earliest = '2026-09';
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'h1' }, earliest),
    false,
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'annual' }, earliest),
    true,
  );

  for (const period of ['2026-09', '2026-10', '2026-12'] as const) {
    assert.deepEqual(
      resolveOutstandingNiDeductions126Cycles({
        operationalPeriodKey: period,
        storedFacts: [],
        earliestApplicablePeriodKey: earliest,
      }),
      [],
      `expected no fabricated outstanding in ${period}`,
    );
  }
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2027-01',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [{ reporting_year: 2026, cycle_type: 'annual' }],
  );
});

test('historical boundary 2026-07: 2026-H1 excluded (coverage ended before applicability); ANNUAL eligible', () => {
  const earliest = '2026-07';
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'h1' }, earliest),
    false,
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2026, cycle_type: 'annual' }, earliest),
    true,
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2027-01',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [{ reporting_year: 2026, cycle_type: 'annual' }],
  );
});

test('activation with earliest 2026-03: H1 not active in June; active from July; completed clears', () => {
  const earliest = '2026-03';
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-06',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [{ reporting_year: 2026, cycle_type: 'h1' }],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-08',
      storedFacts: [],
      earliestApplicablePeriodKey: earliest,
    }),
    [{ reporting_year: 2026, cycle_type: 'h1' }],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-08',
      storedFacts: [{ reporting_year: 2026, cycle_type: 'h1', completed: true }],
      earliestApplicablePeriodKey: earliest,
    }),
    [],
  );
});

test('no historical applicable snapshot evidence: do not fabricate prior-year cycles', () => {
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [],
      earliestApplicablePeriodKey: null,
    }),
    [],
  );
  assert.equal(
    isNiDeductions126CycleCoverageEligible({ reporting_year: 2025, cycle_type: 'annual' }, null),
    false,
  );
});

test('stored incomplete historical cycle is preserved even without snapshot boundary evidence', () => {
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [{ reporting_year: 2025, cycle_type: 'annual', completed: false }],
      earliestApplicablePeriodKey: null,
    }),
    [{ reporting_year: 2025, cycle_type: 'annual' }],
  );
  assert.deepEqual(
    resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: '2026-07',
      storedFacts: [{ reporting_year: 2025, cycle_type: 'h1', completed: false }],
      earliestApplicablePeriodKey: '2026-03',
    }),
    [
      { reporting_year: 2025, cycle_type: 'h1' },
      { reporting_year: 2026, cycle_type: 'h1' },
    ],
  );
});

test('2026-01 activates 2025 ANNUAL when boundary allows; 2026 H1 is not yet active', () => {
  assert.equal(
    isNiDeductions126CycleActivatedByPeriod({ reporting_year: 2025, cycle_type: 'annual' }, '2026-01'),
    true,
  );
  assert.equal(
    isNiDeductions126CycleActivatedByPeriod({ reporting_year: 2026, cycle_type: 'h1' }, '2026-01'),
    false,
  );
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-01',
    storedFacts: [],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.ok(outstanding.some((c) => c.reporting_year === 2025 && c.cycle_type === 'annual'));
  assert.ok(!outstanding.some((c) => c.reporting_year === 2026 && c.cycle_type === 'h1'));
});

test('2026-06 still does not activate 2026 H1', () => {
  assert.equal(
    isNiDeductions126CycleActivatedByPeriod({ reporting_year: 2026, cycle_type: 'h1' }, '2026-06'),
    false,
  );
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-06',
    storedFacts: [],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.ok(!outstanding.some((c) => c.reporting_year === 2026 && c.cycle_type === 'h1'));
});

test('2026-07 activates 2026 H1; incomplete H1 carries through later months', () => {
  assert.equal(
    isNiDeductions126CycleActivatedByPeriod({ reporting_year: 2026, cycle_type: 'h1' }, '2026-07'),
    true,
  );
  for (const period of ['2026-07', '2026-08', '2026-12'] as const) {
    const outstanding = resolveOutstandingNiDeductions126Cycles({
      operationalPeriodKey: period,
      storedFacts: [],
      earliestApplicablePeriodKey: BOUNDARY_2025_01,
    });
    assert.ok(
      outstanding.some((c) => c.reporting_year === 2026 && c.cycle_type === 'h1'),
      `expected H1 outstanding in ${period}`,
    );
  }
});

test('2027-01 activates 2026 ANNUAL', () => {
  assert.equal(
    isNiDeductions126CycleActivatedByPeriod({ reporting_year: 2026, cycle_type: 'annual' }, '2027-01'),
    true,
  );
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2027-01',
    storedFacts: [],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.ok(outstanding.some((c) => c.reporting_year === 2026 && c.cycle_type === 'annual'));
});

test('completed cycle is no longer outstanding; completion remains historically stored', () => {
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-08',
    storedFacts: [{ reporting_year: 2026, cycle_type: 'h1', completed: true }],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.ok(!outstanding.some((c) => c.reporting_year === 2026 && c.cycle_type === 'h1'));
  assert.match(migration174, /completed boolean not null default false/);
});

test('multiple outstanding cycles preserved; one click completes oldest only', () => {
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-07',
    storedFacts: [],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.deepEqual(outstanding, [
    { reporting_year: 2025, cycle_type: 'h1' },
    { reporting_year: 2025, cycle_type: 'annual' },
    { reporting_year: 2026, cycle_type: 'h1' },
  ]);

  const first = selectNextNiDeductions126CycleToComplete(outstanding);
  assert.deepEqual(first, { reporting_year: 2025, cycle_type: 'h1' });

  const afterFirst = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-07',
    storedFacts: [{ reporting_year: 2025, cycle_type: 'h1', completed: true }],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.deepEqual(afterFirst, [
    { reporting_year: 2025, cycle_type: 'annual' },
    { reporting_year: 2026, cycle_type: 'h1' },
  ]);

  const second = selectNextNiDeductions126CycleToComplete(afterFirst);
  assert.deepEqual(second, { reporting_year: 2025, cycle_type: 'annual' });

  const afterSecond = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-07',
    storedFacts: [
      { reporting_year: 2025, cycle_type: 'h1', completed: true },
      { reporting_year: 2025, cycle_type: 'annual', completed: true },
    ],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.deepEqual(afterSecond, [{ reporting_year: 2026, cycle_type: 'h1' }]);

  const afterThird = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: '2026-07',
    storedFacts: [
      { reporting_year: 2025, cycle_type: 'h1', completed: true },
      { reporting_year: 2025, cycle_type: 'annual', completed: true },
      { reporting_year: 2026, cycle_type: 'h1', completed: true },
    ],
    earliestApplicablePeriodKey: BOUNDARY_2025_01,
  });
  assert.deepEqual(afterThird, []);
});

test('registry cell shape is backend-ready for 102/100/126', () => {
  const cell = buildNiDeductionsRegistryCell({
    applicable: true,
    reported102: true,
    reported100: false,
    outstanding126: [
      { reporting_year: 2025, cycle_type: 'annual' },
      { reporting_year: 2026, cycle_type: 'h1' },
    ],
  });
  assert.equal(cell.applicable, true);
  assert.deepEqual(cell.items['102'], { applicable: true, completed: true });
  assert.deepEqual(cell.items['100'], { applicable: true, completed: false });
  assert.equal(cell.items['126'].applicable, true);
  assert.equal(cell.items['126'].completed, false);
  assert.equal(cell.items['126'].outstanding_count, 2);

  const na = buildNiDeductionsRegistryCell({
    applicable: false,
    reported102: true,
    reported100: true,
    outstanding126: [{ reporting_year: 2025, cycle_type: 'annual' }],
  });
  assert.equal(na.applicable, false);
  assert.equal(na.items['126'].outstanding_count, 0);
  assert.equal(na.items['102'].completed, null);
});

test('horizon derivation stays bounded (no infinite historical invention)', () => {
  assert.deepEqual(deriveHorizonNiDeductions126Cycles('2026-07'), [
    { reporting_year: 2025, cycle_type: 'annual' },
    { reporting_year: 2025, cycle_type: 'h1' },
    { reporting_year: 2026, cycle_type: 'h1' },
  ]);
});

test('126 is cycle-grained; 102/100 stay monthly; no reported_126 column', () => {
  assert.match(migration174, /client_ni_deductions_126_cycles/);
  assert.match(migration174, /cycle_type text not null check \(cycle_type in \('h1', 'annual'\)\)/);
  assert.match(migration174, /unique \(organization_id, client_id, reporting_year, cycle_type\)/);
  assert.match(migration174, /Do NOT add reported_126/);
  assert.doesNotMatch(migration174, /^\s*reported_126\b/m);
  assert.doesNotMatch(migration174, /alter table public\.client_ni_deductions_period/);
  assert.match(registryServiceSource, /client_ni_deductions_period/);
  assert.match(registryServiceSource, /reported_102/);
  assert.match(registryServiceSource, /reported_100/);
  assert.match(registryServiceSource, /completeNiDeductions126CycleForRegistry/);
  assert.match(registryServiceSource, /setNiDeductionsReportedStepForRegistry/);
  assert.match(registryServiceSource, /loadEarliestNiDeductionsApplicablePeriodKeysForClients/);
  assert.match(registryServiceSource, /client_operations_period_applicability_snapshots/);
  assert.match(registryServiceSource, /national_insurance_deductions_applicable/);
  assert.doesNotMatch(registryServiceSource, /ensurePeriodApplicabilitySnapshots/);
  assert.doesNotMatch(pureSource, /reported_126/);
  assert.doesNotMatch(pureSource, /from\(/);
});

test('migration 174 uses composite client/org FK + RLS + completion invariants CHECK', () => {
  assert.match(migration174, /uq_clients_id_org/);
  assert.match(
    migration174,
    /foreign key \(client_id, organization_id\)\s+references public\.clients \(id, organization_id\)/,
  );
  assert.match(migration174, /organizations_for_current_auth_user\(\)/);
  assert.match(migration174, /enable row level security/);
  assert.match(migration174, /set_updated_at\(\)/);
  assert.match(migration174, /client_ni_deductions_126_cycles_completion_invariants/);
  assert.match(migration174, /completed = false/);
  assert.match(migration174, /completed_at is null/);
  assert.match(migration174, /completed = true/);
  assert.match(migration174, /completed_at is not null/);
});
