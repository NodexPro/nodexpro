/**
 * Client Operations reporting dashboard — load existing filing facts + calendar due dates
 * and attach backend-owned presentation to registry rows.
 */

import { supabaseAdmin } from '../../db/client.js';
import { businessYmd } from '../../shared/business-time.js';
import { AppError } from '../../shared/errors.js';
import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import { resolveReportingDueDatesBatch } from '../country-pack/reporting-calendar-resolver.service.js';
import { REPORTING_OBLIGATION_KEYS } from '../country-pack/reporting-calendar.pure.js';
import {
  loadTaxObligationPaymentFactsForClients,
} from '../accounting-base/accounting-base-tax-obligation-payment.service.js';
import {
  paymentClassificationIsOutstanding,
  type AccountingTaxObligationPaymentFact,
} from '../accounting-base/accounting-base-tax-obligation-payment.pure.js';
import {
  buildReportingCellInputFromFacts,
  buildReportingRowPresentation,
  buildPreviousIncompletePeriods,
  calendarDueMapKey,
  incomeTaxAdvancesCalendarKey,
  incomeTaxDeductionsCalendarKey,
  isFilingNotApplicableStatus,
  isFilingSubmittedStatus,
  isAuthoritativeLegalOverdue,
  lookupCalendarDueDate,
  resolvePreviousPeriodVatCalendarDue,
  resolveVatCalendarLookupPeriodKey,
  resolveVatCalendarObligationKey,
  pickVatObligationFactForFrequency,
  payrollWorkflowCountsAsSubmitted,
  payrollWorkflowIsNotRelevant,
  nationalInsuranceDeductionsPeriodicSubmitted,
  type ClientOperationsPreviousPeriodFact,
  type ClientOperationsReportingFilingFact,
  type ClientOperationsReportingPreviousPeriods,
  type ClientOperationsReportingRowPresentation,
  type PaymentsOutstandingPeriodFact,
  type ReportingKpiClientFacts,
} from './client-operations-reporting-dashboard.pure.js';
import type { PeriodApplicabilitySnapshotRow } from './client-operations-operational-period.service.js';

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

export type ReportingDashboardTaxSettings = {
  vat_type: string | null;
  vat_due_type: string | null;
  vat_frequency: string | null;
  income_tax_advance_enabled: boolean;
};

export type ReportingDashboardLoad = {
  factsByClient: Map<string, ClientOperationsReportingFilingFact[]>;
  paymentFactsByClient: Map<string, AccountingTaxObligationPaymentFact[]>;
  calendarDueByKey: Map<string, string>;
  previousSnapshots: Array<PeriodApplicabilitySnapshotRow & { operational_period_key: string }>;
  itdReportedByClientPeriod: Map<string, { reported: boolean; not_relevant: boolean }>;
  niDedByClientPeriod: Map<string, { reported_102: boolean; reported_100: boolean; not_relevant: boolean }>;
  today: string;
};

function clientPeriodKey(clientId: string, periodKey: string): string {
  return `${clientId}::${periodKey}`;
}

