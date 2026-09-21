/**
 * Pure helpers for Platform Owner Modules list/detail (no I/O).
 */

export const OWNER_MODULES_LIST_AGGREGATE_KEY = 'owner_modules_list_aggregate' as const;
export const OWNER_MODULE_DETAIL_AGGREGATE_KEY = 'owner_module_detail_aggregate' as const;

export const CLIENT_OPERATIONS_MODULE_CODE = 'client-operations' as const;

export type OwnerModuleDetailTabKey = 'pricing' | 'users' | 'reporting_calendar';

export type OwnerModuleDetailTab = {
  tab_key: OwnerModuleDetailTabKey;
  label: string;
  enabled: boolean;
  unavailable_reason: string | null;
};

/** Catalog rows eligible for Owner Modules management (not a second registry). */
export function isOwnerModulesCatalogRow(row: {
  code: string;
  is_system: boolean;
  is_sellable: boolean;
  is_active: boolean;
}): boolean {
  if (row.is_system) return false;
  // Hide superseded internal alias rows (e.g. income) that are neither sellable nor globally active.
  if (!row.is_sellable && !row.is_active) return false;
  if (row.code === 'income') return false;
  return true;
}

export function buildOwnerModuleDetailTabs(moduleCode: string): OwnerModuleDetailTab[] {
  const tabs: OwnerModuleDetailTab[] = [
    { tab_key: 'pricing', label: 'Pricing', enabled: true, unavailable_reason: null },
    { tab_key: 'users', label: 'Users', enabled: true, unavailable_reason: null },
  ];
  if (moduleCode === CLIENT_OPERATIONS_MODULE_CODE) {
    tabs.push({
      tab_key: 'reporting_calendar',
      label: 'Reporting Calendar',
      enabled: true,
      unavailable_reason: null,
    });
  }
  return tabs;
}

export function summarizeCatalogPlans(
  plans: ReadonlyArray<{
    price_amount: number;
    currency: string;
    billing_period: string;
    is_active: boolean;
    sort_order: number | null;
  }>
): {
  plan_count: number;
  active_plan_count: number;
  base_price_amount: number | null;
  currency: string | null;
  billing_period: string | null;
  price_summary_label: string | null;
} {
  const sorted = [...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const active = sorted.filter((p) => p.is_active);
  const base = active[0] ?? sorted[0] ?? null;
  if (!base) {
    return {
      plan_count: 0,
      active_plan_count: 0,
      base_price_amount: null,
      currency: null,
      billing_period: null,
      price_summary_label: null,
    };
  }
  const amount = Number(base.price_amount);
  return {
    plan_count: sorted.length,
    active_plan_count: active.length,
    base_price_amount: Number.isFinite(amount) ? amount : null,
    currency: base.currency ?? null,
    billing_period: base.billing_period ?? null,
    price_summary_label: Number.isFinite(amount)
      ? `${amount} ${base.currency}/${base.billing_period}`
      : null,
  };
}

export function filterPricingRowsForModule(
  pricingAggregate: Record<string, unknown>,
  moduleCode: string
): Record<string, unknown> {
  const table = (pricingAggregate.table as { rows?: unknown[] } | undefined) ?? {};
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const scoped = rows.filter((r) => {
    const code = String((r as { module_code?: unknown }).module_code ?? '');
    return code === moduleCode;
  });
  const catalog = (pricingAggregate.module_catalog as { rows?: unknown[] } | undefined) ?? {};
  const catalogRows = Array.isArray(catalog.rows) ? catalog.rows : [];
  return {
    ...pricingAggregate,
    scoped_to_module_code: moduleCode,
    module_catalog: {
      rows: catalogRows.filter((r) => String((r as { module_code?: unknown }).module_code ?? '') === moduleCode),
    },
    table: { rows: scoped },
  };
}
