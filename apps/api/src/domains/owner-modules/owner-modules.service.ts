/**
 * Platform Owner Modules — catalog list/detail aggregates + global activation command.
 * Reuses Country Pack commercial controls + platform pricing (no second commercial truth).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import {
  buildOwnerCommercialControlsAggregate,
  buildOwnerPlatformPricingAggregate,
  type CommercialControlsQuery,
} from '../country-pack/country-pack-read-models.service.js';
import {
  CLIENT_OPERATIONS_MODULE_CODE,
  OWNER_MODULE_DETAIL_AGGREGATE_KEY,
  OWNER_MODULES_LIST_AGGREGATE_KEY,
  buildOwnerModuleDetailTabs,
  filterPricingRowsForModule,
  isOwnerModulesCatalogRow,
  summarizeCatalogPlans,
} from './owner-modules.pure.js';
import { buildCountryReportingCalendarAggregate } from '../country-pack/reporting-calendar.service.js';

export type OwnerModulesCommercialQuery = Partial<CommercialControlsQuery>;
export type OwnerModulesReportingCalendarQuery = {
  country_code?: string | null;
  year?: number | string | null;
};

type ModuleCatalogRow = {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
  is_sellable: boolean;
};

type PlanRow = {
  price_amount: number;
  currency: string;
  billing_period: string;
  is_active: boolean;
  sort_order: number | null;
};

async function loadOwnerModulesCatalogRows(): Promise<ModuleCatalogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, is_system, is_active, is_sellable')
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ModuleCatalogRow[]).filter((m) =>
    isOwnerModulesCatalogRow({
      code: String(m.code),
      is_system: Boolean(m.is_system),
      is_sellable: Boolean(m.is_sellable),
      is_active: Boolean(m.is_active),
    })
  );
}

async function loadPlansByModuleId(moduleIds: string[]): Promise<Map<string, PlanRow[]>> {
  const map = new Map<string, PlanRow[]>();
  if (!moduleIds.length) return map;
  const { data, error } = await supabaseAdmin
    .from('module_plans')
    .select('module_id, price_amount, currency, billing_period, is_active, sort_order')
    .in('module_id', moduleIds)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) {
    const mid = String((row as { module_id: string }).module_id);
    const list = map.get(mid) ?? [];
    list.push({
      price_amount: Number((row as { price_amount: number }).price_amount),
      currency: String((row as { currency: string }).currency),
      billing_period: String((row as { billing_period: string }).billing_period),
      is_active: Boolean((row as { is_active: boolean }).is_active),
      sort_order: (row as { sort_order: number | null }).sort_order ?? null,
    });
    map.set(mid, list);
  }
  return map;
}

async function countActiveOrganizationsByModuleId(moduleIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of moduleIds) counts.set(id, 0);
  if (!moduleIds.length) return counts;
  const { data, error } = await supabaseAdmin
    .from('organization_modules')
    .select('module_id')
    .in('module_id', moduleIds)
    .eq('status', 'active');
  if (error) throw error;
  for (const row of data ?? []) {
    const mid = String((row as { module_id: string }).module_id);
    counts.set(mid, (counts.get(mid) ?? 0) + 1);
  }
  return counts;
}

function buildModuleListRow(
  m: ModuleCatalogRow,
  plans: PlanRow[],
  organizationCount: number
): Record<string, unknown> {
  const price = summarizeCatalogPlans(plans);
  const globallyEnabled = Boolean(m.is_active);
  const detailTabs = buildOwnerModuleDetailTabs(m.code);
  return {
    module_id: m.id,
    module_code: m.code,
    display_name: m.name,
    globally_enabled: globallyEnabled,
    global_status_label: globallyEnabled ? 'ON' : 'OFF',
    organizations_count: organizationCount,
    catalog_price_summary: price.price_summary_label,
    base_price_amount: price.base_price_amount,
    currency: price.currency,
    billing_period: price.billing_period,
    active_plan_count: price.active_plan_count,
    plan_count: price.plan_count,
    available_detail_tabs: detailTabs,
    allowed_actions: {
      open_detail: true,
      set_global_activation: true,
      set_global_activation_to: !globallyEnabled,
    },
  };
}

export async function buildOwnerModulesListAggregate(ctx: RequestContext): Promise<Record<string, unknown>> {
  assertPlatformOwner(ctx);
  const modules = await loadOwnerModulesCatalogRows();
  const moduleIds = modules.map((m) => m.id);
  const [plansByModule, orgCounts] = await Promise.all([
    loadPlansByModuleId(moduleIds),
    countActiveOrganizationsByModuleId(moduleIds),
  ]);

  const rows = modules.map((m) =>
    buildModuleListRow(m, plansByModule.get(m.id) ?? [], orgCounts.get(m.id) ?? 0)
  );

  return {
    aggregate_key: OWNER_MODULES_LIST_AGGREGATE_KEY,
    source: 'modules',
    rows,
    actions: [
      {
        action_key: 'set_module_global_activation',
        enabled: true,
        payload: {
          module_code: 'string (modules.code)',
          is_active: 'boolean — true=ON (globally available), false=OFF (kill-switch)',
        },
        note: 'Updates modules.is_active only. Does not delete organization_modules, subscriptions, trials, or pricing.',
      },
    ],
    navigation: {
      detail_route_template: '/platform-owner/modules/:moduleCode',
    },
  };
}

export async function buildOwnerModuleDetailAggregate(
  ctx: RequestContext,
  moduleCodeRaw: string,
  commercialQuery?: OwnerModulesCommercialQuery,
  reportingCalendarQuery?: OwnerModulesReportingCalendarQuery
): Promise<Record<string, unknown>> {
  assertPlatformOwner(ctx);
  const moduleCode = moduleCodeRaw.trim();
  if (!moduleCode) throw badRequest('module_code is required');

  const modules = await loadOwnerModulesCatalogRows();
  const mod = modules.find((m) => m.code === moduleCode);
  if (!mod) throw notFound(`Module not found: ${moduleCode}`);

  const [plansByModule, orgCounts, platformPricing, commercialControls] = await Promise.all([
    loadPlansByModuleId([mod.id]),
    countActiveOrganizationsByModuleId([mod.id]),
    buildOwnerPlatformPricingAggregate(ctx),
    buildOwnerCommercialControlsAggregate({
      ...commercialQuery,
      module_key: moduleCode,
    }),
  ]);

  const listRow = buildModuleListRow(mod, plansByModule.get(mod.id) ?? [], orgCounts.get(mod.id) ?? 0);
  const detailTabs = buildOwnerModuleDetailTabs(moduleCode);
  const reportingCalendarTab = detailTabs.find((t) => t.tab_key === 'reporting_calendar') ?? null;
  const reportingCalendar = reportingCalendarTab
    ? await buildCountryReportingCalendarAggregate({
        country_code: reportingCalendarQuery?.country_code ?? 'IL',
        year: reportingCalendarQuery?.year ?? new Date().getUTCFullYear(),
      })
    : null;

  return {
    aggregate_key: OWNER_MODULE_DETAIL_AGGREGATE_KEY,
    module: listRow,
    available_detail_tabs: detailTabs,
    platform_pricing: filterPricingRowsForModule(platformPricing, moduleCode),
    commercial_controls: commercialControls,
    reporting_calendar: reportingCalendar,
    actions: [
      {
        action_key: 'set_module_global_activation',
        enabled: true,
        payload: { module_code: moduleCode, is_active: 'boolean' },
      },
    ],
  };
}

export async function executeSetModuleGlobalActivation(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<{
  ok: true;
  command: 'set_module_global_activation';
  refreshed: { aggregate_key: typeof OWNER_MODULES_LIST_AGGREGATE_KEY; aggregate: Record<string, unknown> };
}> {
  assertPlatformOwner(ctx);

  const moduleCode = typeof payload.module_code === 'string' ? payload.module_code.trim() : '';
  if (!moduleCode) throw badRequest('module_code is required');
  if (typeof payload.is_active !== 'boolean') throw badRequest('is_active must be a boolean');
  const nextActive = payload.is_active;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, is_system, is_active, is_sellable')
    .eq('code', moduleCode)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw notFound(`Module not found: ${moduleCode}`);
  const row = existing as ModuleCatalogRow;
  if (row.is_system) {
    throw badRequest('System modules cannot be toggled via set_module_global_activation');
  }
  if (
    !isOwnerModulesCatalogRow({
      code: String(row.code),
      is_system: Boolean(row.is_system),
      is_sellable: Boolean(row.is_sellable),
      is_active: true,
    })
  ) {
    throw badRequest('Module is not part of the Owner Modules catalog');
  }

  const previous = Boolean(row.is_active);
  const unchanged = previous === nextActive;

  if (!unchanged) {
    const { error: updErr } = await supabaseAdmin
      .from('modules')
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) throw updErr;
  }

  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    moduleCode,
    entityType: 'module',
    entityId: String(row.id),
    action: AUDIT_ACTIONS.MODULE_GLOBAL_ACTIVATION_SET,
    payload: {
      command: 'set_module_global_activation',
      module_code: moduleCode,
      previous_is_active: previous,
      is_active: nextActive,
      unchanged,
      note: 'Global kill-switch via modules.is_active; org activation/entitlement rows are preserved.',
    },
  });

  const aggregate = await buildOwnerModulesListAggregate(ctx);
  return {
    ok: true,
    command: 'set_module_global_activation',
    refreshed: {
      aggregate_key: OWNER_MODULES_LIST_AGGREGATE_KEY,
      aggregate,
    },
  };
}

export { CLIENT_OPERATIONS_MODULE_CODE };
