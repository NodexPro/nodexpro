/**
 * Client Operations — operational period foundation (Phase 1).
 *
 * Owner: CLIENT OPERATIONS.
 * operational_period_key format: YYYY-MM (Asia/Jerusalem workspace month).
 *
 * Distinct from Country Pack reporting_period_key and Work Engine periods.
 * Product VAT bi-monthly operational months are EVEN (02/04/06/08/10/12).
 * Country Pack bi-monthly identity remains odd-start and is not changed here.
 */

import { businessMonthKey } from '../../shared/business-time.js';

export const OPERATIONAL_PERIOD_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type OperationalPeriodParts = { year: number; month: number };

export type OperationalStreamApplicability = {
  vat_applicable: boolean;
  payroll_applicable: boolean;
  income_tax_advance_applicable: boolean;
  income_tax_deductions_applicable: boolean;
  national_insurance_applicable: boolean;
  national_insurance_deductions_applicable: boolean;
};

export type OperationalPeriodApplicabilityResult = OperationalStreamApplicability & {
  row_visible: boolean;
};

export type OperationalCellState<T> =
  | { applicable: false; completed: null; value: null }
  | { applicable: true; completed: boolean; value: T };

export type OperationalPeriodSnapshotInputs = {
  vat_type: string | null;
  vat_frequency: string | null;
  payroll_flag: boolean | null;
  income_tax_advance_enabled: boolean | null;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean | null;
  income_tax_deductions_frequency: string | null;
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
};

export function isOperationalPeriodKey(value: unknown): value is string {
  return typeof value === 'string' && OPERATIONAL_PERIOD_KEY_RE.test(value);
}

export function parseOperationalPeriodKey(value: string): OperationalPeriodParts | null {
  if (!isOperationalPeriodKey(value)) return null;
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
  };
}

