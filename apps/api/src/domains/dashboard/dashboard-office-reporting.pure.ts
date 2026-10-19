/**
 * Dashboard upcoming-report grouping over Country Pack stored due dates
 * and client tax-settings applicability. Does not invent statutory days
 * or infer filings from missing Work Engine tasks.
 */
import {
  REPORTING_OBLIGATION_KEYS,
  biMonthlyVatPairEndPeriodKey,
  buildReportingPeriodKey,
  isReportingObligationKey,
  isVatReportingPeriodApplicable,
  parseReportingPeriodKey,
  resolveVatObligationKeyFromClientTaxSettings,
  type ReportingObligationKey,
} from '../country-pack/reporting-calendar.pure.js';

export type DashboardReportingCalendarEntry = {
  obligation_key: string;
  reporting_period_key: string;
  filing_due_date: string;
};

export type DashboardReportingClientTax = {
  client_id: string;
  display_name: string;
  vat_type: string | null;
  vat_due_type: string | null;
  vat_frequency: string | null;
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_frequency: string | null;
};

export type DashboardReportingGroup = {
  obligation_key: ReportingObligationKey;
  reporting_period_key: string;
  filing_due_date: string;
  client_ids: string[];
};

export type DashboardReportingTiming = 'upcoming' | 'due_today' | 'overdue';

export function reportingTimingStatus(filingDueDate: string, today: string): DashboardReportingTiming {
  const due = filingDueDate.slice(0, 10);
  if (due < today) return 'overdue';
  if (due === today) return 'due_today';
  return 'upcoming';
}

/** Drill-down may list clients only for an ACTIVE stored upcoming calendar row. */
export function isActiveUpcomingReportingEntry(
  entry: {
    status: string;
    obligation_key: string;
    reporting_period_key: string;
    filing_due_date: string;
  } | null,
  requested: { obligation_key: string; reporting_period_key: string; filing_due_date: string },
  today: string,
): boolean {
  if (!entry) return false;
  if (String(entry.status).toLowerCase() !== 'active') return false;
  if (!isReportingObligationKey(entry.obligation_key)) return false;
  if (entry.obligation_key !== requested.obligation_key) return false;
  if (entry.reporting_period_key !== requested.reporting_period_key) return false;
  const due = String(entry.filing_due_date ?? '').slice(0, 10);
  const requestedDue = String(requested.filing_due_date ?? '').slice(0, 10);
  if (due !== requestedDue || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  return due >= today.slice(0, 10);
}

function pairStartKeyForEvenPeriod(periodKey: string): string | null {
  const parsed = parseReportingPeriodKey(periodKey);
  if (!parsed || parsed.month % 2 !== 0) return null;
  return buildReportingPeriodKey(parsed.year, parsed.month - 1);
}

export function clientAppliesToReportingEntry(
  client: DashboardReportingClientTax,
  entry: DashboardReportingCalendarEntry,
): boolean {
  if (!isReportingObligationKey(entry.obligation_key)) return false;

  if (entry.obligation_key === 'income_tax_deductions') {
    if (client.income_tax_deductions_enabled !== true) return false;
    const freq = String(client.income_tax_deductions_frequency ?? '')
      .trim()
      .toLowerCase();
    // Frequency identity other than monthly is not owned by this Dashboard projection.
    return freq === 'monthly';
  }

  const vatKey = resolveVatObligationKeyFromClientTaxSettings({
    vat_type: client.vat_type,
    vat_due_type: client.vat_due_type,
  });
  if (vatKey !== entry.obligation_key) return false;

  const freq = String(client.vat_frequency ?? '')
    .trim()
    .toLowerCase();
  if (freq === 'monthly') {
    return isVatReportingPeriodApplicable({
      vat_frequency: 'monthly',
      reporting_period_key: entry.reporting_period_key,
    });
  }
  if (freq === 'bi_monthly') {
    const startKey = pairStartKeyForEvenPeriod(entry.reporting_period_key);
    if (!startKey) return false;
    return biMonthlyVatPairEndPeriodKey(startKey) === entry.reporting_period_key;
  }
  return false;
}

export function groupUpcomingReportingObligations(input: {
  entries: DashboardReportingCalendarEntry[];
  clients: DashboardReportingClientTax[];
  today: string;
  limit: number;
}): DashboardReportingGroup[] {
  const today = input.today.slice(0, 10);
  const byKey = new Map<string, DashboardReportingGroup>();
  for (const entry of input.entries) {
    if (!isReportingObligationKey(entry.obligation_key)) continue;
    const due = String(entry.filing_due_date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today) continue;
    const mapKey = `${entry.obligation_key}::${due}::${entry.reporting_period_key}`;
    const existing = byKey.get(mapKey) ?? {
      obligation_key: entry.obligation_key,
      reporting_period_key: entry.reporting_period_key,
      filing_due_date: due,
      client_ids: [],
    };
    for (const client of input.clients) {
      if (existing.client_ids.includes(client.client_id)) continue;
      if (clientAppliesToReportingEntry(client, entry)) existing.client_ids.push(client.client_id);
    }
    byKey.set(mapKey, existing);
  }
  return [...byKey.values()]
    .filter((g) => g.client_ids.length > 0)
    .sort((a, b) => {
      const d = a.filing_due_date.localeCompare(b.filing_due_date);
      if (d !== 0) return d;
      return a.obligation_key.localeCompare(b.obligation_key);
    })
    .slice(0, Math.max(0, input.limit));
}

export const DASHBOARD_REPORTING_OBLIGATION_KEYS = REPORTING_OBLIGATION_KEYS;
