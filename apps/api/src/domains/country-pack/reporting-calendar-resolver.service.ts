/**
 * Country Pack Reporting Calendar resolver — ACTIVE stored dates only.
 * Fail closed. No 15/16/23 fallback. No National Insurance invention.
 */

import { supabaseAdmin } from '../../db/client.js';
import { resolveOrganizationActiveRuleset } from './organization-country.service.js';
import {
  type ClientVatDueType,
  type ClientVatFrequency,
  type ClientVatType,
  type ReportingDueDateResolution,
  type ReportingObligationKey,
  type ResolvedReportingDueDate,
  incomeTaxAdvancesObligationKey,
  incomeTaxDeductionsObligationKey,
  isNationalInsuranceObligationKey,
  isReportingObligationKey,
  isReportingPeriodKey,
  biMonthlyVatPairEndPeriodKey,
  isFilingDueDateAfterReportingPeriodEnd,
  isVatReportingPeriodApplicable,
  resolveVatObligationKeyFromClientTaxSettings,
  unresolvedReportingDueDate,
} from './reporting-calendar.pure.js';

type CalendarEntryRow = {
  id: string;
  country_code: string;
  obligation_key: string;
  reporting_period_key: string;
  filing_due_date: string;
  explanation_code: string | null;
  legal_basis_reference: string | null;
  status: string;
  replaces_entry_id: string | null;
  country_pack_ruleset_id: string | null;
};

export type ReportingDueDateBatchLookup = {
  obligation_key: string;
  reporting_period_key: string;
};

