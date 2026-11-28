/**
 * Dashboard reporting summary.
 *
 * VAT / advances / deductions: unique clients with applicable, unfiled
 * Country Pack / Reporting Calendar legal due dates.
 *
 * Annual report / capital declaration: unique clients from Client Operations
 * office-control dates (`operational_target_date`) and filing status.
 * Those dates are accountant-managed office targets, not Reporting Calendar
 * legal due dates and not Work Engine SLA.
 *
 * Does not invent statutory days, zero deadlines, tax payment, or missing docs.
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
import {
  isIncomeTaxDeductionsFrequencyApplicableForOperationalPeriod,
  isIncomeTaxFrequencyApplicableForOperationalPeriod,
} from '../client-operations/client-operations-operational-period.pure.js';

export const DASHBOARD_REPORTING_UPCOMING_WINDOW_DAYS = 60;

export const DASHBOARD_REPORTING_CATEGORIES = [
  'vat',
  'income_tax_advances',
  'income_tax_deductions',
  'annual_report',
  'capital_declaration',
] as const;

export type DashboardReportingCategory = (typeof DASHBOARD_REPORTING_CATEGORIES)[number];

export const DASHBOARD_UPCOMING_REPORTING_CATEGORIES: readonly DashboardReportingCategory[] =
  DASHBOARD_REPORTING_CATEGORIES;

export const DASHBOARD_OVERDUE_REPORTING_CATEGORIES: readonly DashboardReportingCategory[] = [
  'vat',
  'income_tax_advances',
  'annual_report',
  'capital_declaration',
];

const ANNUAL_CALENDAR_KEYS = new Set(['annual_report', 'capital_declaration']);

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
  income_tax_advance_enabled: boolean;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_frequency: string | null;
};

export type DashboardReportingFiling = {
  client_id: string;
  category_key: DashboardReportingCategory;
  reporting_period_key: string;
};

/** Accountant-managed Client Operations control dates — not Reporting Calendar legal due dates. */
export type DashboardOfficeControlDeadline = {
  client_id: string;
  category_key: 'annual_report' | 'capital_declaration';
  operational_target_date: string | null;
  filed: boolean;
};

export type DashboardOfficeControlSourceRow = {
  client_id: string;
  category_key: 'annual_report' | 'capital_declaration';
  operational_target_date: string | null;
  status: string | null;
  tax_year?: number | null;
  instance_id?: string | null;
};

export type DashboardOfficeControlSubmission = {
  client_id: string;
  tab_scope: 'annual_report' | 'capital_declaration';
  tax_year?: number | null;
  instance_id?: string | null;
  submitted_on: string | null;
};

export type DashboardReportingLiveClient = {
  client_id: string;
  display_name: string;
};

export type DashboardReportingGroup = {
  obligation_key: ReportingObligationKey;
  reporting_period_key: string;
  filing_due_date: string;
  client_ids: string[];
};

export type DashboardReportingTiming = 'upcoming' | 'due_today' | 'overdue';

export type DashboardReportingCategorySummary = {
  category_key: DashboardReportingCategory;
  clients_count: number;
  client_ids: string[];
  nearest_filing_due_date: string | null;
  nearest_reporting_period_key: string | null;
  nearest_obligation_key: string | null;
};

export type DashboardReportingSummaries = {
  upcoming: DashboardReportingCategorySummary[];
  overdue: DashboardReportingCategorySummary[];
};

const FILED_OBLIGATION_STATUSES = new Set(['reported', 'reported_late', 'reported_and_paid']);

export function addIsoDateDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.slice(0, 10));
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function reportingTimingStatus(filingDueDate: string, today: string): DashboardReportingTiming {
  const due = filingDueDate.slice(0, 10);
  if (due < today) return 'overdue';
  if (due === today) return 'due_today';
  return 'upcoming';
}

export function isDashboardReportingCategory(value: string): value is DashboardReportingCategory {
  return (DASHBOARD_REPORTING_CATEGORIES as readonly string[]).includes(value);
}

export function dashboardReportingCategoryFromObligationType(
  obligationType: string | null | undefined,
): DashboardReportingCategory | null {
  const key = String(obligationType ?? '')
    .trim()
    .toLowerCase();
  if (key === 'vat_report' || key === 'vat') return 'vat';
  if (key === 'income_tax_advance') return 'income_tax_advances';
  if (key === 'income_tax_deductions') return 'income_tax_deductions';
  if (key === 'annual_report') return 'annual_report';
  if (key === 'capital_declaration') return 'capital_declaration';
  return null;
}

