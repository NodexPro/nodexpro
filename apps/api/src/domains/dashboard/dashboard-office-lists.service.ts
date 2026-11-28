import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { resolveOrganizationClientAccessScopeFromContext } from '../client-operations/organization-client-access.js';
import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import {
  REPORTING_OBLIGATION_KEYS,
  formatFilingDueDateDisplay,
} from '../country-pack/reporting-calendar.pure.js';
import { officeCopy, parseDashboardLocale, type DashboardLocale } from './dashboard-office-copy.pure.js';
import { parseDashboardPeriodKey, resolveDashboardPeriodWindow, jerusalemDayWindow } from './dashboard-office-period.pure.js';
import { clientScopeOrFilter } from '../work-engine/work-engine-client-scope.js';
import {
  officeAttentionExcludedWorkTypesPostgrestIn,
  officeTaskAttentionOrFilter,
  officeTaskDescription,
  officeWorkTypeLabel,
  parseOfficeTaskListKey,
  sanitizeOfficeTaskSearchToken,
  type OfficeTaskListKey,
} from './dashboard-office-tasks.pure.js';
import {
  paginateNamedRows,
  parseOfficeClientListKey,
  selectOfficeClientList,
} from './dashboard-office-client-list.pure.js';
import {
  addIsoDateDays,
  buildDashboardReportingSummaries,
  dashboardReportingCategoryFromObligationType,
  DASHBOARD_REPORTING_UPCOMING_WINDOW_DAYS,
  isDashboardReportingCategory,
  isFiledReportingObligationStatus,
  projectDashboardOfficeControlDeadlines,
  type DashboardOfficeControlDeadline,
  type DashboardOfficeControlSourceRow,
  type DashboardOfficeControlSubmission,
  type DashboardReportingCalendarEntry,
  type DashboardReportingCategorySummary,
  type DashboardReportingClientTax,
  type DashboardReportingFiling,
  type DashboardReportingLiveClient,
} from './dashboard-office-reporting.pure.js';
import type {
  DashboardOfficeListQuery,
  OfficeDashboardDeadlineRow,
  OfficeDashboardListAggregate,
  OfficeDashboardSection,
} from './dashboard-office.types.js';
import type { DashboardFeeClientInput } from './dashboard-office-fees.pure.js';

const PAGE = 500;
const DASHBOARD_CALENDAR_KEYS = [...REPORTING_OBLIGATION_KEYS] as const;

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

async function fetchAllOrgRows<T>(table: string, columns: string, orgCol: string, orgId: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq(orgCol, orgId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchOrgRowsForClientIds<T>(
  table: string,
  columns: string,
  orgId: string,
  clientIds: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunkIds(clientIds, 80)) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq('organization_id', orgId)
      .in('client_id', chunk);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function clientNamesByIds(orgId: string, clientIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(clientIds.filter(Boolean))];
  for (const chunk of chunkIds(unique, 80)) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      map.set(String(row.id), row.display_name ? String(row.display_name) : String(row.id));
    }
  }
  return map;
}

async function authorizedClients(ctx: RequestContext): Promise<DashboardFeeClientInput[]> {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
  const allowIds = accessScope.authorized_client_ids;
  const authorizedSet = allowIds ? new Set(allowIds) : null;
  const clientRows = await fetchAllOrgRows<Record<string, unknown>>(
    'clients',
    'id, display_name, status, is_archived, created_at, ended_at',
    'organization_id',
    orgId,
  );
  return clientRows
    .map((r) => ({
      id: String(r.id),
      display_name: r.display_name != null ? String(r.display_name) : '',
      status: r.status != null ? String(r.status) : null,
      is_archived: asBool(r.is_archived),
      created_at: r.created_at != null ? String(r.created_at) : null,
      ended_at: r.ended_at != null ? String(r.ended_at) : null,
    }))
    .filter((c) => (authorizedSet ? authorizedSet.has(c.id) : true));
}

function formatDisplayDate(iso: string | null, locale: DashboardLocale): string {
  if (!iso) return '—';
  const day = iso.slice(0, 10);
  if (locale === 'he') return formatFilingDueDateDisplay(day) ?? day;
  return day;
}