function batchLookupKey(obligationKey: string, periodKey: string): string {
  return `${obligationKey}::${periodKey}`;
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function asResolved(row: CalendarEntryRow): ResolvedReportingDueDate {
  return {
    resolved: true,
    country_code: String(row.country_code).toUpperCase(),
    obligation_key: row.obligation_key as ReportingObligationKey,
    reporting_period_key: row.reporting_period_key,
    filing_due_date: toIsoDate(String(row.filing_due_date)),
    entry_id: row.id,
    status: 'active',
    explanation_code: row.explanation_code,
    legal_basis_reference: row.legal_basis_reference,
  };
}

/**
 * Resolve ACTIVE calendar entries for many obligation/period pairs in one query.
 * Returned map is keyed as `${obligation_key}::${reporting_period_key}`.
 */
export async function resolveReportingDueDatesBatch(input: {
  country_code: string;
  country_pack_ruleset_id?: string | null;
  lookups: ReportingDueDateBatchLookup[];
}): Promise<Map<string, ReportingDueDateResolution>> {
  const countryCode = String(input.country_code ?? '')
    .trim()
    .toUpperCase();
  const requested = new Map<string, ReportingDueDateBatchLookup>();
  const out = new Map<string, ReportingDueDateResolution>();

  for (const raw of input.lookups ?? []) {
    const obligationKey = String(raw.obligation_key ?? '').trim();
    const periodKey = String(raw.reporting_period_key ?? '').trim();
    const key = batchLookupKey(obligationKey, periodKey);
    if (requested.has(key)) continue;

    if (!countryCode || countryCode.length !== 2) {
      out.set(key, unresolvedReportingDueDate(countryCode || '??', obligationKey, periodKey, 'country_mismatch'));
      continue;
    }
    if (isNationalInsuranceObligationKey(obligationKey)) {
      out.set(
        key,
        unresolvedReportingDueDate(
          countryCode,
          obligationKey,
          periodKey,
          'national_insurance_not_in_tax_authority_calendar'
        )
      );
      continue;
    }
    if (!isReportingObligationKey(obligationKey)) {
      out.set(key, unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'invalid_obligation_key'));
      continue;
    }
    if (!isReportingPeriodKey(periodKey)) {
      out.set(key, unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'invalid_reporting_period_key'));
      continue;
    }
    requested.set(key, { obligation_key: obligationKey, reporting_period_key: periodKey });
  }

  const validLookups = [...requested.values()];
  if (!validLookups.length) return out;

  const obligationKeys = [...new Set(validLookups.map((l) => l.obligation_key))];
  const periodKeys = [...new Set(validLookups.map((l) => l.reporting_period_key))];
  const requestedKeys = new Set(requested.keys());

  let query = supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select(
      'id, country_code, obligation_key, reporting_period_key, filing_due_date, explanation_code, legal_basis_reference, status, replaces_entry_id, country_pack_ruleset_id'
    )
    .eq('country_code', countryCode)
    .in('obligation_key', obligationKeys)
    .in('reporting_period_key', periodKeys)
    .eq('status', 'active');

  if (input.country_pack_ruleset_id) {
    query = query.or(
      `country_pack_ruleset_id.eq.${input.country_pack_ruleset_id},country_pack_ruleset_id.is.null`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rowsByLookup = new Map<string, CalendarEntryRow[]>();
  for (const row of (data ?? []) as CalendarEntryRow[]) {
    const key = batchLookupKey(row.obligation_key, row.reporting_period_key);
    if (!requestedKeys.has(key)) continue;
    const rows = rowsByLookup.get(key) ?? [];
    rows.push(row);
    rowsByLookup.set(key, rows);
  }

  for (const [key, rows] of rowsByLookup.entries()) {
    const preferred =
      (input.country_pack_ruleset_id
        ? rows.find((r) => r.country_pack_ruleset_id === input.country_pack_ruleset_id)
        : null) ?? rows[0]!;
    out.set(key, asResolved(preferred));
  }

  const missing = validLookups.filter((lookup) => !out.has(batchLookupKey(lookup.obligation_key, lookup.reporting_period_key)));
  if (missing.length) {
    const { data: draftRows, error: draftErr } = await supabaseAdmin
      .from('country_reporting_calendar_entries')
      .select('obligation_key, reporting_period_key')
      .eq('country_code', countryCode)
      .in('obligation_key', [...new Set(missing.map((l) => l.obligation_key))])
      .in('reporting_period_key', [...new Set(missing.map((l) => l.reporting_period_key))])
      .eq('status', 'draft');
    if (draftErr) throw draftErr;
    const draftKeys = new Set(
      ((draftRows ?? []) as Array<{ obligation_key: string; reporting_period_key: string }>)
        .map((row) => batchLookupKey(row.obligation_key, row.reporting_period_key))
        .filter((key) => requestedKeys.has(key))
    );
    for (const lookup of missing) {
      const key = batchLookupKey(lookup.obligation_key, lookup.reporting_period_key);
      out.set(
        key,
        unresolvedReportingDueDate(
          countryCode,
          lookup.obligation_key,
          lookup.reporting_period_key,
          draftKeys.has(key) ? 'draft_not_runtime_truth' : 'missing_active_entry'
        )
      );
    }
  }

  return out;
}

/**
 * Resolve a single ACTIVE calendar entry for country + obligation + reporting period.
 * Draft / deprecated / disabled never become runtime legal truth.
 */
export async function resolveReportingDueDate(input: {
  country_code: string;
  obligation_key: string;
  reporting_period_key: string;
  country_pack_ruleset_id?: string | null;
}): Promise<ReportingDueDateResolution> {
  const countryCode = String(input.country_code ?? '')
    .trim()
    .toUpperCase();
  const obligationKey = String(input.obligation_key ?? '').trim();
  const periodKey = String(input.reporting_period_key ?? '').trim();

  if (!countryCode || countryCode.length !== 2) {
    return unresolvedReportingDueDate(countryCode || '??', obligationKey, periodKey, 'country_mismatch');
  }
  if (isNationalInsuranceObligationKey(obligationKey)) {
    return unresolvedReportingDueDate(
      countryCode,
      obligationKey,
      periodKey,
      'national_insurance_not_in_tax_authority_calendar'
    );
  }
  if (!isReportingObligationKey(obligationKey)) {
    return unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'invalid_obligation_key');
  }
  if (!isReportingPeriodKey(periodKey)) {
    return unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'invalid_reporting_period_key');
  }

  let query = supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select(
      'id, country_code, obligation_key, reporting_period_key, filing_due_date, explanation_code, legal_basis_reference, status, replaces_entry_id, country_pack_ruleset_id'
    )
    .eq('country_code', countryCode)
    .eq('obligation_key', obligationKey)
    .eq('reporting_period_key', periodKey)
    .eq('status', 'active')
    .limit(2);

  if (input.country_pack_ruleset_id) {
    query = query.or(
      `country_pack_ruleset_id.eq.${input.country_pack_ruleset_id},country_pack_ruleset_id.is.null`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as CalendarEntryRow[];
  if (!rows.length) {
    const { data: draftRows, error: draftErr } = await supabaseAdmin
      .from('country_reporting_calendar_entries')
      .select('id, status')
      .eq('country_code', countryCode)
      .eq('obligation_key', obligationKey)
      .eq('reporting_period_key', periodKey)
      .eq('status', 'draft')
      .limit(1);
    if (draftErr) throw draftErr;
    if (draftRows?.length) {
      return unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'draft_not_runtime_truth');
    }
    return unresolvedReportingDueDate(countryCode, obligationKey, periodKey, 'missing_active_entry');
  }

  const preferred =
    (input.country_pack_ruleset_id
      ? rows.find((r) => r.country_pack_ruleset_id === input.country_pack_ruleset_id)
      : null) ?? rows[0]!;

  return asResolved(preferred);
}