export function isFiledReportingObligationStatus(input: {
  last_reported_at?: string | null;
  status?: string | null;
}): boolean {
  if (String(input.last_reported_at ?? '').trim()) return true;
  return FILED_OBLIGATION_STATUSES.has(
    String(input.status ?? '')
      .trim()
      .toLowerCase(),
  );
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
  if (!isReportingObligationKey(entry.obligation_key) && !ANNUAL_CALENDAR_KEYS.has(entry.obligation_key)) {
    return false;
  }
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

function vatFrequencyToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function vatIsApplicable(client: DashboardReportingClientTax): boolean {
  const vatType = String(client.vat_type ?? '')
    .trim()
    .toLowerCase();
  return vatType === 'yes' || vatType === 'multiple' || vatType === 'mixed';
}

function vatCalendarKeysForClient(client: DashboardReportingClientTax): string[] {
  if (!vatIsApplicable(client)) return [];
  const resolved = resolveVatObligationKeyFromClientTaxSettings({
    vat_type: client.vat_type,
    vat_due_type: client.vat_due_type,
  });
  if (resolved) return [resolved];
  // vat_due_type is not a setup requirement; unresolved PCN vs regular uses the regular calendar key.
  return ['vat_regular_income_tax_advances'];
}

function clientAppliesToVatCalendarPeriod(client: DashboardReportingClientTax, periodKey: string): boolean {
  const freq = vatFrequencyToken(client.vat_frequency);
  if (freq === 'monthly') {
    return isVatReportingPeriodApplicable({
      vat_frequency: 'monthly',
      reporting_period_key: periodKey,
    });
  }
  if (freq === 'bi_monthly' || freq === 'bimonthly' || freq === 'bi-monthly') {
    const startKey = pairStartKeyForEvenPeriod(periodKey);
    if (!startKey) return false;
    return biMonthlyVatPairEndPeriodKey(startKey) === periodKey;
  }
  return false;
}

function clientAppliesToAdvanceCalendarPeriod(
  client: DashboardReportingClientTax,
  periodKey: string,
): boolean {
  if (client.income_tax_advance_enabled !== true) return false;
  const freq = vatFrequencyToken(client.income_tax_advance_frequency);
  if (!freq) return false;
  const normalized =
    freq === 'bimonthly' || freq === 'bi-monthly' ? 'bi_monthly' : freq;
  return isIncomeTaxFrequencyApplicableForOperationalPeriod(normalized, periodKey);
}

function clientAppliesToDeductionsCalendarPeriod(
  client: DashboardReportingClientTax,
  periodKey: string,
): boolean {
  if (client.income_tax_deductions_enabled !== true) return false;
  const freq = vatFrequencyToken(client.income_tax_deductions_frequency);
  if (!freq) return false;
  const normalized =
    freq === 'bimonthly' || freq === 'bi-monthly' ? 'bi_monthly' : freq;
  return isIncomeTaxDeductionsFrequencyApplicableForOperationalPeriod(normalized, periodKey);
}

function calendarCategory(entry: DashboardReportingCalendarEntry): DashboardReportingCategory | null {
  if (entry.obligation_key === 'income_tax_deductions') return 'income_tax_deductions';
  if (entry.obligation_key === 'annual_report') return 'annual_report';
  if (entry.obligation_key === 'capital_declaration') return 'capital_declaration';
  if (entry.obligation_key === 'vat_regular_income_tax_advances' || entry.obligation_key === 'vat_detailed') {
    return 'vat';
  }
  return null;
}

function clientAppliesToCategoryEntry(
  client: DashboardReportingClientTax,
  category: DashboardReportingCategory,
  entry: DashboardReportingCalendarEntry,
): boolean {
  if (category === 'vat') {
    if (!vatCalendarKeysForClient(client).includes(entry.obligation_key)) return false;
    return clientAppliesToVatCalendarPeriod(client, entry.reporting_period_key);
  }
  if (category === 'income_tax_advances') {
    if (entry.obligation_key !== 'vat_regular_income_tax_advances') return false;
    return clientAppliesToAdvanceCalendarPeriod(client, entry.reporting_period_key);
  }
  if (category === 'income_tax_deductions') {
    if (entry.obligation_key !== 'income_tax_deductions') return false;
    return clientAppliesToDeductionsCalendarPeriod(client, entry.reporting_period_key);
  }
  return false;
}

export function isDashboardOfficeControlIsoDate(value: string | null | undefined): boolean {
  const raw = String(value ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1990 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
}

export function isDashboardOfficeControlFiled(input: {
  status?: string | null;
  submitted_on?: string | null;
}): boolean {
  const status = String(input.status ?? '')
    .trim()
    .toLowerCase();
  if (status === 'completed') return true;
  return Boolean(String(input.submitted_on ?? '').trim());
}

export function dashboardOfficeControlSubmittedOn(input: {
  category_key: 'annual_report' | 'capital_declaration';
  client_id: string;
  tax_year?: number | null;
  instance_id?: string | null;
  submissions: readonly DashboardOfficeControlSubmission[];
}): string | null {
  for (const row of input.submissions) {
    if (row.tab_scope !== input.category_key) continue;
    if (String(row.client_id) !== input.client_id) continue;
    const submitted = String(row.submitted_on ?? '').trim();
    if (!submitted) continue;
    if (input.category_key === 'annual_report') {
      if (Number(row.tax_year) === Number(input.tax_year)) return submitted.slice(0, 10);
      continue;
    }
    if (input.instance_id && row.instance_id === input.instance_id) return submitted.slice(0, 10);
  }
  return null;
}

export function projectDashboardOfficeControlDeadlines(input: {
  instances: readonly DashboardOfficeControlSourceRow[];
  submissions?: readonly DashboardOfficeControlSubmission[];
}): DashboardOfficeControlDeadline[] {
  const submissions = input.submissions ?? [];
  const out: DashboardOfficeControlDeadline[] = [];
  for (const row of input.instances) {
    const status = String(row.status ?? '')
      .trim()
      .toLowerCase();
    if (status === 'cancelled') continue;
    const submitted_on = dashboardOfficeControlSubmittedOn({
      category_key: row.category_key,
      client_id: row.client_id,
      tax_year: row.tax_year,
      instance_id: row.instance_id,
      submissions,
    });
    const date = String(row.operational_target_date ?? '').slice(0, 10);
    out.push({
      client_id: row.client_id,
      category_key: row.category_key,
      operational_target_date: isDashboardOfficeControlIsoDate(date) ? date : null,
      filed: isDashboardOfficeControlFiled({ status, submitted_on }),
    });
  }
  return out;
}

export function officeControlDeadlineBucket(
  operationalTargetDate: string | null | undefined,
  today: string,
): 'upcoming' | 'overdue' | null {
  const date = String(operationalTargetDate ?? '').slice(0, 10);
  if (!isDashboardOfficeControlIsoDate(date)) return null;
  const day = today.slice(0, 10);
  if (date < day) return 'overdue';
  const upcomingEnd = addIsoDateDays(day, DASHBOARD_REPORTING_UPCOMING_WINDOW_DAYS);
  if (upcomingEnd && date <= upcomingEnd) return 'upcoming';
  return null;
}

function collectOfficeControlCategory(
  category: 'annual_report' | 'capital_declaration',
  items: readonly DashboardOfficeControlDeadline[],
  wanted: 'upcoming' | 'overdue',
  today: string,
): DashboardReportingCategorySummary {
  const summary = emptySummary(category);
  const seen = new Set<string>();
  const matching = items
    .filter((item) => item.category_key === category)
    .filter((item) => item.filed !== true)
    .filter((item) => officeControlDeadlineBucket(item.operational_target_date, today) === wanted)
    .sort((a, b) => {
      const left = String(a.operational_target_date).slice(0, 10);
      const right = String(b.operational_target_date).slice(0, 10);
      return wanted === 'upcoming' ? left.localeCompare(right) : right.localeCompare(left);
    });
  for (const item of matching) {
    if (seen.has(item.client_id)) continue;
    seen.add(item.client_id);
    summary.client_ids.push(item.client_id);
    if (!summary.nearest_filing_due_date) {
      summary.nearest_filing_due_date = String(item.operational_target_date).slice(0, 10);
      summary.nearest_obligation_key = category;
    }
  }
  summary.clients_count = summary.client_ids.length;
  return summary;
}

export function clientAppliesToReportingEntry(
  client: DashboardReportingClientTax,
  entry: DashboardReportingCalendarEntry,
): boolean {
  const category = calendarCategory(entry);
  if (!category) return false;
  if (category === 'vat' || category === 'income_tax_deductions') {
    return clientAppliesToCategoryEntry(client, category, entry);
  }
  if (entry.obligation_key === 'vat_regular_income_tax_advances') {
    return (
      clientAppliesToCategoryEntry(client, 'vat', entry) ||
      clientAppliesToCategoryEntry(client, 'income_tax_advances', entry)
    );
  }
  return false;
}

function filingKey(clientId: string, category: DashboardReportingCategory, periodKey: string): string {
  return `${clientId}::${category}::${periodKey}`;
}

function emptySummary(category: DashboardReportingCategory): DashboardReportingCategorySummary {
  return {
    category_key: category,
    clients_count: 0,
    client_ids: [],
    nearest_filing_due_date: null,
    nearest_reporting_period_key: null,
    nearest_obligation_key: null,
  };
}

function collectCategory(
  category: DashboardReportingCategory,
  entries: DashboardReportingCalendarEntry[],
  clients: DashboardReportingClientTax[],
  filed: ReadonlySet<string>,
  duePredicate: (due: string) => boolean,
): DashboardReportingCategorySummary {
  const summary = emptySummary(category);
  const seen = new Set<string>();
  const dated = entries
    .filter((entry) => {
      const due = String(entry.filing_due_date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
      if (!duePredicate(due)) return false;
      if (category === 'vat') {
        return entry.obligation_key === 'vat_regular_income_tax_advances' || entry.obligation_key === 'vat_detailed';
      }
      if (category === 'income_tax_advances') return entry.obligation_key === 'vat_regular_income_tax_advances';
      if (category === 'income_tax_deductions') return entry.obligation_key === 'income_tax_deductions';
      return entry.obligation_key === category;
    })
    .sort((a, b) => a.filing_due_date.slice(0, 10).localeCompare(b.filing_due_date.slice(0, 10)));

  for (const entry of dated) {
    const due = entry.filing_due_date.slice(0, 10);
    for (const client of clients) {
      if (seen.has(client.client_id)) continue;
      if (!clientAppliesToCategoryEntry(client, category, entry)) continue;
      if (filed.has(filingKey(client.client_id, category, entry.reporting_period_key))) continue;
      seen.add(client.client_id);
      summary.client_ids.push(client.client_id);
      if (!summary.nearest_filing_due_date) {
        summary.nearest_filing_due_date = due;
        summary.nearest_reporting_period_key = entry.reporting_period_key;
        summary.nearest_obligation_key = entry.obligation_key;
      }
    }
  }

  summary.clients_count = summary.client_ids.length;
  return summary;
}

export function buildDashboardReportingSummaries(input: {
  entries: DashboardReportingCalendarEntry[];
  clients: DashboardReportingClientTax[];
  filings?: readonly DashboardReportingFiling[];
  officeControlDeadlines?: readonly DashboardOfficeControlDeadline[];
  today: string;
}): DashboardReportingSummaries {
  const today = input.today.slice(0, 10);
  const upcomingEnd = addIsoDateDays(today, DASHBOARD_REPORTING_UPCOMING_WINDOW_DAYS);
  const filed = new Set(
    (input.filings ?? []).map((row) => filingKey(row.client_id, row.category_key, row.reporting_period_key)),
  );
  const officeItems = input.officeControlDeadlines ?? [];
  const forWindow = (wanted: 'upcoming' | 'overdue', duePredicate: (due: string) => boolean) =>
    (category: DashboardReportingCategory) =>
      category === 'annual_report' || category === 'capital_declaration'
        ? collectOfficeControlCategory(category, officeItems, wanted, today)
        : collectCategory(category, input.entries, input.clients, filed, duePredicate);
  return {
    upcoming: DASHBOARD_UPCOMING_REPORTING_CATEGORIES.map(
      forWindow('upcoming', (due) => due >= today && upcomingEnd !== '' && due <= upcomingEnd),
    ),
    overdue: DASHBOARD_OVERDUE_REPORTING_CATEGORIES.map(forWindow('overdue', (due) => due < today)),
  };
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
