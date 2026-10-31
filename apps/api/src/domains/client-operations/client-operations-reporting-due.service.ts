/**
 * Client Operations reporting due dates — Owner Reporting Calendar only.
 * No 19/23 / May 31 invention. Unresolved → not_configured (display —).
 */

import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import {
  formatFilingDueDateDisplay,
  isFilingDueDateAfterReportingPeriodEnd,
  isVatReportingPeriodApplicable,
  resolveVatObligationKeyFromClientTaxSettings,
  type ReportingDueDateResolution,
} from '../country-pack/reporting-calendar.pure.js';
import {
  resolveClientIncomeTaxAdvancesDueDate,
  resolveClientIncomeTaxDeductionsDueDate,
  resolveClientVatReportingDueDate,
  resolveReportingDueDatesBatch,
} from '../country-pack/reporting-calendar-resolver.service.js';
import {
  QUICK_PROFILE_EMPTY_DISPLAY,
  resolveVatOperationalCalendarLookupPeriodKey,
  resolveVatOperationalReportingPeriodKey,
} from './client-operations-client-quick-profile.pure.js';
import { vatPeriodIdentityForSelectedPeriod } from './client-operations-reporting-due.pure.js';

export { vatPeriodIdentityForSelectedPeriod };

export const REPORTING_DUE_NOT_CONFIGURED_STATUS = 'not_configured' as const;
export const REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE = QUICK_PROFILE_EMPTY_DISPLAY;

export function displayHeFromReportingDueResolution(
  resolution: ReportingDueDateResolution | null | undefined,
): string | null {
  if (!resolution?.resolved || !resolution.filing_due_date) return null;
  return formatFilingDueDateDisplay(resolution.filing_due_date);
}

function calendarLookupMapKey(obligationKey: string, periodKey: string): string {
  return `${obligationKey}::${periodKey}`;
}

export async function resolveVatDueDisplayForSelectedPeriod(input: {
  organizationId: string;
  selectedPeriodKey: string;
  vat_type: string | null | undefined;
  vat_due_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  asOfDate?: string;
}): Promise<{
  filing_due_date: string | null;
  display_he: string | null;
  status: 'configured' | typeof REPORTING_DUE_NOT_CONFIGURED_STATUS;
}> {
  const identity = vatPeriodIdentityForSelectedPeriod(input.vat_frequency, input.selectedPeriodKey);
  if (!identity) {
    return {
      filing_due_date: null,
      display_he: REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE,
      status: REPORTING_DUE_NOT_CONFIGURED_STATUS,
    };
  }
  const asOf = (input.asOfDate ?? `${input.selectedPeriodKey}-01`).slice(0, 10);
  const orgCtx = await resolveOrganizationActiveRuleset(input.organizationId, asOf);
  const resolved = await resolveClientVatReportingDueDate({
    country_code: orgCtx.country_code,
    reporting_period_key: identity,
    vat_type: input.vat_type,
    vat_due_type: input.vat_due_type,
    vat_frequency: input.vat_frequency,
    country_pack_ruleset_id: orgCtx.ruleset_id,
  });
  const display = displayHeFromReportingDueResolution(resolved);
  if (!display || !resolved.resolved) {
    return {
      filing_due_date: null,
      display_he: REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE,
      status: REPORTING_DUE_NOT_CONFIGURED_STATUS,
    };
  }
  return { filing_due_date: resolved.filing_due_date, display_he: display, status: 'configured' };
}

/** Current relevant VAT period (same identity as Quick Profile) for Tax tab. */
export async function resolveVatDueDisplayForCurrentRelevantPeriod(input: {
  organizationId: string;
  vat_type: string | null | undefined;
  vat_due_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  now?: Date;
}): Promise<{
  filing_due_date: string | null;
  display_he: string | null;
  status: 'configured' | typeof REPORTING_DUE_NOT_CONFIGURED_STATUS;
}> {
  const identity = resolveVatOperationalReportingPeriodKey({
    vat_frequency: input.vat_frequency,
    now: input.now,
  });
  if (!identity) {
    return {
      filing_due_date: null,
      display_he: REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE,
      status: REPORTING_DUE_NOT_CONFIGURED_STATUS,
    };
  }
  return resolveVatDueDisplayForSelectedPeriod({
    organizationId: input.organizationId,
    selectedPeriodKey: identity,
    vat_type: input.vat_type,
    vat_due_type: input.vat_due_type,
    vat_frequency: input.vat_frequency,
    asOfDate: (input.now ?? new Date()).toISOString().slice(0, 10),
  });
}

