import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { resolveOrganizationClientAccessScopeFromContext } from '../client-operations/organization-client-access.js';
import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import {
  REPORTING_OBLIGATION_KEYS,
  formatFilingDueDateDisplay,
  isReportingObligationKey,
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
  clientAppliesToReportingEntry,
  groupUpcomingReportingObligations,
  isActiveUpcomingReportingEntry,
  reportingTimingStatus,
  type DashboardReportingCalendarEntry,
  type DashboardReportingClientTax,
} from './dashboard-office-reporting.pure.js';
import type {
  DashboardOfficeListQuery,
  OfficeDashboardDeadlineRow,
  OfficeDashboardListAggregate,
  OfficeDashboardSection,
} from './dashboard-office.types.js';
import type { DashboardFeeClientInput } from './dashboard-office-fees.pure.js';

const PAGE = 500;
const UPCOMING_REPORT_LIMIT = 5;

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
    { key: 'due', label_he: copy.reporting_col_due },
    { key: 'type', label_he: copy.reporting_col_type },
    { key: 'clients', label_he: copy.reporting_col_clients },
    { key: 'status', label_he: copy.reporting_col_timing },
  ];
}

function reportingTypeLabel(key: string, copy: ReturnType<typeof officeCopy>): string {
  if (key === 'vat_regular_income_tax_advances') return copy.reporting_type_vat_regular;
  if (key === 'income_tax_deductions') return copy.reporting_type_deductions;
  if (key === 'vat_detailed') return copy.reporting_type_vat_detailed;
  return key;
}

function timingLabel(timing: ReturnType<typeof reportingTimingStatus>, copy: ReturnType<typeof officeCopy>): string {
  if (timing === 'due_today') return copy.reporting_timing_due_today;
  if (timing === 'overdue') return copy.reporting_timing_overdue;
  return copy.reporting_timing_upcoming;
}