function statusLabel(status: string | null, archived: boolean, copy: ReturnType<typeof officeCopy>): string {
  if (archived) return copy.status_archived;
  if (status === 'active') return copy.status_active;
  if (status === 'pending') return copy.status_pending;
  if (status === 'inactive') return copy.status_inactive;
  return status || '—';
}

function emptyList(
  title: string,
  empty: string,
  listKey: string,
  copy: ReturnType<typeof officeCopy>,
  columns: OfficeDashboardListAggregate['columns'],
): OfficeDashboardListAggregate {
  return {
    title_he: title,
    total_he: copy.list_total_clients(0),
    search_placeholder_he: copy.list_search,
    empty_he: empty,
    page_label_he: copy.list_page(1, 1, 0),
    open_label_he: copy.list_open_client,
    columns,
    rows: [],
    pagination: { page: 1, page_size: 25, total: 0, total_pages: 1, q: '', list_key: listKey },
  };
}

function deadlineColumns(copy: ReturnType<typeof officeCopy>): OfficeDashboardListAggregate['columns'] {
  return [
    { key: 'type', label_he: copy.reporting_col_type },
    { key: 'clients', label_he: copy.reporting_col_clients },
    { key: 'due', label_he: copy.reporting_col_due },
  ];
}

function reportingCategoryLabel(key: string, copy: ReturnType<typeof officeCopy>): string {
  if (key === 'vat') return copy.reporting_type_vat;
  if (key === 'income_tax_advances') return copy.reporting_type_income_tax_advances;
  if (key === 'income_tax_deductions') return copy.reporting_type_deductions;
  if (key === 'annual_report') return copy.reporting_type_annual;
  if (key === 'capital_declaration') return copy.reporting_type_capital;
  return key;
}

function emptyDeadlineGroups(copy: ReturnType<typeof officeCopy>): OfficeDashboardSection['deadlines'] {
  return {
    title_he: copy.deadlines_title,
    overdue_title_he: copy.deadlines_overdue_title,
    status: 'ready',
    unavailable_he: copy.deadlines_unavailable,
    columns: deadlineColumns(copy),
    rows: [],
    groups: {
      upcoming: { title_he: copy.deadlines_title, rows: [] },
      overdue: { title_he: copy.deadlines_overdue_title, rows: [] },
    },
  };
}

function mapTaxRowToReportingClient(
  row: Record<string, unknown>,
  client: { id: string; display_name: string | null; is_archived: boolean },
): DashboardReportingClientTax | null {
  if (client.is_archived) return null;
  return {
    client_id: client.id,
    display_name: client.display_name ?? '',
    vat_type: row.vat_type != null ? String(row.vat_type) : null,
    vat_due_type: row.vat_due_type != null ? String(row.vat_due_type) : null,
    vat_frequency: row.vat_frequency != null ? String(row.vat_frequency) : null,
    income_tax_advance_enabled: asBool(row.income_tax_advance_enabled),
    income_tax_advance_frequency:
      row.income_tax_advance_frequency != null ? String(row.income_tax_advance_frequency) : null,
    income_tax_deductions_enabled: asBool(row.income_tax_deductions_enabled),
    income_tax_deductions_frequency:
      row.income_tax_deductions_frequency != null ? String(row.income_tax_deductions_frequency) : null,
  };
}