/** Organization-scoped resolve: country from org Country Pack settings; fail closed. */
export async function resolveOrganizationReportingDueDate(input: {
  organization_id: string;
  obligation_key: string;
  reporting_period_key: string;
  as_of_date?: string;
}): Promise<ReportingDueDateResolution> {
  const asOf = (input.as_of_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const orgCtx = await resolveOrganizationActiveRuleset(input.organization_id, asOf);
  const countryCode = String(orgCtx.country_code ?? '')
    .trim()
    .toUpperCase();
  if (!countryCode) {
    return unresolvedReportingDueDate(
      '',
      input.obligation_key,
      input.reporting_period_key,
      'country_mismatch'
    );
  }
  return resolveReportingDueDate({
    country_code: countryCode,
    obligation_key: input.obligation_key,
    reporting_period_key: input.reporting_period_key,
    country_pack_ruleset_id: orgCtx.ruleset_id,
  });
}

/**
 * Client VAT due date from Country Pack calendar + client_tax_settings.
 * Backend selects regular vs PCN and period applicability from vat_frequency.
 * Frontend must not branch.
 */
export async function resolveClientVatReportingDueDate(input: {
  country_code: string;
  reporting_period_key: string;
  vat_type: ClientVatType | string | null | undefined;
  vat_due_type: ClientVatDueType | string | null | undefined;
  vat_frequency?: ClientVatFrequency | string | null | undefined;
  country_pack_ruleset_id?: string | null;
}): Promise<ReportingDueDateResolution> {
  const obligationKey = resolveVatObligationKeyFromClientTaxSettings({
    vat_type: input.vat_type,
    vat_due_type: input.vat_due_type,
  });
  if (!obligationKey) {
    return unresolvedReportingDueDate(
      input.country_code,
      String(input.vat_due_type ?? 'vat'),
      input.reporting_period_key,
      'vat_not_applicable'
    );
  }
  if (
    !isVatReportingPeriodApplicable({
      vat_frequency: input.vat_frequency,
      reporting_period_key: input.reporting_period_key,
    })
  ) {
    return unresolvedReportingDueDate(
      input.country_code,
      obligationKey,
      input.reporting_period_key,
      'vat_period_not_applicable_for_frequency'
    );
  }

  const frequency = String(input.vat_frequency ?? '')
    .trim()
    .toLowerCase();

  /**
   * Bi-monthly: period identity is the odd start key, but Country Pack monthly rows for
   * that start key carry the *monthly* filing date (often mid-pair). Filing due date for
   * the completed pair must come from the pair-end month row so it cannot precede pair end.
   * Country Pack schema has no frequency dimension — this is the only ACTIVE legal mapping
   * that satisfies the completion invariant without inventing dates.
   */
  let calendarLookupKey = input.reporting_period_key;
  let periodEndKeyForInvariant = input.reporting_period_key;
  if (frequency === 'bi_monthly') {
    const endKey = biMonthlyVatPairEndPeriodKey(input.reporting_period_key);
    if (!endKey) {
      return unresolvedReportingDueDate(
        input.country_code,
        obligationKey,
        input.reporting_period_key,
        'invalid_reporting_period_key'
      );
    }
    calendarLookupKey = endKey;
    periodEndKeyForInvariant = endKey;
  }

  const resolved = await resolveReportingDueDate({
    country_code: input.country_code,
    obligation_key: obligationKey,
    reporting_period_key: calendarLookupKey,
    country_pack_ruleset_id: input.country_pack_ruleset_id,
  });

  if (
    resolved.resolved &&
    !isFilingDueDateAfterReportingPeriodEnd(resolved.filing_due_date, periodEndKeyForInvariant)
  ) {
    return unresolvedReportingDueDate(
      input.country_code,
      obligationKey,
      input.reporting_period_key,
      'filing_due_before_reporting_period_end'
    );
  }

  return resolved;
}

export async function resolveClientIncomeTaxAdvancesDueDate(input: {
  country_code: string;
  reporting_period_key: string;
  income_tax_advance_enabled?: boolean | null | undefined;
  country_pack_ruleset_id?: string | null;
}): Promise<ReportingDueDateResolution> {
  if (!input.income_tax_advance_enabled) {
    return unresolvedReportingDueDate(
      input.country_code,
      incomeTaxAdvancesObligationKey(),
      input.reporting_period_key,
      'income_tax_advances_not_applicable'
    );
  }
  return resolveReportingDueDate({
    country_code: input.country_code,
    obligation_key: incomeTaxAdvancesObligationKey(),
    reporting_period_key: input.reporting_period_key,
    country_pack_ruleset_id: input.country_pack_ruleset_id,
  });
}

export async function resolveClientIncomeTaxDeductionsDueDate(input: {
  country_code: string;
  reporting_period_key: string;
  country_pack_ruleset_id?: string | null;
}): Promise<ReportingDueDateResolution> {
  return resolveReportingDueDate({
    country_code: input.country_code,
    obligation_key: incomeTaxDeductionsObligationKey(),
    reporting_period_key: input.reporting_period_key,
    country_pack_ruleset_id: input.country_pack_ruleset_id,
  });
}

/** Explicitly refuse NI resolution from this Tax Authority calendar. */
export async function resolveNationalInsuranceDeductionsDueDate(input: {
  country_code: string;
  reporting_period_key: string;
}): Promise<ReportingDueDateResolution> {
  return unresolvedReportingDueDate(
    input.country_code,
    'national_insurance_deductions',
    input.reporting_period_key,
    'national_insurance_not_in_tax_authority_calendar'
  );
}
