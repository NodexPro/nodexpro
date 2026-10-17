/**
 * Office dashboard projection: expected שכ״ט, missing fees, Work Engine attention,
 * client status, and period KPIs. Composes existing domain tables; does not persist
 * a second fee ledger.
 */
import { supabaseAdmin } from '../../../db/client.js';
import { forbidden } from '../../../shared/errors.js';
import type { RequestContext } from '../../../shared/context.js';
import type { DashboardOverviewPartial } from '../dashboard-overview.types.js';
import type { DashboardProvider } from '../dashboard-provider.js';
import { resolveOrganizationClientAccessScopeFromContext } from '../../client-operations/organization-client-access.js';
import { roleHasOfficeClientAccess } from '../../client-operations/organization-client-access.pure.js';
import { resolveCountryContext } from '../../country-pack/country-pack-resolver.service.js';
import { resolveLegalValue } from '../../country-pack/legal-value.service.js';
import {
  dashboardPeriodOptions,
  isoToJerusalemDate,
  jerusalemDayWindow,
  lastNJerusalemMonths,
  parseDashboardPeriodKey,
  resolveDashboardPeriodWindow,
  type DashboardPeriodKey,
} from '../dashboard-office-period.pure.js';
import { officeCopy, parseDashboardLocale, type DashboardLocale } from '../dashboard-office-copy.pure.js';
import {
  COUNTRY_PACK_STANDARD_VAT_KEY,
  canReconstructMonthlyExpectedFromFeeHistory,
  feeScheduleBasisForPeriod,
  parseCountryPackVatRate,
  projectOfficeExpectedFees,
  type DashboardFeeAgreementInput,
  type DashboardFeeClientInput,
  type DashboardFeeLineInput,
  type FeeBreakdownCategory,
} from '../dashboard-office-fees.pure.js';
import {
  monthActivePopulation,
  monthDepartedCount,
  projectOfficeChurn,
} from '../dashboard-office-churn.pure.js';
import { paginateFeeBreakdown } from '../dashboard-office-fee-breakdown.pure.js';
import type {
  DashboardFeeBreakdownQuery,
  DashboardOverviewQuery,
  OfficeDashboardSection,
  OfficeFeeBreakdownAggregate,
} from '../dashboard-office.types.js';
import type { DashboardStatus } from '../dashboard-status.js';

const PAGE = 500;
const MISSING_FEES_LIST_CAP = 8;

function hasPermission(ctx: RequestContext, p: string): boolean {
  return (ctx.membership?.permissions ?? []).includes(p);
}

function canViewFees(ctx: RequestContext): boolean {
  return hasPermission(ctx, 'fees_tab.view') || hasPermission(ctx, 'client_operations.view');
}