async function loadOfficeControlDeadlines(
  orgId: string,
  liveClientIds: string[],
): Promise<DashboardOfficeControlDeadline[]> {
  if (liveClientIds.length === 0) return [];
  const instances: DashboardOfficeControlSourceRow[] = [];
  const submissions: DashboardOfficeControlSubmission[] = [];
  for (const chunk of chunkIds(liveClientIds, 80)) {
    const [annualRes, capitalRes, submissionRes] = await Promise.all([
      supabaseAdmin
        .from('client_annual_report_year_instances')
        .select('id, client_id, tax_year, operational_target_date, status')
        .eq('organization_id', orgId)
        .in('client_id', chunk)
        .in('status', ['open', 'completed']),
      supabaseAdmin
        .from('client_capital_declaration_instances')
        .select('id, client_id, tax_year, operational_target_date, status')
        .eq('organization_id', orgId)
        .in('client_id', chunk)
        .in('status', ['open', 'completed']),
      supabaseAdmin
        .from('client_annual_submission_rows')
        .select('client_id, tax_year, submitted_on, tab_scope, capital_declaration_instance_id')
        .eq('organization_id', orgId)
        .in('client_id', chunk)
        .in('tab_scope', ['annual_report', 'capital_declaration']),
    ]);
    if (annualRes.error) throw new Error(annualRes.error.message);
    if (capitalRes.error) throw new Error(capitalRes.error.message);
    let submissionRows = submissionRes.data as Array<Record<string, unknown>> | null;
    let submissionError = submissionRes.error;
    if (submissionError && /capital_declaration_instance_id/i.test(submissionError.message ?? '')) {
      const retry = await supabaseAdmin
        .from('client_annual_submission_rows')
        .select('client_id, tax_year, submitted_on, tab_scope')
        .eq('organization_id', orgId)
        .in('client_id', chunk)
        .in('tab_scope', ['annual_report', 'capital_declaration']);
      submissionRows = retry.data as Array<Record<string, unknown>> | null;
      submissionError = retry.error;
    }
    if (submissionError) throw new Error(submissionError.message);
    for (const row of (annualRes.data ?? []) as Array<Record<string, unknown>>) {
      instances.push({
        client_id: String(row.client_id),
        category_key: 'annual_report',
        operational_target_date: row.operational_target_date != null ? String(row.operational_target_date) : null,
        status: row.status != null ? String(row.status) : null,
        tax_year: row.tax_year != null ? Number(row.tax_year) : null,
        instance_id: row.id != null ? String(row.id) : null,
      });
    }
    for (const row of (capitalRes.data ?? []) as Array<Record<string, unknown>>) {
      instances.push({
        client_id: String(row.client_id),
        category_key: 'capital_declaration',
        operational_target_date: row.operational_target_date != null ? String(row.operational_target_date) : null,
        status: row.status != null ? String(row.status) : null,
        tax_year: row.tax_year != null ? Number(row.tax_year) : null,
        instance_id: row.id != null ? String(row.id) : null,
      });
    }
    for (const row of submissionRows ?? []) {
      const scope = String(row.tab_scope ?? '');
      if (scope !== 'annual_report' && scope !== 'capital_declaration') continue;
      submissions.push({
        client_id: String(row.client_id),
        tab_scope: scope,
        tax_year: row.tax_year != null ? Number(row.tax_year) : null,
        instance_id:
          row.capital_declaration_instance_id != null ? String(row.capital_declaration_instance_id) : null,
        submitted_on: row.submitted_on != null ? String(row.submitted_on) : null,
      });
    }
  }
  return projectDashboardOfficeControlDeadlines({ instances, submissions });
}