export async function loadClientOperationsReportingDashboardInputs(input: {
  organizationId: string;
  clientIds: string[];
  selectedPeriodKey: string;
  previousPeriodKeys: string[];
}): Promise<ReportingDashboardLoad> {
  const today = businessYmd(new Date());
  const empty: ReportingDashboardLoad = {
    factsByClient: new Map(),
    paymentFactsByClient: new Map(),
    calendarDueByKey: new Map(),
    previousSnapshots: [],
    itdReportedByClientPeriod: new Map(),
    niDedByClientPeriod: new Map(),
    today,
  };
  if (!input.clientIds.length) return empty;

  const periodKeys = [...new Set([input.selectedPeriodKey, ...input.previousPeriodKeys])];
  const [factsResult, ruleset, previousSnapshotsResult, itdResult, niResult, paymentFactsByClient] = await Promise.all([
    supabaseAdmin
      .from('client_obligations')
      .select('id, client_id, obligation_type, period_key, status, due_date, last_reported_at, is_active')
      .eq('organization_id', input.organizationId)
      .in('client_id', input.clientIds)
      .eq('is_active', true),
    resolveOrganizationActiveRuleset(input.organizationId, today),
    input.previousPeriodKeys.length
      ? supabaseAdmin
          .from('client_operations_period_applicability_snapshots')
          .select(
            'client_id, operational_period_key, vat_applicable, payroll_applicable, income_tax_advance_applicable, income_tax_deductions_applicable, national_insurance_applicable, national_insurance_deductions_applicable, vat_frequency',
          )
          .eq('organization_id', input.organizationId)
          .in('client_id', input.clientIds)
          .in('operational_period_key', input.previousPeriodKeys)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('client_income_tax_deductions_period')
      .select('client_id, period_key, reported, not_relevant')
      .eq('organization_id', input.organizationId)
      .in('client_id', input.clientIds)
      .in('period_key', periodKeys),
    supabaseAdmin
      .from('client_ni_deductions_period')
      .select('client_id, period_key, reported_102, reported_100, not_relevant')
      .eq('organization_id', input.organizationId)
      .in('client_id', input.clientIds)
      .in('period_key', periodKeys),
    loadTaxObligationPaymentFactsForClients({
      organizationId: input.organizationId,
      clientIds: input.clientIds,
    }),
  ]);

  assertQueryError(factsResult.error, 'Failed to load client obligations for reporting dashboard');
  assertQueryError(previousSnapshotsResult.error, 'Failed to load previous-period snapshots');
  assertQueryError(itdResult.error, 'Failed to load income-tax deductions period facts');
  assertQueryError(niResult.error, 'Failed to load NI deductions period facts');

  const factsByClient = new Map<string, ClientOperationsReportingFilingFact[]>();
  for (const row of (factsResult.data ?? []) as Array<{
    id: string;
    client_id: string;
    obligation_type: string;
    period_key: string;
    status: string | null;
    due_date: string | null;
    last_reported_at: string | null;
  }>) {
    const list = factsByClient.get(row.client_id) ?? [];
    list.push({
      obligation_id: row.id,
      obligation_type: row.obligation_type,
      period_key: String(row.period_key),
      status: row.status,
      due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
      last_reported_at: row.last_reported_at,
    });
    factsByClient.set(row.client_id, list);
  }

  const lookups: Array<{ obligation_key: string; reporting_period_key: string }> = [];
  for (const periodKey of periodKeys) {
    for (const obligationKey of REPORTING_OBLIGATION_KEYS) {
      lookups.push({ obligation_key: obligationKey, reporting_period_key: periodKey });
    }
  }
  const calendarResolved = await resolveReportingDueDatesBatch({
    country_code: ruleset.country_code,
    country_pack_ruleset_id: ruleset.ruleset_id,
    lookups,
  });
  const calendarDueByKey = new Map<string, string>();
  for (const [key, resolution] of calendarResolved) {
    if (resolution.resolved && resolution.filing_due_date) {
      calendarDueByKey.set(key, resolution.filing_due_date.slice(0, 10));
    }
  }

  const itdReportedByClientPeriod = new Map<string, { reported: boolean; not_relevant: boolean }>();
  for (const row of (itdResult.data ?? []) as Array<{
    client_id: string;
    period_key: string;
    reported: boolean | null;
    not_relevant: boolean | null;
  }>) {
    itdReportedByClientPeriod.set(clientPeriodKey(row.client_id, row.period_key), {
      reported: Boolean(row.reported),
      not_relevant: Boolean(row.not_relevant),
    });
  }

  const niDedByClientPeriod = new Map<
    string,
    { reported_102: boolean; reported_100: boolean; not_relevant: boolean }
  >();
  for (const row of (niResult.data ?? []) as Array<{
    client_id: string;
    period_key: string;
    reported_102: boolean | null;
    reported_100: boolean | null;
    not_relevant: boolean | null;
  }>) {
    niDedByClientPeriod.set(clientPeriodKey(row.client_id, row.period_key), {
      reported_102: Boolean(row.reported_102),
      reported_100: Boolean(row.reported_100),
      not_relevant: Boolean(row.not_relevant),
    });
  }

  return {
    factsByClient,
    paymentFactsByClient,
    calendarDueByKey,
    previousSnapshots: (previousSnapshotsResult.data ?? []) as ReportingDashboardLoad['previousSnapshots'],
    itdReportedByClientPeriod,
    niDedByClientPeriod,
    today,
  };
}

export function outstandingPaymentPeriodFactsFromLoad(
  load: ReportingDashboardLoad,
): PaymentsOutstandingPeriodFact[] {
  const out: PaymentsOutstandingPeriodFact[] = [];
  for (const facts of load.paymentFactsByClient.values()) {
    for (const fact of facts) {
      if (!paymentClassificationIsOutstanding(fact.payment_classification)) continue;
      out.push({
        period_key: fact.operational_period_key,
        canonical_id: fact.obligation_canonical_id,
      });
    }
  }
  return out;
}

function paymentFactForCanonical(
  facts: readonly AccountingTaxObligationPaymentFact[] | undefined,
  canonicalId: string,
): AccountingTaxObligationPaymentFact | null {
  if (!facts?.length) return null;
  return facts.find((f) => f.obligation_canonical_id === canonicalId) ?? null;
}