export async function loadOfficeUpcomingDeadlines(
  ctx: RequestContext,
  locale: DashboardLocale,
  today: string,
): Promise<OfficeDashboardSection['deadlines']> {
  const copy = officeCopy(locale);
  const unavailable: OfficeDashboardSection['deadlines'] = {
    title_he: copy.deadlines_title,
    status: 'coming_soon',
    unavailable_he: copy.deadlines_unavailable,
    columns: deadlineColumns(copy),
    rows: [],
  };
  const orgId = ctx.organizationId;
  if (!orgId) return unavailable;
  try {
    const ruleset = await resolveOrganizationActiveRuleset(orgId, today);
    if (!ruleset.country_code || !ruleset.ruleset_id) return unavailable;
    let calendarQuery = supabaseAdmin
      .from('country_reporting_calendar_entries')
      .select('obligation_key, reporting_period_key, filing_due_date, country_pack_ruleset_id')
      .eq('country_code', ruleset.country_code)
      .eq('status', 'active')
      .in('obligation_key', [...REPORTING_OBLIGATION_KEYS])
      .gte('filing_due_date', today)
      .order('filing_due_date', { ascending: true })
      .limit(80);
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
    if (entries.length === 0) return unavailable;

    const clients = await authorizedClients(ctx);
    if (clients.length === 0) return unavailable;
    const taxRows = await fetchOrgRowsForClientIds<Record<string, unknown>>(
      'client_tax_settings',
      'client_id, vat_type, vat_due_type, vat_frequency, income_tax_deductions_enabled, income_tax_deductions_frequency',
      orgId,
      clients.map((c) => c.id),
    );
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const taxClients: DashboardReportingClientTax[] = taxRows
      .map((r) => {
        const id = String(r.client_id);
        const client = clientById.get(id);
        if (!client || client.is_archived) return null;
        return {
          client_id: id,
          display_name: client.display_name ?? '',
          vat_type: r.vat_type != null ? String(r.vat_type) : null,
          vat_due_type: r.vat_due_type != null ? String(r.vat_due_type) : null,
          vat_frequency: r.vat_frequency != null ? String(r.vat_frequency) : null,
          income_tax_deductions_enabled: asBool(r.income_tax_deductions_enabled),
          income_tax_deductions_frequency:
            r.income_tax_deductions_frequency != null ? String(r.income_tax_deductions_frequency) : null,
        };
      })
      .filter((c): c is DashboardReportingClientTax => c != null);

    const groups = groupUpcomingReportingObligations({
      entries,
      clients: taxClients,
      today,
      limit: UPCOMING_REPORT_LIMIT,
    });
    if (groups.length === 0) return unavailable;

    const rows: OfficeDashboardDeadlineRow[] = groups.map((g) => {
      const timing = reportingTimingStatus(g.filing_due_date, today);
      return {
        type_he: reportingTypeLabel(g.obligation_key, copy),
        due_date_he: formatDisplayDate(g.filing_due_date, locale),
        clients_count: g.client_ids.length,
        href: null,
        obligation_key: g.obligation_key,
        filing_due_date: g.filing_due_date,
        reporting_period_key: g.reporting_period_key,
        status_he: timingLabel(timing, copy),
        action_key: 'open_reporting_clients',
        severity_he: null,
      };
    });
    return {
      title_he: copy.deadlines_title,
      status: 'ready',
      unavailable_he: copy.deadlines_unavailable,
      columns: deadlineColumns(copy),
      rows,
    };
  } catch {
    return unavailable;
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
  const obligationKey = String(query?.obligation_key ?? '').trim();
  const filingDueDate = String(query?.filing_due_date ?? '').slice(0, 10);
  const periodKey = String(query?.reporting_period_key ?? '').trim();
  if (!isReportingObligationKey(obligationKey) || !filingDueDate || !periodKey) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, obligationKey, copy, columns);
  }
  const today = jerusalemDayWindow(new Date()).date;
  const ruleset = await resolveOrganizationActiveRuleset(orgId, today);
  if (!ruleset.country_code || !ruleset.ruleset_id) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, obligationKey, copy, columns);
  }
  let calendarQuery = supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select('obligation_key, reporting_period_key, filing_due_date, status, country_pack_ruleset_id')
    .eq('country_code', ruleset.country_code)
    .eq('status', 'active')
    .eq('obligation_key', obligationKey)
    .eq('reporting_period_key', periodKey)
    .eq('filing_due_date', filingDueDate)
    .limit(5);
  calendarQuery = calendarQuery.or(
    `country_pack_ruleset_id.eq.${ruleset.ruleset_id},country_pack_ruleset_id.is.null`,
  );
  const { data: calendarRows, error: calendarError } = await calendarQuery;
  if (calendarError) throw new Error(calendarError.message);
  const calendarHit = ((calendarRows ?? []) as Array<{
    obligation_key: string;
    reporting_period_key: string;
    filing_due_date: string;
    status: string;
  }>).find((row) =>
    isActiveUpcomingReportingEntry(row, {
      obligation_key: obligationKey,
      reporting_period_key: periodKey,
      filing_due_date: filingDueDate,
    }, today),
  );
  if (!calendarHit) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, obligationKey, copy, columns);
  }
  const clients = await authorizedClients(ctx);
  if (clients.length === 0) {
    return emptyList(copy.reporting_clients_title, copy.reporting_clients_empty, obligationKey, copy, columns);
  }
  const taxRows = await fetchOrgRowsForClientIds<Record<string, unknown>>(
    'client_tax_settings',
    'client_id, vat_type, vat_due_type, vat_frequency, income_tax_deductions_enabled, income_tax_deductions_frequency',
    orgId,
    clients.map((c) => c.id),
  );
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const applicable = taxRows
    .map((r) => {
      const id = String(r.client_id);
      const client = clientById.get(id);
      if (!client || client.is_archived) return null;
      const tax: DashboardReportingClientTax = {
        client_id: id,
        display_name: client.display_name || id,
        vat_type: r.vat_type != null ? String(r.vat_type) : null,
        vat_due_type: r.vat_due_type != null ? String(r.vat_due_type) : null,
        vat_frequency: r.vat_frequency != null ? String(r.vat_frequency) : null,
        income_tax_deductions_enabled: asBool(r.income_tax_deductions_enabled),
        income_tax_deductions_frequency:
          r.income_tax_deductions_frequency != null ? String(r.income_tax_deductions_frequency) : null,
      };
      if (
        !clientAppliesToReportingEntry(tax, {
          obligation_key: obligationKey,
          reporting_period_key: periodKey,
          filing_due_date: filingDueDate,
        })
      ) {
        return null;
      }
      return tax;
    })
    .filter((c): c is DashboardReportingClientTax => c != null);
  const paged = paginateNamedRows(
    applicable.map((c) => ({ ...c, id: c.client_id })),
    query ?? {},
  );
  return {
    title_he: `${copy.reporting_clients_title} · ${reportingTypeLabel(obligationKey, copy)}`,
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
        status: copy.reporting_applicability,
      },
    })),
    pagination: {
      page: paged.page,
      page_size: paged.page_size,
      total: paged.total,
      total_pages: paged.total_pages,
      q: paged.q,
      list_key: obligationKey,
    },
  };
}