async function loadDashboardReportingInputs(
  ctx: RequestContext,
  today: string,
): Promise<{
  entries: DashboardReportingCalendarEntry[];
  taxClients: DashboardReportingClientTax[];
  filings: DashboardReportingFiling[];
  liveClients: DashboardReportingLiveClient[];
  officeControlDeadlines: DashboardOfficeControlDeadline[];
} | null> {
  const orgId = ctx.organizationId;
  if (!orgId) return null;
  const empty = {
    entries: [] as DashboardReportingCalendarEntry[],
    taxClients: [] as DashboardReportingClientTax[],
    filings: [] as DashboardReportingFiling[],
    liveClients: [] as DashboardReportingLiveClient[],
    officeControlDeadlines: [] as DashboardOfficeControlDeadline[],
  };
  const clients = await authorizedClients(ctx);
  const live = clients.filter((c) => !c.is_archived);
  const liveClients: DashboardReportingLiveClient[] = live.map((c) => ({
    client_id: c.id,
    display_name: c.display_name ?? '',
  }));
  if (live.length === 0) return empty;
  const liveIds = live.map((c) => c.id);
  const officeControlDeadlines = await loadOfficeControlDeadlines(orgId, liveIds);

  const ruleset = await resolveOrganizationActiveRuleset(orgId, today);
  if (!ruleset.country_code || !ruleset.ruleset_id) {
    return { ...empty, liveClients, officeControlDeadlines };
  }
  const from = addIsoDateDays(today, -400);
  const to = addIsoDateDays(today, DASHBOARD_REPORTING_UPCOMING_WINDOW_DAYS + 10);
  let calendarQuery = supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select('obligation_key, reporting_period_key, filing_due_date, country_pack_ruleset_id')
    .eq('country_code', ruleset.country_code)
    .eq('status', 'active')
    .in('obligation_key', [...DASHBOARD_CALENDAR_KEYS])
    .gte('filing_due_date', from || '2000-01-01')
    .lte('filing_due_date', to || '2100-12-31')
    .order('filing_due_date', { ascending: true })
    .limit(400);
  calendarQuery = calendarQuery.or(
    `country_pack_ruleset_id.eq.${ruleset.ruleset_id},country_pack_ruleset_id.is.null`,
  );
  const { data: calendarRows, error: calendarError } = await calendarQuery;
  if (calendarError) throw new Error(calendarError.message);
  const entries: DashboardReportingCalendarEntry[] = (calendarRows ?? []).map((r) => ({
    obligation_key: String(r.obligation_key),
    reporting_period_key: String(r.reporting_period_key),
    filing_due_date: String(r.filing_due_date).slice(0, 10),
  }));

  const taxRows = await fetchOrgRowsForClientIds<Record<string, unknown>>(
    'client_tax_settings',
    'client_id, vat_type, vat_due_type, vat_frequency, income_tax_advance_enabled, income_tax_advance_frequency, income_tax_deductions_enabled, income_tax_deductions_frequency',
    orgId,
    liveIds,
  );
  const clientById = new Map(live.map((c) => [c.id, c]));
  const taxClients = taxRows
    .map((r) => {
      const client = clientById.get(String(r.client_id));
      if (!client) return null;
      return mapTaxRowToReportingClient(r, client);
    })
    .filter((c): c is DashboardReportingClientTax => c != null);

  const filings: DashboardReportingFiling[] = [];
  for (const chunk of chunkIds(liveIds, 80)) {
    const { data, error } = await supabaseAdmin
      .from('client_obligations')
      .select('client_id, obligation_type, period_key, last_reported_at, status')
      .eq('organization_id', orgId)
      .in('client_id', chunk)
      .in('obligation_type', ['vat_report', 'income_tax_advance', 'income_tax_deductions']);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (
        !isFiledReportingObligationStatus({
          last_reported_at: row.last_reported_at != null ? String(row.last_reported_at) : null,
          status: row.status != null ? String(row.status) : null,
        })
      ) {
        continue;
      }
      const category = dashboardReportingCategoryFromObligationType(
        row.obligation_type != null ? String(row.obligation_type) : null,
      );
      const period = String(row.period_key ?? '').trim();
      if (!category || !period) continue;
      filings.push({
        client_id: String(row.client_id),
        category_key: category,
        reporting_period_key: period,
      });
    }
  }
  return { entries, taxClients, filings, liveClients, officeControlDeadlines };
}

function deadlineRowFromSummary(
  summary: DashboardReportingCategorySummary,
  bucket: 'upcoming' | 'overdue',
  copy: ReturnType<typeof officeCopy>,
  locale: DashboardLocale,
): OfficeDashboardDeadlineRow {
  return {
    type_he: reportingCategoryLabel(summary.category_key, copy),
    due_date_he: formatDisplayDate(summary.nearest_filing_due_date, locale),
    clients_count: summary.clients_count,
    href: null,
    obligation_key: summary.nearest_obligation_key,
    filing_due_date: summary.nearest_filing_due_date,
    reporting_period_key: summary.nearest_reporting_period_key,
    category_key: summary.category_key,
    bucket,
    status_he: null,
    action_key: summary.clients_count > 0 ? 'open_reporting_clients' : null,
    severity_he: null,
  };
}

