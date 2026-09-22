/**
 * Form 126 NI deductions — reporting-cycle resolver (H1 / ANNUAL).
 * Backend-owned. React must not inspect month numbers or invent applicability.
 *
 * Eligibility (coverage overlap with earliest NI-deductions applicable period):
 * - H1 Y covers Jan–Jun Y (coverage end = Y-06)
 * - ANNUAL Y covers Jan–Dec Y (coverage end = Y-12)
 * Derived missing cycles require coverage_end >= earliestApplicablePeriodKey.
 * No earliest snapshot evidence ⇒ do not fabricate derived cycles.
 *
 * Activation:
 * - H1 for year Y activates in July Y
 * - ANNUAL for year Y activates in January Y+1
 * Incomplete cycles remain outstanding after activation until completed.
 *
 * Stored cycle rows are canonical facts and are not discarded by the boundary.
 */

export type NiDeductions126CycleType = 'h1' | 'annual';

export type NiDeductions126CycleRef = {
  reporting_year: number;
  cycle_type: NiDeductions126CycleType;
};

export type NiDeductions126CycleFact = NiDeductions126CycleRef & {
  completed: boolean;
};

export type NiDeductionsFormItemCell = {
  applicable: boolean;
  completed: boolean | null;
};

export type NiDeductions126ItemCell = NiDeductionsFormItemCell & {
  outstanding_count: number;
};

export type NiDeductionsRegistryCell = {
  applicable: boolean;
  items: {
    '102': NiDeductionsFormItemCell;
    '100': NiDeductionsFormItemCell;
    '126': NiDeductions126ItemCell;
  };
};