export function formatOperationalPeriodKey(parts: OperationalPeriodParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

/** Default / current operational period = Asia/Jerusalem calendar month. */
export function resolveDefaultOperationalPeriodKey(now: Date = new Date()): string {
  return businessMonthKey(now);
}

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/** VAT חודשי → every operational month. */
export function isVatMonthlyApplicableForOperationalPeriod(_periodKey: string): boolean {
  return true;
}

/** VAT דו-חודשי → operational months 02/04/06/08/10/12 only (product rule). */
export function isVatBiMonthlyApplicableForOperationalPeriod(periodKey: string): boolean {
  const parts = parseOperationalPeriodKey(periodKey);
  if (!parts) return false;
  return parts.month % 2 === 0;
}

/** VAT פטור → December only. */
export function isVatPaturApplicableForOperationalPeriod(periodKey: string): boolean {
  const parts = parseOperationalPeriodKey(periodKey);
  if (!parts) return false;
  return parts.month === 12;
}

export function resolveVatApplicabilityForOperationalPeriod(input: {
  vat_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  operational_period_key: string;
}): boolean {
  const vatType = norm(input.vat_type);
  const frequency = norm(input.vat_frequency);
  if (vatType === 'patur') {
    return isVatPaturApplicableForOperationalPeriod(input.operational_period_key);
  }
  if (vatType === 'no' || vatType === 'not_relevant' || frequency === 'not_relevant') {
    return false;
  }
  if (frequency === 'monthly') {
    return isVatMonthlyApplicableForOperationalPeriod(input.operational_period_key);
  }
  if (frequency === 'bi_monthly') {
    return isVatBiMonthlyApplicableForOperationalPeriod(input.operational_period_key);
  }
  // Fail-closed: unknown VAT frequency/type → not applicable.
  return false;
}

/**
 * Income-tax advances/deductions frequency applicability for an operational month.
 *
 * Canonical CO filing-month sets (NOT Country Pack pair-start identity):
 * - monthly → every month
 * - bi_monthly → odd months (01/03/05/07/09/11)
 * - semi_annual → 01 and 07
 *
 * Evidence (do not silently flip to even months):
 * - `resolveIncomeTaxDeductionsOperationalReportingPeriodKey` in
 *   client-operations-client-quick-profile.pure.ts uses reportingMonths
 *   {1,3,5,7,9,11}; in those months the reported pair ends on the prior
 *   even month (e.g. March work → Feb pair-end).
 * - `resolveIncomeTaxDeductionsRequirement` in
 *   client-obligations-tasks-core.service.ts uses the same odd filing months.
 * - tests/client-operations/client-operations-client-quick-profile-reporting-period.spec.ts
 *   asserts April (even) not applicable, March (odd) applicable for bi_monthly.
 *
 * Advances have no separate month-parity gate in obligation generation (enabled
 * ⇒ monthly obligation row). Operational registry reuses this same CO income-tax
 * frequency filing-month vocabulary for advances bi_monthly rather than inventing
 * VAT-style even operational months.
 */
export function isIncomeTaxFrequencyApplicableForOperationalPeriod(
  frequency: string | null | undefined,
  periodKey: string,
): boolean {
  const parts = parseOperationalPeriodKey(periodKey);
  if (!parts) return false;
  const freq = norm(frequency);
  if (!freq || freq === 'monthly') return true;
  if (freq === 'bi_monthly') {
    return parts.month % 2 === 1;
  }
  if (freq === 'semi_annual') {
    return parts.month === 1 || parts.month === 7;
  }
  return false;
}

export function resolvePayrollApplicabilityForOperationalPeriod(
  payrollFlag: boolean | null | undefined,
): boolean {
  return payrollFlag === true;
}

/** NI self — fail-closed unless canonical type is explicitly yes. */
export function resolveNationalInsuranceApplicability(
  nationalInsuranceType: string | null | undefined,
): boolean {
  return norm(nationalInsuranceType) === 'yes';
}

/** NI deductions — fail-closed unless a canonical file number exists. */
export function resolveNationalInsuranceDeductionsApplicability(
  fileNumber: string | null | undefined,
): boolean {
  return Boolean(String(fileNumber ?? '').trim());
}

export function computeOperationalPeriodApplicability(
  periodKey: string,
  inputs: OperationalPeriodSnapshotInputs,
): OperationalPeriodApplicabilityResult {
  const vat_applicable = resolveVatApplicabilityForOperationalPeriod({
    vat_type: inputs.vat_type,
    vat_frequency: inputs.vat_frequency,
    operational_period_key: periodKey,
  });
  const payroll_applicable = resolvePayrollApplicabilityForOperationalPeriod(inputs.payroll_flag);
  const income_tax_advance_applicable =
    inputs.income_tax_advance_enabled === true &&
    isIncomeTaxFrequencyApplicableForOperationalPeriod(
      inputs.income_tax_advance_frequency,
      periodKey,
    );
  const income_tax_deductions_applicable =
    inputs.income_tax_deductions_enabled === true &&
    isIncomeTaxFrequencyApplicableForOperationalPeriod(
      inputs.income_tax_deductions_frequency,
      periodKey,
    );
  const national_insurance_applicable = resolveNationalInsuranceApplicability(
    inputs.national_insurance_type,
  );
  const national_insurance_deductions_applicable = resolveNationalInsuranceDeductionsApplicability(
    inputs.national_insurance_deductions_file_number,
  );
  const row_visible =
    vat_applicable ||
    payroll_applicable ||
    income_tax_advance_applicable ||
    income_tax_deductions_applicable ||
    national_insurance_applicable ||
    national_insurance_deductions_applicable;

  return {
    vat_applicable,
    payroll_applicable,
    income_tax_advance_applicable,
    income_tax_deductions_applicable,
    national_insurance_applicable,
    national_insurance_deductions_applicable,
    row_visible,
  };
}

export function buildOperationalCheckboxCell(
  applicable: boolean,
  completed: boolean | null | undefined,
): OperationalCellState<boolean> {
  if (!applicable) {
    return { applicable: false, completed: null, value: null };
  }
  const done = Boolean(completed);
  return { applicable: true, completed: done, value: done };
}

/**
 * Compatibility read for חומר למע״מ:
 * - period fact wins when present
 * - else, only for the default/current period, legacy profile flag may be shown
 * - never invent historical values for other months
 */
export function resolveMaterialBroughtForPeriod(input: {
  period_fact: boolean | null | undefined;
  has_period_fact: boolean;
  legacy_profile_flag: boolean | null | undefined;
  operational_period_key: string;
  default_period_key: string;
  vat_applicable: boolean;
}): OperationalCellState<boolean> {
  if (!input.vat_applicable) {
    return { applicable: false, completed: null, value: null };
  }
  if (input.has_period_fact) {
    return buildOperationalCheckboxCell(true, Boolean(input.period_fact));
  }
  if (input.operational_period_key === input.default_period_key) {
    return buildOperationalCheckboxCell(true, Boolean(input.legacy_profile_flag));
  }
  return buildOperationalCheckboxCell(true, false);
}

/**
 * Historical period registry membership for archived clients.
 * Live/current period: archived clients stay excluded.
 * Historical period: include only when a frozen snapshot/fact membership exists.
 * Does not invent engagement history.
 */
export function shouldIncludeArchivedClientInOperationalPeriodRegistry(input: {
  is_current_or_default_period: boolean;
  is_archived: boolean;
  has_frozen_period_membership: boolean;
}): boolean {
  if (!input.is_archived) return true;
  if (input.is_current_or_default_period) return false;
  return input.has_frozen_period_membership;
}

/** Client created after period end must not appear in earlier periods. */
export function clientExistsInOperationalPeriod(input: {
  client_created_at: string | Date | null | undefined;
  operational_period_key: string;
}): boolean {
  if (!input.client_created_at) return true; // fail-open only when created_at missing
  const parts = parseOperationalPeriodKey(input.operational_period_key);
  if (!parts) return false;
  const created =
    input.client_created_at instanceof Date
      ? input.client_created_at
      : new Date(input.client_created_at);
  if (Number.isNaN(created.getTime())) return true;
  const createdPeriod = businessMonthKey(created);
  return createdPeriod <= input.operational_period_key;
}

export function buildAvailableOperationalPeriods(input: {
  default_period_key: string;
  known_period_keys: Iterable<string>;
}): string[] {
  const set = new Set<string>();
  if (isOperationalPeriodKey(input.default_period_key)) {
    set.add(input.default_period_key);
  }
  for (const key of input.known_period_keys) {
    if (isOperationalPeriodKey(key)) set.add(key);
  }
  return [...set].sort();
}