export async function loadOfficeUpcomingDeadlines(
  ctx: RequestContext,
  locale: DashboardLocale,
  today: string,
): Promise<OfficeDashboardSection['deadlines']> {
  const copy = officeCopy(locale);
  const empty = emptyDeadlineGroups(copy);
  if (!ctx.organizationId) return empty;
  try {
    const loaded = await loadDashboardReportingInputs(ctx, today);
    if (!loaded) return empty;
    const summaries = buildDashboardReportingSummaries({
      entries: loaded.entries,
      clients: loaded.taxClients,
      filings: loaded.filings,
      officeControlDeadlines: loaded.officeControlDeadlines,
      today,
    });
    const upcomingRows = summaries.upcoming.map((row) => deadlineRowFromSummary(row, 'upcoming', copy, locale));
    const overdueRows = summaries.overdue.map((row) => deadlineRowFromSummary(row, 'overdue', copy, locale));
    return {
      title_he: copy.deadlines_title,
      overdue_title_he: copy.deadlines_overdue_title,
      status: 'ready',
      unavailable_he: copy.deadlines_unavailable,
      columns: deadlineColumns(copy),
      rows: upcomingRows,
      groups: {
        upcoming: { title_he: copy.deadlines_title, rows: upcomingRows },
        overdue: { title_he: copy.deadlines_overdue_title, rows: overdueRows },
      },
    };
  } catch {
    return empty;
  }
}

export async function getOfficeClientListAggregate(
  ctx: RequestContext,
  query?: DashboardOfficeListQuery,
): Promise<OfficeDashboardListAggregate> {
  const orgId = ctx.organizationId;
  const membership = ctx.membership;
  if (!orgId || !membership) throw forbidden('Active organization required');
  const locale = parseDashboardLocale(query?.locale);
  const copy = officeCopy(locale);
  const listKey = parseOfficeClientListKey(query?.list_key);
  const columns = [
    { key: 'name', label_he: copy.col_name },
    { key: 'status', label_he: copy.reporting_col_status },
    { key: 'date', label_he: copy.col_date },
  ];
  if (!listKey) return emptyList(copy.list_active_title, copy.list_empty, '', copy, columns);
  const now = new Date();
  const periodKey = parseDashboardPeriodKey(query?.period);
  const window = resolveDashboardPeriodWindow(now, periodKey, locale);
  const clients = await authorizedClients(ctx);
  const selected = selectOfficeClientList(clients, listKey, window.start_date, window.end_date).map((c) => ({
    ...c,
    display_name: c.display_name || c.id,
  }));
  const paged = paginateNamedRows(selected, query ?? {});
  const title =
    listKey === 'active'
      ? copy.list_active_title
      : listKey === 'new_in_period'
        ? copy.list_new_title
        : listKey === 'departed'
          ? copy.list_departed_title
          : copy.list_status_title(
              listKey === 'status:archived'
                ? copy.status_archived
                : listKey === 'status:pending'
                  ? copy.status_pending
                  : listKey === 'status:inactive'
                    ? copy.status_inactive
                    : copy.status_active,
            );
  return {
    title_he: title,
    total_he: copy.list_total_clients(paged.total),
    search_placeholder_he: copy.list_search,
    empty_he: copy.list_empty,
    page_label_he: copy.list_page(paged.page, paged.total_pages, paged.total),
    open_label_he: copy.list_open_client,
    columns,
    rows: paged.rows.map((c) => ({
      id: c.id,
      href: `/m/client-operations/clients/${c.id}`,
      open_label_he: copy.list_open_client,
      cells: {
        name: c.display_name,
        status: statusLabel(c.status, c.is_archived, copy),
        date:
          listKey === 'departed'
            ? `${copy.date_ended} ${formatDisplayDate(c.ended_at, locale)}`
            : `${copy.date_created} ${formatDisplayDate(c.created_at, locale)}`,
      },
    })),
    pagination: {
      page: paged.page,
      page_size: paged.page_size,
      total: paged.total,
      total_pages: paged.total_pages,
      q: paged.q,
      list_key: listKey,
    },
  };
}