type RegistryReportingRow = {
  period_applicability?: {
    vat_applicable: boolean;
    payroll_applicable: boolean;
    income_tax_advance_applicable: boolean;
    income_tax_deductions_applicable: boolean;
    national_insurance_applicable: boolean;
    national_insurance_deductions_applicable: boolean;
  };
  national_insurance_deductions_cell?: {
    applicable?: boolean;
    items?: Record<string, { completed?: boolean | null }>;
  };
  income_tax_deductions_cell?: {
    applicable?: boolean;
    completed?: boolean | null;
  };
  reporting?: ClientOperationsReportingRowPresentation;
  reporting_kpi?: ReportingKpiClientFacts;
};

export type PayrollWorkflowKpiState = {
  sent_to_employer: boolean;
  no_salaries_this_month: boolean;
  not_relevant: boolean;
};

export function attachReportingPresentationToRegistryRow<T extends RegistryReportingRow>(input: {
  row: T;
  tax: ReportingDashboardTaxSettings | null | undefined;
  facts: readonly ClientOperationsReportingFilingFact[];
  paymentFacts?: readonly AccountingTaxObligationPaymentFact[];
  calendarDueByKey: ReadonlyMap<string, string>;
  selectedPeriodKey: string;
  today: string;
  payrollWorkflow?: PayrollWorkflowKpiState | null;
  reportingKpi?: ReportingKpiClientFacts | null;
}): T & { reporting: ClientOperationsReportingRowPresentation; reporting_kpi: ReportingKpiClientFacts } {
  const vatLookup = resolveVatCalendarLookupPeriodKey({
    vat_frequency: input.tax?.vat_frequency ?? null,
    operational_period_key: input.selectedPeriodKey,
  });
  const vatCalendarKey = resolveVatCalendarObligationKey({
    vat_type: input.tax?.vat_type ?? null,
    vat_due_type: input.tax?.vat_due_type ?? null,
  });
  const vatDue = lookupCalendarDueDate(input.calendarDueByKey, vatCalendarKey, vatLookup);
  const advancesDue = lookupCalendarDueDate(
    input.calendarDueByKey,
    incomeTaxAdvancesCalendarKey(),
    input.selectedPeriodKey,
  );
  const itdDue = lookupCalendarDueDate(
    input.calendarDueByKey,
    incomeTaxDeductionsCalendarKey(),
    input.selectedPeriodKey,
  );

  const niDedCell = input.row.national_insurance_deductions_cell;
  const niDedApplicable = Boolean(niDedCell?.applicable ?? input.row.period_applicability?.national_insurance_deductions_applicable);
  const niDedSubmitted = nationalInsuranceDeductionsPeriodicSubmitted({
    reported_102: niDedCell?.items?.['102']?.completed,
    reported_100: niDedCell?.items?.['100']?.completed,
  });
  const itdCell = input.row.income_tax_deductions_cell;
  const itdApplicable = Boolean(itdCell?.applicable ?? input.row.period_applicability?.income_tax_deductions_applicable);
  const payrollNotRelevant = payrollWorkflowIsNotRelevant(input.payrollWorkflow ?? {});
  const payrollApplicable =
    Boolean(input.row.period_applicability?.payroll_applicable) && !payrollNotRelevant;
  const payrollSubmitted = payrollWorkflowCountsAsSubmitted(input.payrollWorkflow ?? {});
  const annualFact = input.facts.find((f) => f.obligation_type === 'annual_report') ?? null;
  const annualDue = annualFact?.due_date ?? null;

  const withPayment = (
    cellInput: ReturnType<typeof buildReportingCellInputFromFacts>,
  ): ReturnType<typeof buildReportingCellInputFromFacts> => {
    const payment = paymentFactForCanonical(input.paymentFacts, cellInput.canonical_id);
    return {
      ...cellInput,
      payment_classification: payment?.payment_classification ?? cellInput.payment_classification ?? null,
      payment_due_date: payment?.payment_due_date ?? cellInput.payment_due_date ?? null,
    };
  };

  const cells = [
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'vat',
        applicable: Boolean(input.row.period_applicability?.vat_applicable),
        operationalPeriodKey: input.selectedPeriodKey,
        vatFrequency: input.tax?.vat_frequency ?? null,
        facts: input.facts,
        calendarDueDate: vatDue,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'income_tax_advance',
        applicable: Boolean(input.row.period_applicability?.income_tax_advance_applicable),
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: advancesDue,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'payroll',
        applicable: payrollApplicable,
        submittedOverride: payrollSubmitted,
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: null,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'national_insurance',
        applicable: Boolean(input.row.period_applicability?.national_insurance_applicable),
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: null,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'income_tax_deductions',
        applicable: itdApplicable,
        submittedOverride: itdCell?.completed ?? false,
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: itdDue,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'national_insurance_deductions',
        applicable: niDedApplicable,
        submittedOverride: niDedSubmitted,
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: null,
      }),
    ),
    withPayment(
      buildReportingCellInputFromFacts({
        kind: 'annual',
        applicable: Boolean(annualDue && annualDue.slice(0, 7) === input.selectedPeriodKey),
        operationalPeriodKey: input.selectedPeriodKey,
        facts: input.facts,
        calendarDueDate: null,
      }),
    ),
  ];

  const reporting: ClientOperationsReportingRowPresentation = buildReportingRowPresentation(cells, input.today);
  const reporting_kpi: ReportingKpiClientFacts = input.reportingKpi ?? {
    annual_required: false,
    annual_submitted: false,
    capital_required: false,
    capital_submitted: false,
  };
  return { ...input.row, reporting, reporting_kpi };
}