const OPERATIONAL_PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseOperationalPeriodYearMonth(operationalPeriodKey: string): {
  year: number;
  month: number;
} {
  const match = OPERATIONAL_PERIOD_RE.exec(String(operationalPeriodKey ?? '').trim());
  if (!match) throw new Error(`Invalid operational_period_key: ${operationalPeriodKey}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function activationMonthForNiDeductions126Cycle(cycle: NiDeductions126CycleRef): {
  year: number;
  month: number;
} {
  if (cycle.cycle_type === 'h1') return { year: cycle.reporting_year, month: 7 };
  return { year: cycle.reporting_year + 1, month: 1 };
}

/** Coverage end YYYY-MM for the cycle (H1 → June Y; ANNUAL → December Y). */
export function coverageEndPeriodKeyForNiDeductions126Cycle(
  cycle: NiDeductions126CycleRef,
): string {
  if (cycle.cycle_type === 'h1') return `${cycle.reporting_year}-06`;
  return `${cycle.reporting_year}-12`;
}

/**
 * Derived-cycle eligibility: coverage must not have fully ended before the
 * earliest known NI-deductions applicable operational period.
 * Fail-closed when no snapshot evidence exists (earliest = null).
 */
export function isNiDeductions126CycleCoverageEligible(
  cycle: NiDeductions126CycleRef,
  earliestApplicablePeriodKey: string | null,
): boolean {
  if (!earliestApplicablePeriodKey) return false;
  return (
    coverageEndPeriodKeyForNiDeductions126Cycle(cycle) >= earliestApplicablePeriodKey
  );
}

export function isNiDeductions126CycleActivatedByPeriod(
  cycle: NiDeductions126CycleRef,
  operationalPeriodKey: string,
): boolean {
  const period = parseOperationalPeriodYearMonth(operationalPeriodKey);
  const activation = activationMonthForNiDeductions126Cycle(cycle);
  if (period.year > activation.year) return true;
  if (period.year < activation.year) return false;
  return period.month >= activation.month;
}

/**
 * Derived horizon cycles relevant by this operational period
 * (without inventing infinite historical rows).
 * Eligibility / stored-fact merge is applied by the outstanding resolver.
 */
export function deriveHorizonNiDeductions126Cycles(
  operationalPeriodKey: string,
): NiDeductions126CycleRef[] {
  const { year, month } = parseOperationalPeriodYearMonth(operationalPeriodKey);
  const out: NiDeductions126CycleRef[] = [
    { reporting_year: year - 1, cycle_type: 'annual' },
    { reporting_year: year - 1, cycle_type: 'h1' },
  ];
  if (month >= 7) out.push({ reporting_year: year, cycle_type: 'h1' });
  return out;
}

export function niDeductions126CycleKey(cycle: NiDeductions126CycleRef): string {
  return `${cycle.reporting_year}:${cycle.cycle_type}`;
}

export function compareNiDeductions126CyclesByActivation(
  a: NiDeductions126CycleRef,
  b: NiDeductions126CycleRef,
): number {
  const aa = activationMonthForNiDeductions126Cycle(a);
  const bb = activationMonthForNiDeductions126Cycle(b);
  if (aa.year !== bb.year) return aa.year - bb.year;
  if (aa.month !== bb.month) return aa.month - bb.month;
  return a.cycle_type.localeCompare(b.cycle_type);
}

/**
 * Outstanding = activated by period AND not completed.
 * Derived missing cycles also require coverage eligibility vs earliestApplicablePeriodKey.
 * Incomplete stored rows remain canonical and are not filtered by the boundary.
 */
export function resolveOutstandingNiDeductions126Cycles(input: {
  operationalPeriodKey: string;
  storedFacts: NiDeductions126CycleFact[];
  earliestApplicablePeriodKey: string | null;
}): NiDeductions126CycleRef[] {
  const completed = new Set(
    input.storedFacts.filter((f) => f.completed).map((f) => niDeductions126CycleKey(f)),
  );
  const incompleteStored = input.storedFacts.filter((f) => !f.completed);

  const candidates = new Map<string, NiDeductions126CycleRef>();
  for (const cycle of deriveHorizonNiDeductions126Cycles(input.operationalPeriodKey)) {
    if (
      isNiDeductions126CycleCoverageEligible(cycle, input.earliestApplicablePeriodKey)
    ) {
      candidates.set(niDeductions126CycleKey(cycle), cycle);
    }
  }
  for (const fact of incompleteStored) {
    if (isNiDeductions126CycleActivatedByPeriod(fact, input.operationalPeriodKey)) {
      candidates.set(niDeductions126CycleKey(fact), {
        reporting_year: fact.reporting_year,
        cycle_type: fact.cycle_type,
      });
    }
  }

  return [...candidates.values()]
    .filter((cycle) => isNiDeductions126CycleActivatedByPeriod(cycle, input.operationalPeriodKey))
    .filter((cycle) => !completed.has(niDeductions126CycleKey(cycle)))
    .sort(compareNiDeductions126CyclesByActivation);
}

/** Oldest outstanding cycle — one click completes exactly this one. */
export function selectNextNiDeductions126CycleToComplete(
  outstanding: NiDeductions126CycleRef[],
): NiDeductions126CycleRef | null {
  if (outstanding.length === 0) return null;
  return [...outstanding].sort(compareNiDeductions126CyclesByActivation)[0] ?? null;
}

export function buildNiDeductionsRegistryCell(input: {
  applicable: boolean;
  reported102: boolean | null | undefined;
  reported100: boolean | null | undefined;
  outstanding126: NiDeductions126CycleRef[];
}): NiDeductionsRegistryCell {
  if (!input.applicable) {
    return {
      applicable: false,
      items: {
        '102': { applicable: false, completed: null },
        '100': { applicable: false, completed: null },
        '126': { applicable: false, completed: null, outstanding_count: 0 },
      },
    };
  }
  const outstandingCount = input.outstanding126.length;
  return {
    applicable: true,
    items: {
      '102': { applicable: true, completed: Boolean(input.reported102) },
      '100': { applicable: true, completed: Boolean(input.reported100) },
      '126': {
        applicable: true,
        completed: outstandingCount === 0,
        outstanding_count: outstandingCount,
      },
    },
  };
}