function taskStateLabel(state: string, copy: ReturnType<typeof officeCopy>): string {
  if (state === 'overdue') return copy.task_state_overdue;
  if (state === 'review_pending') return copy.task_state_review_pending;
  if (state === 'assigned') return copy.task_state_assigned;
  if (state === 'waiting_client') return copy.task_state_waiting_client;
  if (state === 'waiting_human') return copy.task_state_waiting_human;
  if (state === 'new') return copy.task_state_new;
  if (state === 'done') return copy.task_state_done;
  if (state === 'escalated') return copy.task_state_escalated;
  if (state === 'approved') return copy.task_state_approved;
  if (state === 'rejected') return copy.task_state_rejected;
  if (state === 'client_replied') return copy.task_state_client_replied;
  return state;
}

type OfficeWorkItemQuery = {
  eq: (col: string, val: string) => OfficeWorkItemQuery;
  gte: (col: string, val: string) => OfficeWorkItemQuery;
  lt: (col: string, val: string) => OfficeWorkItemQuery;
  not: (col: string, op: string, val: string) => OfficeWorkItemQuery;
  or: (filters: string) => OfficeWorkItemQuery;
  order: (col: string, opts: { ascending: boolean; nullsFirst: boolean }) => OfficeWorkItemQuery;
  range: (from: number, to: number) => OfficeWorkItemQuery;
  then: (
    onfulfilled?: (value: {
      data: unknown;
      error: { message: string } | null;
      count: number | null;
    }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

function applyOfficeTaskAttentionBase(
  query: OfficeWorkItemQuery,
  params: {
    listKey: OfficeTaskListKey;
    today: { start_iso: string; end_exclusive_iso: string };
    allowIds: string[] | null;
    searchOr: string | null;
  },
): OfficeWorkItemQuery {
  const spec = officeTaskAttentionOrFilter(params.listKey, params.today);
  let next = query;
  if (spec.workStateEq) next = next.eq('work_state', spec.workStateEq);
  if (spec.dueGte) next = next.gte('due_at', spec.dueGte);
  if (spec.dueLt) next = next.lt('due_at', spec.dueLt);
  if (spec.excludeTerminal) next = next.not('work_state', 'in', '(done,archived)');
  next = next.not('work_type', 'in', officeAttentionExcludedWorkTypesPostgrestIn());
  const ors = [
    spec.or,
    params.searchOr,
    params.allowIds ? clientScopeOrFilter(params.allowIds) : null,
  ].filter((clause): clause is string => Boolean(clause));
  if (ors.length === 1) return next.or(ors[0]);
  if (ors.length > 1) return next.or(`and(${ors.map((clause) => `or(${clause})`).join(',')})`);
  return next;
}

function asWorkItemQuery(query: unknown): OfficeWorkItemQuery {
  return query as OfficeWorkItemQuery;
}

function parseOfficeListPage(query: DashboardOfficeListQuery | undefined): { page: number; page_size: number } {
  const page_sizeRaw = Math.floor(Number(query?.page_size));
  const page_size = page_sizeRaw === 50 ? 50 : 25;
  const pageRaw = Math.floor(Number(query?.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { page, page_size };
}

export async function countOfficeAttentionWorkItems(params: {
  orgId: string;
  allowIds: string[] | null;
  listKey: OfficeTaskListKey;
  today: { start_iso: string; end_exclusive_iso: string };
}): Promise<number> {
  if (params.allowIds && params.allowIds.length === 0) return 0;
  const q = applyOfficeTaskAttentionBase(
    asWorkItemQuery(
      supabaseAdmin.from('work_items').select('id', { count: 'exact', head: true }).eq('org_id', params.orgId),
    ),
    { listKey: params.listKey, today: params.today, allowIds: params.allowIds, searchOr: null },
  );
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getOfficeTaskListAggregate(
  ctx: RequestContext,
  query?: DashboardOfficeListQuery,
): Promise<OfficeDashboardListAggregate> {
  const orgId = ctx.organizationId;
  const membership = ctx.membership;
  if (!orgId || !membership) throw forbidden('Active organization required');
  const locale = parseDashboardLocale(query?.locale);
  const copy = officeCopy(locale);
  const listKey = parseOfficeTaskListKey(query?.list_key);
  const columns = [
    { key: 'title', label_he: copy.col_title },
    { key: 'name', label_he: copy.col_name },
    { key: 'due', label_he: copy.col_due },
    { key: 'status', label_he: copy.col_task_status },
  ];
  const title =
    listKey === 'overdue'
      ? copy.attention_overdue
      : listKey === 'due_today'
        ? copy.attention_due_today
        : listKey === 'review_pending'
          ? copy.attention_approval
          : copy.attention_title;
  const emptyTaskList = (key: string): OfficeDashboardListAggregate => ({
    title_he: title,
    total_he: copy.list_total_tasks(0),
    search_placeholder_he: copy.list_search_tasks,
    empty_he: copy.list_empty,
    page_label_he: copy.list_page(1, 1, 0),
    open_label_he: copy.list_open_task,
    back_label_he: copy.task_back,
    description_label_he: copy.task_description,
    columns,
    rows: [],
    pagination: { page: 1, page_size: 25, total: 0, total_pages: 1, q: '', list_key: key },
  });
  if (!listKey) return emptyTaskList(String(query?.list_key ?? '').trim());

  const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
  const allowIds = accessScope.authorized_client_ids;
  if (allowIds && allowIds.length === 0) return emptyTaskList(listKey);

  const today = jerusalemDayWindow(new Date());
  const rawQ = String(query?.q ?? '').trim();
  const token = sanitizeOfficeTaskSearchToken(rawQ);
  const { page: requestedPage, page_size } = parseOfficeListPage(query);

  type WorkItemRow = {
    id: string;
    client_id: string | null;
    module_key: string | null;
    work_type: string | null;
    period_key: string | null;
    work_state: string;
    sla_status: string | null;
    due_at: string | null;
  };

  let matchingClientIds: string[] = [];
  if (token) {
    let nameQuery = supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('display_name', `%${token}%`)
      .limit(80);
    if (allowIds) nameQuery = nameQuery.in('id', allowIds);
    const { data: nameRows, error: nameError } = await nameQuery;
    if (nameError) throw new Error(nameError.message);
    matchingClientIds = ((nameRows ?? []) as Array<{ id: string }>).map((row) => String(row.id));
  }

  const searchParts = token
    ? [
        `work_type.ilike.%${token}%`,
        `module_key.ilike.%${token}%`,
        ...(matchingClientIds.length > 0 ? [`client_id.in.(${matchingClientIds.join(',')})`] : []),
      ]
    : [];
  const searchOr = searchParts.length > 0 ? searchParts.join(',') : null;
  const scopedAttention = {
    listKey,
    today,
    allowIds,
    searchOr,
  };

  const countQuery = applyOfficeTaskAttentionBase(
    asWorkItemQuery(
      supabaseAdmin.from('work_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    ),
    scopedAttention,
  );
  const { count, error: countError } = await countQuery;
  if (countError) throw new Error(countError.message);
  const total = count ?? 0;
  const total_pages = Math.max(1, Math.ceil(total / page_size) || 1);
  const page = Math.min(requestedPage, total_pages);
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  const dataQuery = applyOfficeTaskAttentionBase(
    asWorkItemQuery(
      supabaseAdmin
        .from('work_items')
        .select('id, client_id, module_key, work_type, period_key, work_state, sla_status, due_at')
        .eq('org_id', orgId),
    ),
    scopedAttention,
  );
  const { data, error } = await dataQuery
    .order('due_at', { ascending: true, nullsFirst: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as WorkItemRow[];
  const nameById = await clientNamesByIds(
    orgId,
    items.map((item) => item.client_id).filter((id): id is string => Boolean(id)),
  );

  return {
    title_he: title,
    total_he: copy.list_total_tasks(total),
    search_placeholder_he: copy.list_search_tasks,
    empty_he: copy.list_empty,
    page_label_he: copy.list_page(page, total_pages, total),
    open_label_he: copy.list_open_task,
    back_label_he: copy.task_back,
    description_label_he: copy.task_description,
    columns,
    rows: items.map((item) => {
      const clientName = item.client_id ? nameById.get(item.client_id) ?? item.client_id : '—';
      const titleText = officeWorkTypeLabel(item.work_type, locale) || copy.col_title;
      const description = officeTaskDescription({
        moduleKey: item.module_key,
        periodKey: item.period_key,
        locale,
      });
      const due = formatDisplayDate(item.due_at, locale);
      const status = taskStateLabel(item.work_state, copy);
      return {
        id: item.id,
        href: null,
        open_label_he: copy.list_open_task,
        cells: {
          title: titleText,
          name: clientName,
          due,
          status,
        },
        detail: {
          title: titleText,
          client: clientName,
          description: description || '—',
          due,
          status,
        },
      };
    }),
    pagination: {
      page,
      page_size,
      total,
      total_pages,
      q: rawQ,
      list_key: listKey,
    },
  };
}

export async function getOfficeReportingClientsAggregate(
  ctx: RequestContext,
  query?: DashboardOfficeListQuery,
): Promise<OfficeDashboardListAggregate> {
  const orgId = ctx.organizationId;
  const membership = ctx.membership;
  if (!orgId || !membership) throw forbidden('Active organization required');
  const locale = parseDashboardLocale(query?.locale);
  const copy = officeCopy(locale);
  const columns = [
    { key: 'name', label_he: copy.col_name },
    { key: 'status', label_he: copy.reporting_col_status },
  ];
  const categoryKey = String(query?.category_key ?? '').trim();
  const bucket = String(query?.bucket ?? '').trim() === 'overdue' ? 'overdue' : 'upcoming';
  if (!isDashboardReportingCategory(categoryKey)) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, categoryKey, copy, columns);
  }
  const today = jerusalemDayWindow(new Date()).date;
  const loaded = await loadDashboardReportingInputs(ctx, today);
  if (!loaded) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, categoryKey, copy, columns);
  }
  const summaries = buildDashboardReportingSummaries({
    entries: loaded.entries,
    clients: loaded.taxClients,
    filings: loaded.filings,
    officeControlDeadlines: loaded.officeControlDeadlines,
    today,
  });
  const summary = (bucket === 'overdue' ? summaries.overdue : summaries.upcoming).find(
    (row) => row.category_key === categoryKey,
  );
  const allowed = new Set(summary?.client_ids ?? []);
  const officeControl = categoryKey === 'annual_report' || categoryKey === 'capital_declaration';
  const nameById = new Map(loaded.liveClients.map((client) => [client.client_id, client.display_name]));
  const applicable = officeControl
    ? [...allowed].map((client_id) => ({
        client_id,
        display_name: nameById.get(client_id) || client_id,
      }))
    : loaded.taxClients.filter((client) => allowed.has(client.client_id));
  const paged = paginateNamedRows(
    applicable.map((c) => ({ ...c, id: c.client_id })),
    query ?? {},
  );
  return {
    title_he: `${copy.reporting_clients_title} · ${reportingCategoryLabel(categoryKey, copy)}`,
    total_he: copy.list_total_clients(paged.total),
    search_placeholder_he: copy.list_search,
    empty_he: copy.reporting_clients_empty,
    page_label_he: copy.list_page(paged.page, paged.total_pages, paged.total),
    open_label_he: copy.list_open_client,
    columns,
    rows: paged.rows.map((c) => ({
      id: c.client_id,
      href: `/m/client-operations/clients/${c.client_id}`,
      open_label_he: copy.list_open_client,
      cells: {
        name: c.display_name,
        status: officeControl ? copy.reporting_office_control : copy.reporting_applicability,
      },
    })),
    pagination: {
      page: paged.page,
      page_size: paged.page_size,
      total: paged.total,
      total_pages: paged.total_pages,
      q: paged.q,
      list_key: categoryKey,
    },
  };
}