export function buildPreviousPeriodFactsFromLoad(input: {
  selectedPeriodKey: string;
  previousPeriodKeys: string[];
  load: ReportingDashboardLoad;
  today: string;
  taxByClient?: ReadonlyMap<string, ReportingDashboardTaxSettings>;
}): ClientOperationsReportingPreviousPeriods {
  const facts: ClientOperationsPreviousPeriodFact[] = [];
  for (const snap of input.load.previousSnapshots) {
    const periodKey = snap.operational_period_key;
    const clientFacts = input.load.factsByClient.get(snap.client_id) ?? [];
    const itd = input.load.itdReportedByClientPeriod.get(clientPeriodKey(snap.client_id, periodKey));
    const niDed = input.load.niDedByClientPeriod.get(clientPeriodKey(snap.client_id, periodKey));
    const tax = input.taxByClient?.get(snap.client_id) ?? null;
    const checks: Array<{ applicable: boolean; submitted: boolean; due: string | null }> = [];

    const vatFreq = (snap as { vat_frequency?: string | null }).vat_frequency ?? tax?.vat_frequency ?? null;
    const vatDue = resolvePreviousPeriodVatCalendarDue({
      vat_frequency: vatFreq,
      vat_type: tax?.vat_type ?? null,
      vat_due_type: tax?.vat_due_type ?? null,
      operational_period_key: periodKey,
      calendarDueByKey: input.load.calendarDueByKey,
    });
    const vatFact = pickVatObligationFactForFrequency(clientFacts, periodKey, vatFreq);
    checks.push({
      applicable: Boolean(snap.vat_applicable),
      submitted: isFilingSubmittedStatus(vatFact?.status),
      due: vatDue,
    });

    const itaFact = clientFacts.find((f) => f.obligation_type === 'income_tax_advance' && f.period_key === periodKey);
    checks.push({
      applicable: Boolean(snap.income_tax_advance_applicable),
      submitted: isFilingSubmittedStatus(itaFact?.status),
      due: input.load.calendarDueByKey.get(calendarDueMapKey(incomeTaxAdvancesCalendarKey(), periodKey)) ?? null,
    });

    const payrollFact = clientFacts.find(
      (f) =>
        (f.obligation_type === 'payroll_data' || f.obligation_type === 'payroll_submission') &&
        f.period_key === periodKey,
    );
    checks.push({
      applicable: Boolean(snap.payroll_applicable),
      submitted: isFilingSubmittedStatus(payrollFact?.status),
      due: null,
    });

    checks.push({
      applicable: Boolean(snap.income_tax_deductions_applicable) && !itd?.not_relevant,
      submitted: Boolean(itd?.reported),
      due: input.load.calendarDueByKey.get(calendarDueMapKey(incomeTaxDeductionsCalendarKey(), periodKey)) ?? null,
    });
    checks.push({
      applicable: Boolean(snap.national_insurance_deductions_applicable) && !niDed?.not_relevant,
      submitted: Boolean(niDed?.reported_102 && niDed?.reported_100),
      due: null,
    });

    const incomplete = checks.filter((c) => c.applicable && !c.submitted);
    if (!incomplete.length) continue;
    const overdue = incomplete.some((c) => isAuthoritativeLegalOverdue(c.due, input.today));
    facts.push({
      period_key: periodKey,
      navigate_period_key: periodKey,
      kind: 'month',
      applicable_incomplete: true,
      overdue,
    });
  }

  for (const [clientId, clientFacts] of input.load.factsByClient) {
    void clientId;
    for (const fact of clientFacts) {
      if (fact.obligation_type !== 'annual_report') continue;
      if (isFilingSubmittedStatus(fact.status) || isFilingNotApplicableStatus(fact.status)) continue;
      const due = fact.due_date;
      const navigate = due ? due.slice(0, 7) : input.previousPeriodKeys[input.previousPeriodKeys.length - 1] ?? input.selectedPeriodKey;
      facts.push({
        period_key: fact.period_key,
        navigate_period_key: navigate,
        kind: 'year',
        applicable_incomplete: true,
        overdue: false,
      });
    }
  }

  return buildPreviousIncompletePeriods({
    selected_period_key: input.selectedPeriodKey,
    facts,
  });
}