export async function resolveVatDueDisplayByClientForRegistry(input: {
  organizationId: string;
  selectedPeriodKey: string;
  clients: Array<{
    clientId: string;
    vat_type: string | null | undefined;
    vat_due_type: string | null | undefined;
    vat_frequency: string | null | undefined;
  }>;
}): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!input.clients.length) return out;

  const asOf = `${input.selectedPeriodKey}-01`;
  const orgCtx = await resolveOrganizationActiveRuleset(input.organizationId, asOf);
  const countryCode = String(orgCtx.country_code ?? '')
    .trim()
    .toUpperCase();

  const lookups: Array<{ obligation_key: string; reporting_period_key: string }> = [];
  const perClient: Array<{
    clientId: string;
    obligationKey: string;
    lookupKey: string;
    identityKey: string;
  }> = [];

  for (const c of input.clients) {
    const identity = vatPeriodIdentityForSelectedPeriod(c.vat_frequency, input.selectedPeriodKey);
    const obligationKey = resolveVatObligationKeyFromClientTaxSettings({
      vat_type: c.vat_type,
      vat_due_type: c.vat_due_type,
    });
    if (!identity || !obligationKey) {
      out.set(c.clientId, REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE);
      continue;
    }
    if (
      !isVatReportingPeriodApplicable({
        vat_frequency: c.vat_frequency,
        reporting_period_key: identity,
      })
    ) {
      out.set(c.clientId, REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE);
      continue;
    }
    const lookupKey = resolveVatOperationalCalendarLookupPeriodKey({
      vat_frequency: c.vat_frequency,
      period_identity_key: identity,
    });
    if (!lookupKey) {
      out.set(c.clientId, REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE);
      continue;
    }
    lookups.push({ obligation_key: obligationKey, reporting_period_key: lookupKey });
    perClient.push({ clientId: c.clientId, obligationKey, lookupKey, identityKey: identity });
  }

  const resolved = lookups.length
    ? await resolveReportingDueDatesBatch({
        country_code: countryCode,
        country_pack_ruleset_id: orgCtx.ruleset_id,
        lookups,
      })
    : new Map<string, ReportingDueDateResolution>();

  for (const c of perClient) {
    const candidate = resolved.get(calendarLookupMapKey(c.obligationKey, c.lookupKey));
    if (
      candidate?.resolved &&
      !isFilingDueDateAfterReportingPeriodEnd(candidate.filing_due_date, c.lookupKey)
    ) {
      out.set(c.clientId, REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE);
      continue;
    }
    const display = displayHeFromReportingDueResolution(candidate);
    out.set(c.clientId, display ?? REPORTING_DUE_NOT_CONFIGURED_DISPLAY_HE);
  }

  return out;
}

export async function resolveOfficialFilingDueDateIso(input: {
  organizationId: string;
  kind: 'vat' | 'income_tax_advance' | 'income_tax_deductions';
  reportingPeriodKey: string;
  vat_type?: string | null;
  vat_due_type?: string | null;
  vat_frequency?: string | null;
  income_tax_advance_enabled?: boolean;
  asOfDate?: string;
}): Promise<string | null> {
  const asOf = (input.asOfDate ?? `${input.reportingPeriodKey}-01`).slice(0, 10);
  const orgCtx = await resolveOrganizationActiveRuleset(input.organizationId, asOf);
  if (input.kind === 'vat') {
    const resolved = await resolveClientVatReportingDueDate({
      country_code: orgCtx.country_code,
      reporting_period_key: input.reportingPeriodKey,
      vat_type: input.vat_type,
      vat_due_type: input.vat_due_type,
      vat_frequency: input.vat_frequency,
      country_pack_ruleset_id: orgCtx.ruleset_id,
    });
    return resolved.resolved ? resolved.filing_due_date : null;
  }
  if (input.kind === 'income_tax_advance') {
    const resolved = await resolveClientIncomeTaxAdvancesDueDate({
      country_code: orgCtx.country_code,
      reporting_period_key: input.reportingPeriodKey,
      income_tax_advance_enabled: input.income_tax_advance_enabled ?? true,
      country_pack_ruleset_id: orgCtx.ruleset_id,
    });
    return resolved.resolved ? resolved.filing_due_date : null;
  }
  const resolved = await resolveClientIncomeTaxDeductionsDueDate({
    country_code: orgCtx.country_code,
    reporting_period_key: input.reportingPeriodKey,
    country_pack_ruleset_id: orgCtx.ruleset_id,
  });
  return resolved.resolved ? resolved.filing_due_date : null;
}