function formatIls(amount: number, locale: DashboardLocale): string {
  const tag = locale === 'he' ? 'he-IL' : 'en-US';
  const formatted = new Intl.NumberFormat(tag, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
  return `₪${formatted}`;
}

function monthLabel(monthKey: string, locale: DashboardLocale): string {
  const [y, m] = monthKey.split('-').map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function unavailableKpi(key: string, title_he: string, secondary_he: string): OfficeDashboardSection['kpis']['active_clients'] {
  return {
    key,
    title_he,
    value_he: '—',
    secondary_he,
    href: null,
    action_key: null,
    status: 'unavailable',
    note_he: secondary_he,
  };
}

function emptyOfficeSection(
  periodKey: DashboardPeriodKey,
  now: Date,
  locale: DashboardLocale,
  reason: string,
): OfficeDashboardSection {
  const copy = officeCopy(locale);
  const window = resolveDashboardPeriodWindow(now, periodKey, locale);
  const kpi = (key: string, title_he: string) => unavailableKpi(key, title_he, reason);
  return {
    title_he: copy.title,
    subtitle_he: copy.subtitle,
    period: {
      key: window.key,
      label_he: window.label_he,
      start_date: window.start_date,
      end_date: window.end_date,
      options: dashboardPeriodOptions(window.key, locale),
    },
    kpis: {
      active_clients: kpi('active_clients', copy.kpi_active),
      expected_fees: kpi('expected_fees', copy.kpi_expected_fees),
      office_debtors: kpi('office_debtors', copy.kpi_debtors),
      new_clients: kpi('new_clients', copy.kpi_new_clients),
      clients_left: kpi('clients_left', copy.kpi_left),
    },
    expected_fees_diagnostics: {
      completeness: 'unavailable',
      completeness_he: copy.completeness_incomplete,
      total_before_discount_he: null,
      discount_total_he: null,
      opens_breakdown: false,
    },
    missing_fees: {
      title_he: copy.missing_title,
      status: 'unavailable',
      count: 0,
      count_label_he: copy.clients_count(0),
      list_cap: MISSING_FEES_LIST_CAP,
      truncated: false,
      truncated_he: null,
      empty_he: reason,
      view_all_label_he: copy.view_all,
      view_all_action: null,
      clients: [],
    },
    attention: {
      title_he: copy.attention_title,
      items: [
        {
          key: 'overdue',
          title_he: copy.attention_overdue,
          count: null,
          href: null,
          status: 'unavailable',
          unavailable_he: reason,
        },
        {
          key: 'due_today',
          title_he: copy.attention_due_today,
          count: null,
          href: null,
          status: 'unavailable',
          unavailable_he: reason,
        },
        {
          key: 'awaiting_approval',
          title_he: copy.attention_approval,
          count: null,
          href: null,
          status: 'unavailable',
          unavailable_he: reason,
        },
        {
          key: 'missing_documents',
          title_he: copy.attention_missing_docs,
          count: null,
          href: null,
          status: 'unavailable',
          unavailable_he: copy.attention_missing_docs_unavailable,
        },
      ],
    },
    deadlines: {
      title_he: copy.deadlines_title,
      status: 'coming_soon',
      unavailable_he: copy.deadlines_unavailable,
      rows: [],
    },
    charts: {
      expected_fees_by_month: {
        title_he: copy.chart_fees_title,
        status: 'unavailable',
        historical_basis_he: reason,
        currency: 'ILS',
        occupy_primary: false,
        points: [],
      },
      client_growth: {
        title_he: copy.chart_growth_title,
        hint_he: copy.chart_growth_departed_hint,
        status: 'unavailable',
        points: [],
        departed_points: [],
      },
    },
    client_status: { title_he: copy.status_title, segments: [] },
    recent_activity: {
      title_he: copy.activity_title,
      status: 'unavailable',
      unavailable_he: copy.activity_unavailable,
      events: [],
    },
    quick_actions: { title_he: copy.actions_title, collected_cash_note_he: copy.collected_cash_note, actions: [] },
  };
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

async function countWorkItems(params: {
  orgId: string;
  allowIds: string[] | null;
  workState?: string;
  dueGte?: string;
  dueLt?: string;
}): Promise<number> {
  if (params.allowIds && params.allowIds.length === 0) return 0;
  const chunks: Array<string[] | null> =
    params.allowIds == null ? [null] : chunkIds(params.allowIds, 80);
  let total = 0;
  for (const chunk of chunks) {
    let q = supabaseAdmin.from('work_items').select('id', { count: 'exact', head: true }).eq('org_id', params.orgId);
    if (params.workState) q = q.eq('work_state', params.workState);
    if (params.dueGte) q = q.gte('due_at', params.dueGte);
    if (params.dueLt) q = q.lt('due_at', params.dueLt);
    if (params.dueGte || params.dueLt) {
      q = q.not('work_state', 'eq', 'done').not('work_state', 'eq', 'archived');
    }
    if (chunk) q = q.in('client_id', chunk);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    total += count ?? 0;
  }
  return total;
}

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function resolveOfficeCountryPackVatRate(orgId: string, asOfDate: string): Promise<number | null> {
  try {
    const ctx = await resolveCountryContext(orgId, asOfDate);
    const fromMap = parseCountryPackVatRate(ctx.resolved_values_map[COUNTRY_PACK_STANDARD_VAT_KEY]);
    if (fromMap != null) return fromMap;
    if (ctx.ruleset_id && ctx.country_code) {
      const version = await resolveLegalValue(ctx.country_code, COUNTRY_PACK_STANDARD_VAT_KEY, asOfDate, ctx.ruleset_id);
      return parseCountryPackVatRate(version?.value_payload_json);
    }
  } catch {
    return null;
  }
  return null;
}

function mapLine(row: Record<string, unknown>): DashboardFeeLineInput {
  return {
    client_id: String(row.client_id),
    agreement_id: String(row.agreement_id),
    is_active: asBool(row.is_active),
    charging_type: String(row.charging_type ?? 'monthly'),
    line_kind: String(row.line_kind ?? ''),
    catalog_code: row.catalog_code != null ? String(row.catalog_code) : null,
    price_ils: row.price_ils != null ? Number(row.price_ils) : null,
    vat_mode: row.vat_mode != null ? String(row.vat_mode) : null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    currency_code: row.currency_code != null ? String(row.currency_code) : null,
    exchange_rate_to_ils: row.exchange_rate_to_ils != null ? Number(row.exchange_rate_to_ils) : null,
    payslip_count: row.payslip_count != null ? Number(row.payslip_count) : null,
    unit_price_ils: row.unit_price_ils != null ? Number(row.unit_price_ils) : null,
    line_total_ils: row.line_total_ils != null ? Number(row.line_total_ils) : null,
  };
}

export const dashboardOfficeProvider: DashboardProvider = {
  code: 'office_operations',
  required: false,
  supports: () => true,
  getUnavailablePart(_ctx, _error): DashboardOverviewPartial {
    const locale = parseDashboardLocale(undefined);
    const copy = officeCopy(locale);
    return { office: emptyOfficeSection('current_month', new Date(), locale, copy.load_failed) };
  },
  async getOverviewPart(ctx: RequestContext, query?: DashboardOverviewQuery): Promise<DashboardOverviewPartial> {
    const orgId = ctx.organizationId;
    const membership = ctx.membership;
    if (!orgId || !membership) throw forbidden('Active organization required');

    const now = new Date();
    const locale = parseDashboardLocale(query?.locale);
    const copy = officeCopy(locale);
    const periodKey = parseDashboardPeriodKey(query?.period);
    const window = resolveDashboardPeriodWindow(now, periodKey, locale);
    const today = jerusalemDayWindow(now);
    const allowUndatedCurrent = window.start_date <= today.date && window.end_date >= today.date;

    const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
    const allowIds = accessScope.authorized_client_ids;
    const authorizedSet = allowIds ? new Set(allowIds) : null;

    const clientRows = await fetchAllOrgRows<Record<string, unknown>>(
      'clients',
      'id, display_name, status, is_archived, created_at, ended_at',
      'organization_id',
      orgId,
    );
    const clients: DashboardFeeClientInput[] = clientRows
      .map((r) => ({
        id: String(r.id),
        display_name: r.display_name != null ? String(r.display_name) : null,
        status: r.status != null ? String(r.status) : null,
        is_archived: asBool(r.is_archived),
        created_at: r.created_at != null ? String(r.created_at) : null,
        ended_at: r.ended_at != null ? String(r.ended_at) : null,
      }))
      .filter((c) => (authorizedSet ? authorizedSet.has(c.id) : true));

    const visible = clients.filter((c) => !c.is_archived);
    const activeClients = visible.filter((c) => String(c.status ?? '') === 'active');
    const newInPeriod = visible.filter((c) => {
      const created = isoToJerusalemDate(c.created_at);
      return created != null && created >= window.start_date && created <= window.end_date;
    });

    const statusCounts = {
      active: visible.filter((c) => String(c.status ?? '') === 'active').length,
      inactive: visible.filter((c) => String(c.status ?? '') === 'inactive').length,
      pending: visible.filter((c) => String(c.status ?? '') === 'pending').length,
      archived: clients.filter((c) => c.is_archived).length,
    };

    const months = lastNJerusalemMonths(now, 6);
    const growthUniverse = clients;
    const growthPoints = months.map((m) => ({
      month: m.month_key,
      label_he: monthLabel(m.month_key, locale),
      value: monthActivePopulation(growthUniverse, m.start_date, m.end_date),
      established: true,
    }));
    const departedPoints = months.map((m) => ({
      month: m.month_key,
      label_he: monthLabel(m.month_key, locale),
      value: monthDepartedCount(growthUniverse, m.start_date, m.end_date),
      established: true,
    }));
    const churn = projectOfficeChurn(clients, window.start_date, window.end_date);

    let expectedStatus: DashboardStatus = 'ready';
    let expectedAmount = 0;
    let expectedBeforeDiscount = 0;
    let expectedDiscountTotal = 0;
    let expectedCompleteness: 'complete' | 'incomplete' | 'unavailable' = 'unavailable';
    let skippedFx = 0;
    let missingClients: Array<{ client_id: string; display_name: string; category: FeeBreakdownCategory }> = [];
    const feeChartPoints: OfficeDashboardSection['charts']['expected_fees_by_month']['points'] = [];
    let feeNote: string | null = null;
    const historyGap = canReconstructMonthlyExpectedFromFeeHistory([]);
    const feeScheduleBasis = feeScheduleBasisForPeriod(allowUndatedCurrent);

    if (!canViewFees(ctx)) {
      expectedStatus = 'unavailable';
      feeNote = copy.no_fees_permission;
    } else {
      const [agreementRows, lineRows, vatRate] = await Promise.all([
        fetchAllOrgRows<Record<string, unknown>>(
          'client_fee_agreements',
          'id, client_id, agreement_status, agreement_start_date, agreement_end_date, discount_has, discount_type, discount_percent, discount_amount_ils',
          'organization_id',
          orgId,
        ),
        fetchAllOrgRows<Record<string, unknown>>(
          'client_fee_service_lines',
          'client_id, agreement_id, is_active, charging_type, line_kind, catalog_code, price_ils, vat_mode, quantity, currency_code, exchange_rate_to_ils, payslip_count, unit_price_ils, line_total_ils',
          'organization_id',
          orgId,
        ),
        resolveOfficeCountryPackVatRate(orgId, today.date),
      ]);
      const agreementsByClient = new Map<string, DashboardFeeAgreementInput[]>();
      for (const row of agreementRows) {
        const id = String(row.client_id);
        if (authorizedSet && !authorizedSet.has(id)) continue;
        const list = agreementsByClient.get(id) ?? [];
        list.push({
          id: row.id != null ? String(row.id) : null,
          client_id: id,
          agreement_status: row.agreement_status != null ? String(row.agreement_status) : null,
          agreement_start_date: row.agreement_start_date != null ? String(row.agreement_start_date).slice(0, 10) : null,
          agreement_end_date: row.agreement_end_date != null ? String(row.agreement_end_date).slice(0, 10) : null,
          discount_has: asBool(row.discount_has),
          discount_type: row.discount_type != null ? String(row.discount_type) : null,
          discount_percent: row.discount_percent != null ? Number(row.discount_percent) : null,
          discount_amount_ils: row.discount_amount_ils != null ? Number(row.discount_amount_ils) : null,
        });
        agreementsByClient.set(id, list);
      }
      const linesByClient = new Map<string, DashboardFeeLineInput[]>();
      for (const row of lineRows) {
        const id = String(row.client_id);
        if (authorizedSet && !authorizedSet.has(id)) continue;
        const list = linesByClient.get(id) ?? [];
        list.push(mapLine(row));
        linesByClient.set(id, list);
      }

      const missingSnapshot = projectOfficeExpectedFees({
        clients: activeClients,
        agreementsByClient,
        linesByClient,
        periodStart: today.date,
        periodEnd: today.date,
        allowUndatedHistorical: true,
        vatRate,
      });
      missingClients = missingSnapshot.missing;

      if (feeScheduleBasis === 'historical_unavailable') {
        expectedStatus = 'unavailable';
        expectedCompleteness = 'unavailable';
        feeNote = copy.historical_unavailable;
      } else if (periodKey === 'current_year') {
        expectedStatus = 'unavailable';
        expectedCompleteness = 'unavailable';
        feeNote = copy.kpi_expected_year_unavailable;
      } else {
        const current = projectOfficeExpectedFees({
          clients: activeClients,
          agreementsByClient,
          linesByClient,
          periodStart: window.start_date,
          periodEnd: window.end_date,
          allowUndatedHistorical: true,
          vatRate,
        });
        expectedCompleteness = current.completeness;
        expectedBeforeDiscount = current.total_before_discount;
        expectedDiscountTotal = current.discount_total;
        if (current.vat_rate_blocked || current.completeness === 'unavailable') {
          expectedStatus = 'unavailable';
          feeNote = copy.vat_rate_unavailable;
        } else if (current.completeness === 'incomplete') {
          expectedStatus = 'unavailable';
          expectedAmount = 0;
          skippedFx = current.skipped_fx_clients;
          feeNote = skippedFx > 0 ? copy.fx_skipped(skippedFx) : copy.kpi_expected_incomplete;
        } else {
          expectedAmount = current.total_monthly_before_vat;
          skippedFx = current.skipped_fx_clients;
        }
      }

      for (const m of months) {
        const isCurrentMonth = m.start_date <= today.date && m.end_date >= today.date;
        if (!isCurrentMonth || expectedStatus !== 'ready') {
          feeChartPoints.push({
            month: m.month_key,
            label_he: monthLabel(m.month_key, locale),
            value: null,
            established: false,
          });
          continue;
        }
        const monthProj = projectOfficeExpectedFees({
          clients: activeClients,
          agreementsByClient,
          linesByClient,
          periodStart: m.start_date,
          periodEnd: m.end_date,
          allowUndatedHistorical: true,
          vatRate,
        });
        feeChartPoints.push({
          month: m.month_key,
          label_he: monthLabel(m.month_key, locale),
          value: monthProj.vat_rate_blocked ? null : monthProj.total_monthly_before_vat,
          established: !monthProj.vat_rate_blocked,
        });
      }
    }

    const missingHrefClients = missingClients.slice(0, MISSING_FEES_LIST_CAP).map((c) => ({
      client_id: c.client_id,
      display_name: c.display_name,
      indicator_he: categoryLabelHe(c.category, copy) || copy.missing_indicator,
      href: `/m/client-operations/clients/${c.client_id}?tab=fees`,
    }));

    let overdue: number | null = null;
    let dueToday: number | null = null;
    let reviewPending: number | null = null;
    let weStatus: DashboardStatus = 'ready';
    let weUnavailable: string | null = null;
    try {
      const [o, d, r] = await Promise.all([
        countWorkItems({ orgId, allowIds, workState: 'overdue' }),
        countWorkItems({
          orgId,
          allowIds,
          dueGte: today.start_iso,
          dueLt: today.end_exclusive_iso,
        }),
        countWorkItems({ orgId, allowIds, workState: 'review_pending' }),
      ]);
      overdue = o;
      dueToday = d;
      reviewPending = r;
    } catch {
      weStatus = 'unavailable';
      weUnavailable = copy.we_unavailable;
    }

    const officeAdmin = roleHasOfficeClientAccess(membership.roleCode);
    const canCreateClient = officeAdmin && membership.permissions.includes('clients:write');
    const canUploadDocument = membership.permissions.includes('documents:write');

    const missingFeesStatus: DashboardStatus = canViewFees(ctx) ? 'ready' : 'unavailable';
    const missingTruncated = missingClients.length > MISSING_FEES_LIST_CAP;
    const expectedSecondary =
      periodKey === 'current_year' ? copy.kpi_expected_secondary_year : copy.kpi_expected_secondary;
    const historicalBasisHe = copy.historical_basis(historyGap.missing.join(', '));

    const office: OfficeDashboardSection = {
      title_he: copy.title,
      subtitle_he: copy.subtitle,
      period: {
        key: window.key,
        label_he: window.label_he,
        start_date: window.start_date,
        end_date: window.end_date,
        options: dashboardPeriodOptions(window.key, locale),
      },
      kpis: {
        active_clients: {
          key: 'active_clients',
          title_he: copy.kpi_active,
          value_he: String(activeClients.length),
          secondary_he: copy.kpi_active_secondary,
          href: '/m/client-operations',
          action_key: 'navigate',
          status: 'ready',
          note_he: null,
        },
        expected_fees: {
          key: 'expected_fees',
          title_he: copy.kpi_expected_fees,
          value_he: expectedStatus === 'ready' ? formatIls(expectedAmount, locale) : '—',
          secondary_he: expectedStatus === 'ready' ? expectedSecondary : feeNote ?? copy.unavailable,
          href: null,
          action_key: canViewFees(ctx) ? 'open_fee_breakdown' : null,
          status: expectedStatus,
          note_he: feeNote,
        },
        office_debtors: {
          key: 'office_debtors',
          title_he: copy.kpi_debtors,
          value_he: '—',
          secondary_he: copy.kpi_debtors_secondary,
          href: null,
          action_key: null,
          status: 'coming_soon',
          note_he: copy.kpi_debtors_note,
        },
        new_clients: {
          key: 'new_clients',
          title_he: copy.kpi_new_clients,
          value_he: String(newInPeriod.length),
          secondary_he: copy.kpi_new_clients_secondary(window.label_he),
          href: '/m/client-operations',
          action_key: 'navigate',
          status: 'ready',
          note_he: null,
        },
        clients_left: {
          key: 'clients_left',
          title_he: copy.kpi_left,
          value_he: String(churn.departed_count),
          secondary_he: churn.churn_percent != null
            ? `${copy.kpi_left_secondary(window.label_he)} · ${copy.kpi_left_churn(String(churn.churn_percent))}`
            : copy.kpi_left_secondary(window.label_he),
          href: '/m/client-operations',
          action_key: 'navigate',
          status: 'ready',
          note_he: churn.churn_percent == null ? copy.kpi_left_churn_unavailable : null,
        },
      },
      expected_fees_diagnostics: {
        completeness: expectedCompleteness,
        completeness_he:
          expectedCompleteness === 'complete' ? copy.completeness_complete : copy.completeness_incomplete,
        total_before_discount_he:
          expectedStatus === 'ready' ? formatIls(expectedBeforeDiscount, locale) : null,
        discount_total_he: expectedStatus === 'ready' ? formatIls(expectedDiscountTotal, locale) : null,
        opens_breakdown: canViewFees(ctx),
      },
      missing_fees: {
        title_he: copy.missing_title,
        status: missingFeesStatus,
        count: missingClients.length,
        count_label_he: copy.clients_count(missingClients.length),
        list_cap: MISSING_FEES_LIST_CAP,
        truncated: missingTruncated,
        truncated_he: missingTruncated ? copy.missing_truncated(MISSING_FEES_LIST_CAP, missingClients.length) : null,
        empty_he:
          missingFeesStatus === 'unavailable'
            ? feeNote ?? copy.unavailable
            : missingClients.length === 0
              ? copy.missing_empty
              : '',
        view_all_label_he: copy.view_all,
        view_all_action: missingFeesStatus === 'ready' ? 'open_fee_breakdown' : null,
        clients: missingHrefClients,
      },
      attention: {
        title_he: copy.attention_title,
        items: [
          {
            key: 'overdue',
            title_he: copy.attention_overdue,
            count: overdue,
            href: weStatus === 'ready' ? '/work-engine/queue?state=overdue' : null,
            status: weStatus,
            unavailable_he: weUnavailable,
          },
          {
            key: 'due_today',
            title_he: copy.attention_due_today,
            count: dueToday,
            href: weStatus === 'ready' ? '/work-engine/queue' : null,
            status: weStatus,
            unavailable_he: weUnavailable,
          },
          {
            key: 'awaiting_approval',
            title_he: copy.attention_approval,
            count: reviewPending,
            href: weStatus === 'ready' ? '/work-engine/queue?state=review_pending' : null,
            status: weStatus,
            unavailable_he: weUnavailable,
          },
          {
            key: 'missing_documents',
            title_he: copy.attention_missing_docs,
            count: null,
            href: null,
            status: 'unavailable',
            unavailable_he: copy.attention_missing_docs_unavailable,
          },
        ],
      },
      deadlines: {
        title_he: copy.deadlines_title,
        status: 'coming_soon',
        unavailable_he: copy.deadlines_unavailable,
        rows: [],
      },
      charts: {
        expected_fees_by_month: {
          title_he: copy.chart_fees_title,
          status: expectedStatus,
          historical_basis_he: historicalBasisHe,
          currency: 'ILS',
          occupy_primary: feeChartPoints.some((p) => p.established && p.value != null),
          points: feeChartPoints,
        },
        client_growth: {
          title_he: copy.chart_growth_title,
          hint_he: copy.chart_growth_departed_hint,
          status: 'ready',
          points: growthPoints,
          departed_points: departedPoints,
        },
      },
      client_status: {
        title_he: copy.status_title,
        segments: [
          { key: 'active', label_he: copy.status_active, count: statusCounts.active, color: '#39e6f4' },
          { key: 'pending', label_he: copy.status_pending, count: statusCounts.pending, color: '#7decf7' },
          { key: 'inactive', label_he: copy.status_inactive, count: statusCounts.inactive, color: '#268cff' },
          { key: 'archived', label_he: copy.status_archived, count: statusCounts.archived, color: '#8fb4d9' },
        ],
      },
      recent_activity: {
        title_he: copy.activity_title,
        status: 'unavailable',
        unavailable_he: copy.activity_unavailable,
        events: [],
      },
      quick_actions: {
        title_he: copy.actions_title,
        collected_cash_note_he: copy.collected_cash_note,
        actions: [
          { key: 'new_client', label_he: copy.action_new_client, href: '/clients', enabled: canCreateClient },
          { key: 'upload_document', label_he: copy.action_upload, href: '/documents', enabled: canUploadDocument },
          { key: 'tasks', label_he: copy.action_tasks, href: '/work-engine/queue', enabled: true },
        ],
      },
    };

    return { office };
  },
};

function frequencyLabelHe(freqs: string[], copy: ReturnType<typeof officeCopy>): string {
  const unique = [...new Set(freqs.filter(Boolean))];
  if (unique.length === 0) return '—';
  if (unique.length > 1) return copy.freq_mixed;
  switch (unique[0]) {
    case 'monthly':
      return copy.freq_monthly;
    case 'bi_monthly':
      return copy.freq_bi_monthly;
    case 'quarterly':
      return copy.freq_quarterly;
    case 'yearly':
      return copy.freq_yearly;
    case 'one_time':
      return copy.freq_one_time;
    default:
      return unique[0] ?? '—';
  }
}

function categoryLabelHe(category: FeeBreakdownCategory, copy: ReturnType<typeof officeCopy>): string {
  switch (category) {
    case 'positive_recurring':
      return copy.cat_positive_recurring;
    case 'configured_zero':
      return copy.cat_configured_zero;
    case 'no_agreement':
      return copy.cat_no_agreement;
    case 'no_recurring_service':
      return copy.cat_no_recurring_service;
    case 'one_time_only':
      return copy.cat_one_time_only;
    case 'needs_attention':
      return copy.cat_needs_attention;
    case 'unsupported_vat_fx':
      return copy.cat_unsupported_vat_fx;
    default:
      return copy.unavailable;
  }
}

export async function getOfficeFeeBreakdownAggregate(
  ctx: RequestContext,
  query?: DashboardFeeBreakdownQuery,
): Promise<OfficeFeeBreakdownAggregate> {
  const orgId = ctx.organizationId;
  const membership = ctx.membership;
  if (!orgId || !membership) throw forbidden('Active organization required');
  const now = new Date();
  const locale = parseDashboardLocale(query?.locale);
  const copy = officeCopy(locale);
  const periodKey = parseDashboardPeriodKey(query?.period);
  const window = resolveDashboardPeriodWindow(now, periodKey, locale);
  const today = jerusalemDayWindow(now);
  const allowUndatedCurrent = window.start_date <= today.date && window.end_date >= today.date;
  const period = {
    key: window.key,
    label_he: window.label_he,
    start_date: window.start_date,
    end_date: window.end_date,
    options: dashboardPeriodOptions(window.key, locale),
  };
  const empty = (note: string, status: DashboardStatus = 'unavailable'): OfficeFeeBreakdownAggregate => ({
    title_he: copy.breakdown_title,
    period,
    office_total: {
      status,
      completeness: 'unavailable',
      completeness_he: copy.completeness_incomplete,
      value_he: '—',
      before_discount_he: null,
      discount_he: null,
      note_he: note,
    },
    columns: [],
    filters: [{ key: 'all', label_he: copy.breakdown_filter_all }],
    search_placeholder_he: copy.breakdown_search,
    empty_he: note,
    page_label_he: copy.breakdown_page(1, 1, 0),
    rows: [],
    pagination: {
      page: 1,
      page_size: 25,
      total: 0,
      total_pages: 1,
      sort: 'display_name',
      sort_dir: 'asc',
      filter: 'all',
      q: '',
    },
  });

  if (!canViewFees(ctx)) return empty(copy.no_fees_permission);
  if (feeScheduleBasisForPeriod(allowUndatedCurrent) === 'historical_unavailable') {
    return empty(copy.historical_unavailable);
  }
  if (periodKey === 'current_year') {
    return empty(copy.kpi_expected_year_unavailable);
  }

  const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
  const authorizedSet = accessScope.authorized_client_ids ? new Set(accessScope.authorized_client_ids) : null;
  const clientRows = await fetchAllOrgRows<Record<string, unknown>>(
    'clients',
    'id, display_name, status, is_archived, created_at, ended_at',
    'organization_id',
    orgId,
  );
  const clients: DashboardFeeClientInput[] = clientRows
    .map((r) => ({
      id: String(r.id),
      display_name: r.display_name != null ? String(r.display_name) : null,
      status: r.status != null ? String(r.status) : null,
      is_archived: asBool(r.is_archived),
      created_at: r.created_at != null ? String(r.created_at) : null,
      ended_at: r.ended_at != null ? String(r.ended_at) : null,
    }))
    .filter((c) => (authorizedSet ? authorizedSet.has(c.id) : true))
    .filter((c) => !c.is_archived && String(c.status ?? '') === 'active');

  const [agreementRows, lineRows, vatRate] = await Promise.all([
    fetchAllOrgRows<Record<string, unknown>>(
      'client_fee_agreements',
      'id, client_id, agreement_status, agreement_start_date, agreement_end_date, discount_has, discount_type, discount_percent, discount_amount_ils',
      'organization_id',
      orgId,
    ),
    fetchAllOrgRows<Record<string, unknown>>(
      'client_fee_service_lines',
      'client_id, agreement_id, is_active, charging_type, line_kind, catalog_code, price_ils, vat_mode, quantity, currency_code, exchange_rate_to_ils, payslip_count, unit_price_ils, line_total_ils',
      'organization_id',
      orgId,
    ),
    resolveOfficeCountryPackVatRate(orgId, today.date),
  ]);
  const agreementsByClient = new Map<string, DashboardFeeAgreementInput[]>();
  for (const row of agreementRows) {
    const id = String(row.client_id);
    if (authorizedSet && !authorizedSet.has(id)) continue;
    const list = agreementsByClient.get(id) ?? [];
    list.push({
      id: row.id != null ? String(row.id) : null,
      client_id: id,
      agreement_status: row.agreement_status != null ? String(row.agreement_status) : null,
      agreement_start_date: row.agreement_start_date != null ? String(row.agreement_start_date).slice(0, 10) : null,
      agreement_end_date: row.agreement_end_date != null ? String(row.agreement_end_date).slice(0, 10) : null,
      discount_has: asBool(row.discount_has),
      discount_type: row.discount_type != null ? String(row.discount_type) : null,
      discount_percent: row.discount_percent != null ? Number(row.discount_percent) : null,
      discount_amount_ils: row.discount_amount_ils != null ? Number(row.discount_amount_ils) : null,
    });
    agreementsByClient.set(id, list);
  }
  const linesByClient = new Map<string, DashboardFeeLineInput[]>();
  for (const row of lineRows) {
    const id = String(row.client_id);
    if (authorizedSet && !authorizedSet.has(id)) continue;
    const list = linesByClient.get(id) ?? [];
    list.push(mapLine(row));
    linesByClient.set(id, list);
  }

  const projected = projectOfficeExpectedFees({
    clients,
    agreementsByClient,
    linesByClient,
    periodStart: window.start_date,
    periodEnd: window.end_date,
    allowUndatedHistorical: true,
    vatRate,
  });
  const paged = paginateFeeBreakdown(projected.client_results, query ?? {});
  const complete = projected.completeness === 'complete';
  const totalStatus: DashboardStatus = complete ? 'ready' : 'unavailable';

  return {
    title_he: copy.breakdown_title,
    period,
    office_total: {
      status: totalStatus,
      completeness: projected.completeness,
      completeness_he: complete ? copy.completeness_complete : copy.completeness_incomplete,
      value_he: complete ? formatIls(projected.total_monthly_before_vat, locale) : '—',
      before_discount_he: complete ? formatIls(projected.total_before_discount, locale) : null,
      discount_he: complete ? formatIls(projected.discount_total, locale) : null,
      note_he: projected.vat_rate_blocked
        ? copy.vat_rate_unavailable
        : projected.skipped_fx_clients > 0
          ? copy.fx_skipped(projected.skipped_fx_clients)
          : complete
            ? null
            : copy.kpi_expected_incomplete,
    },
    columns: [
      { key: 'client', label_he: copy.col_client },
      { key: 'agreement', label_he: copy.col_agreement },
      { key: 'frequency', label_he: copy.col_frequency },
      { key: 'before_discount', label_he: copy.col_before_discount },
      { key: 'discount', label_he: copy.col_discount },
      { key: 'monthly', label_he: copy.col_monthly },
      { key: 'status', label_he: copy.col_status },
    ],
    filters: [
      { key: 'all', label_he: copy.breakdown_filter_all },
      { key: 'positive_recurring', label_he: copy.cat_positive_recurring },
      { key: 'configured_zero', label_he: copy.cat_configured_zero },
      { key: 'no_agreement', label_he: copy.cat_no_agreement },
      { key: 'no_recurring_service', label_he: copy.cat_no_recurring_service },
      { key: 'one_time_only', label_he: copy.cat_one_time_only },
      { key: 'needs_attention', label_he: copy.cat_needs_attention },
      { key: 'unsupported_vat_fx', label_he: copy.cat_unsupported_vat_fx },
    ],
    search_placeholder_he: copy.breakdown_search,
    empty_he: copy.breakdown_empty,
    page_label_he: copy.breakdown_page(paged.page, paged.total_pages, paged.total),
    rows: paged.rows.map((r) => ({
      client_id: r.client_id,
      display_name: r.display_name,
      href: `/m/client-operations/clients/${r.client_id}?tab=fees`,
      agreement_status_he: r.agreement_status || (r.category === 'no_agreement' ? copy.cat_no_agreement : '—'),
      billing_frequency_he: frequencyLabelHe(r.billing_frequencies, copy),
      recurring_before_discount_he: r.included_in_complete_total ? formatIls(r.monthly_before_discount, locale) : '—',
      discount_he: !r.discount_has
        ? copy.discount_none
        : r.discount_type === 'percent'
          ? copy.discount_percent(String(r.discount_percent ?? 0))
          : copy.discount_amount(formatIls(Number(r.discount_amount_ils ?? 0), locale)),
      monthly_before_vat_he: r.included_in_complete_total ? formatIls(r.monthly_before_vat, locale) : '—',
      calculation_status_he: categoryLabelHe(r.category, copy),
      category: r.category,
      expandable: r.lines.length > 1,
      lines: r.lines.map((line) => ({
        charging_type_he: frequencyLabelHe([line.charging_type], copy),
        monthly_before_vat_he: formatIls(line.monthly_before_vat, locale),
      })),
    })),
    pagination: {
      page: paged.page,
      page_size: paged.page_size,
      total: paged.total,
      total_pages: paged.total_pages,
      sort: paged.sort,
      sort_dir: paged.sort_dir,
      filter: paged.filter,
      q: paged.q,
    },
  };
}
