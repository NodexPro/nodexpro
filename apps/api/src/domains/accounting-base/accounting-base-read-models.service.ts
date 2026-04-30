import type { RequestContext } from '../../shared/context.js';
import { notFound } from '../../shared/errors.js';
import type { AccountingBaseRefreshedAggregate } from './accounting-base-aggregates.service.js';
import { getAccountingBaseRefreshedAggregate } from './accounting-base-aggregates.service.js';
import type { AccountingCategoryRow, AccountingEntryRow, AccountingPeriodRow } from './accounting-base.types.js';

type ActionDef = {
  action_key: string;
  enabled: boolean;
  disabled_reason: string | null;
};

type TableColumn = {
  key: string;
  label: string;
  width?: string;
};

type PermissionBlock = {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_finalize: boolean;
  can_archive: boolean;
  can_manage_links: boolean;
  can_manage_periods: boolean;
  can_manage_categories: boolean;
  can_recompute_summary: boolean;
};

type EntryWorkspaceRow = {
  entry_id: string;
  entry_date: string;
  description: string | null;
  period_id: string;
  period_label: string;
  category_id: string;
  category_name: string;
  status: string;
  posting_state: string;
  direction: string;
  amount: number;
  currency: string;
  has_links: boolean;
  row_actions: ActionDef[];
};

export type AccountingEntriesWorkspaceAggregate = {
  aggregate_key: 'accounting_entries_workspace_aggregate';
  title: string;
  status: { code: 'ok' | 'empty'; label: string };
  permissions: PermissionBlock;
  sections: {
    summary_cards: Array<{ key: string; label: string; value: string }>;
    empty_state: { visible: boolean; title: string; description: string | null };
  };
  table: {
    columns: TableColumn[];
    rows: EntryWorkspaceRow[];
    table_actions: ActionDef[];
  };
};

export type AccountingEntryDetailsAggregate = {
  aggregate_key: 'accounting_entry_details_aggregate';
  status: { code: 'draft' | 'finalized' | 'archived'; label: string };
  permissions: PermissionBlock;
  entry: {
    id: string;
    entry_type: string;
    description: string | null;
    entry_date: string;
    amount: number;
    currency: string;
    direction: string;
    posting_state: string;
    status: string;
    period: { id: string; label: string; status: string };
    category: { id: string; name: string; type: string };
  };
  linked_entities: {
    columns: TableColumn[];
    rows: Array<{ link_id: string; target_entity_type: string; target_entity_id: string; relation_type: string; created_at: string }>;
    actions: ActionDef[];
  };
  actions: ActionDef[];
};

export type AccountingPeriodsWorkspaceAggregate = {
  aggregate_key: 'accounting_periods_workspace_aggregate';
  status: { code: 'ok' | 'empty'; label: string };
  permissions: PermissionBlock;
  table: {
    columns: TableColumn[];
    rows: Array<{
      period_id: string;
      period_label: string;
      period_start: string;
      period_end: string;
      status: string;
      entries_count: number;
      row_actions: ActionDef[];
    }>;
    table_actions: ActionDef[];
  };
};

export type AccountingCategoriesWorkspaceAggregate = {
  aggregate_key: 'accounting_categories_workspace_aggregate';
  status: { code: 'ok' | 'empty'; label: string };
  permissions: PermissionBlock;
  table: {
    columns: TableColumn[];
    rows: Array<{
      category_id: string;
      code: string;
      name: string;
      category_type: string;
      status: string;
      ownership: 'system' | 'organization';
      usage_count: number;
      row_actions: ActionDef[];
    }>;
    table_actions: ActionDef[];
  };
};

export type AccountingSummaryWorkspaceAggregate = {
  aggregate_key: 'accounting_summary_workspace_aggregate';
  status: { code: 'fresh' | 'empty'; label: string };
  permissions: PermissionBlock;
  sections: {
    totals_by_direction: Array<{ direction: string; amount_total: number; currency: string }>;
    totals_by_period: Array<{ period_id: string; period_label: string; amount_total: number; currency: string }>;
    totals_by_category: Array<{ category_id: string; category_name: string; amount_total: number; currency: string }>;
    metadata: { last_calculated_at: string | null; rows_count: number };
  };
  actions: ActionDef[];
};

function hasPerm(ctx: RequestContext, code: string): boolean {
  return (ctx.membership?.permissions ?? []).includes(code);
}

function getPermissions(ctx: RequestContext): PermissionBlock {
  return {
    can_view: true,
    can_create: hasPerm(ctx, 'accounting_base.entry.write') || hasPerm(ctx, 'accounting_base.period.manage') || hasPerm(ctx, 'accounting_base.category.manage'),
    can_update: hasPerm(ctx, 'accounting_base.entry.write') || hasPerm(ctx, 'accounting_base.category.manage'),
    can_finalize: hasPerm(ctx, 'accounting_base.entry.write'),
    can_archive: hasPerm(ctx, 'accounting_base.entry.write'),
    can_manage_links: hasPerm(ctx, 'accounting_base.link.manage'),
    can_manage_periods: hasPerm(ctx, 'accounting_base.period.manage'),
    can_manage_categories: hasPerm(ctx, 'accounting_base.category.manage'),
    can_recompute_summary: hasPerm(ctx, 'accounting_base.summary.recompute'),
  };
}

function periodMap(periods: AccountingPeriodRow[]): Map<string, AccountingPeriodRow> {
  return new Map(periods.map((p) => [p.id, p]));
}

function categoryMap(categories: AccountingCategoryRow[]): Map<string, AccountingCategoryRow> {
  return new Map(categories.map((c) => [c.id, c]));
}

export async function buildAccountingEntriesWorkspaceAggregate(
  ctx: RequestContext,
  organizationId: string
): Promise<AccountingEntriesWorkspaceAggregate> {
  const agg = await getAccountingBaseRefreshedAggregate(ctx, organizationId);
  const perms = getPermissions(ctx);
  const periods = periodMap(agg.periods);
  const categories = categoryMap(agg.categories);
  const linkIds = new Set(agg.entry_links.map((l) => l.accounting_entry_id));

  const rows: EntryWorkspaceRow[] = agg.entries.map((e) => {
    const p = periods.get(e.period_id);
    const c = categories.get(e.category_id);
    const periodClosed = p?.status === 'closed';
    return {
      entry_id: e.id,
      entry_date: e.entry_date,
      description: e.description,
      period_id: e.period_id,
      period_label: p?.period_label ?? '—',
      category_id: e.category_id,
      category_name: c?.name ?? '—',
      status: e.status,
      posting_state: e.posting_state,
      direction: e.direction,
      amount: e.amount,
      currency: e.currency,
      has_links: linkIds.has(e.id),
      row_actions: [
        {
          action_key: 'update_draft_entry',
          enabled: perms.can_update && e.posting_state === 'draft' && !periodClosed,
          disabled_reason: perms.can_update && e.posting_state === 'draft' && !periodClosed ? null : 'Entry is not editable in current state',
        },
        {
          action_key: 'finalize_entry',
          enabled: perms.can_finalize && e.posting_state === 'draft' && !periodClosed,
          disabled_reason: perms.can_finalize && e.posting_state === 'draft' && !periodClosed ? null : 'Entry cannot be finalized',
        },
        {
          action_key: 'archive_entry',
          enabled: perms.can_archive && e.status !== 'archived' && !periodClosed,
          disabled_reason: perms.can_archive && e.status !== 'archived' && !periodClosed ? null : 'Entry cannot be archived',
        },
        {
          action_key: 'link_entry_to_entity',
          enabled: perms.can_manage_links && !periodClosed,
          disabled_reason: perms.can_manage_links && !periodClosed ? null : 'Links are not editable',
        },
      ],
    };
  });

  return {
    aggregate_key: 'accounting_entries_workspace_aggregate',
    title: 'Accounting Entries',
    status: { code: rows.length ? 'ok' : 'empty', label: rows.length ? 'Entries available' : 'No entries' },
    permissions: perms,
    sections: {
      summary_cards: [
        { key: 'entries_total', label: 'Entries total', value: String(rows.length) },
        { key: 'draft_total', label: 'Draft entries', value: String(rows.filter((r) => r.posting_state === 'draft').length) },
        { key: 'finalized_total', label: 'Finalized entries', value: String(rows.filter((r) => r.posting_state === 'finalized').length) },
      ],
      empty_state: {
        visible: rows.length === 0,
        title: 'No accounting entries yet',
        description: rows.length === 0 ? 'Create your first entry using create_entry command.' : null,
      },
    },
    table: {
      columns: [
        { key: 'entry_date', label: 'Date', width: '12%' },
        { key: 'description', label: 'Description', width: '24%' },
        { key: 'period_label', label: 'Period', width: '12%' },
        { key: 'category_name', label: 'Category', width: '14%' },
        { key: 'direction', label: 'Direction', width: '10%' },
        { key: 'amount', label: 'Amount', width: '12%' },
        { key: 'posting_state', label: 'Posting', width: '8%' },
        { key: 'status', label: 'Status', width: '8%' },
      ],
      rows,
      table_actions: [
        {
          action_key: 'create_entry',
          enabled: perms.can_create,
          disabled_reason: perms.can_create ? null : 'No permission to create entries',
        },
      ],
    },
  };
}

export async function buildAccountingEntryDetailsAggregate(
  ctx: RequestContext,
  organizationId: string,
  entryId: string
): Promise<AccountingEntryDetailsAggregate> {
  const agg = await getAccountingBaseRefreshedAggregate(ctx, organizationId);
  const perms = getPermissions(ctx);
  const entry = agg.entries.find((e) => e.id === entryId);
  if (!entry) throw notFound('Accounting entry not found');

  const period = agg.periods.find((p) => p.id === entry.period_id);
  const category = agg.categories.find((c) => c.id === entry.category_id);
  const links = agg.entry_links.filter((l) => l.accounting_entry_id === entry.id);
  const periodClosed = period?.status === 'closed';

  return {
    aggregate_key: 'accounting_entry_details_aggregate',
    status: {
      code: entry.status === 'archived' ? 'archived' : entry.posting_state === 'finalized' ? 'finalized' : 'draft',
      label: entry.status === 'archived' ? 'Archived' : entry.posting_state === 'finalized' ? 'Finalized' : 'Draft',
    },
    permissions: perms,
    entry: {
      id: entry.id,
      entry_type: entry.entry_type,
      description: entry.description,
      entry_date: entry.entry_date,
      amount: entry.amount,
      currency: entry.currency,
      direction: entry.direction,
      posting_state: entry.posting_state,
      status: entry.status,
      period: {
        id: entry.period_id,
        label: period?.period_label ?? '—',
        status: period?.status ?? 'unknown',
      },
      category: {
        id: entry.category_id,
        name: category?.name ?? '—',
        type: category?.category_type ?? 'unknown',
      },
    },
    linked_entities: {
      columns: [
        { key: 'target_entity_type', label: 'Type', width: '20%' },
        { key: 'target_entity_id', label: 'Entity ID', width: '35%' },
        { key: 'relation_type', label: 'Relation', width: '20%' },
        { key: 'created_at', label: 'Created at', width: '25%' },
      ],
      rows: links.map((l) => ({
        link_id: l.id,
        target_entity_type: l.target_entity_type,
        target_entity_id: l.target_entity_id,
        relation_type: l.relation_type,
        created_at: l.created_at,
      })),
      actions: [
        {
          action_key: 'unlink_entry_from_entity',
          enabled: perms.can_manage_links && !periodClosed,
          disabled_reason: perms.can_manage_links && !periodClosed ? null : 'Cannot remove links in current state',
        },
      ],
    },
    actions: [
      {
        action_key: 'update_draft_entry',
        enabled: perms.can_update && entry.posting_state === 'draft' && !periodClosed,
        disabled_reason: perms.can_update && entry.posting_state === 'draft' && !periodClosed ? null : 'Entry cannot be updated',
      },
      {
        action_key: 'finalize_entry',
        enabled: perms.can_finalize && entry.posting_state === 'draft' && !periodClosed,
        disabled_reason: perms.can_finalize && entry.posting_state === 'draft' && !periodClosed ? null : 'Entry cannot be finalized',
      },
      {
        action_key: 'archive_entry',
        enabled: perms.can_archive && entry.status !== 'archived' && !periodClosed,
        disabled_reason: perms.can_archive && entry.status !== 'archived' && !periodClosed ? null : 'Entry cannot be archived',
      },
      {
        action_key: 'link_entry_to_entity',
        enabled: perms.can_manage_links && !periodClosed,
        disabled_reason: perms.can_manage_links && !periodClosed ? null : 'Entry links cannot be changed',
      },
    ],
  };
}

export async function buildAccountingPeriodsWorkspaceAggregate(
  ctx: RequestContext,
  organizationId: string
): Promise<AccountingPeriodsWorkspaceAggregate> {
  const agg = await getAccountingBaseRefreshedAggregate(ctx, organizationId);
  const perms = getPermissions(ctx);

  const rows = agg.periods.map((p) => {
    const entriesCount = agg.entries.filter((e) => e.period_id === p.id).length;
    return {
      period_id: p.id,
      period_label: p.period_label,
      period_start: p.period_start,
      period_end: p.period_end,
      status: p.status,
      entries_count: entriesCount,
      row_actions: [
        {
          action_key: 'lock_period',
          enabled: perms.can_manage_periods && p.status === 'open',
          disabled_reason: perms.can_manage_periods && p.status === 'open' ? null : 'Period cannot be locked',
        },
        {
          action_key: 'close_period',
          enabled: perms.can_manage_periods && p.status === 'locked',
          disabled_reason: perms.can_manage_periods && p.status === 'locked' ? null : 'Period cannot be closed',
        },
      ],
    };
  });

  return {
    aggregate_key: 'accounting_periods_workspace_aggregate',
    status: { code: rows.length ? 'ok' : 'empty', label: rows.length ? 'Periods available' : 'No periods' },
    permissions: perms,
    table: {
      columns: [
        { key: 'period_label', label: 'Period', width: '24%' },
        { key: 'period_start', label: 'Start', width: '18%' },
        { key: 'period_end', label: 'End', width: '18%' },
        { key: 'status', label: 'Status', width: '20%' },
        { key: 'entries_count', label: 'Entries', width: '20%' },
      ],
      rows,
      table_actions: [
        {
          action_key: 'create_period',
          enabled: perms.can_manage_periods,
          disabled_reason: perms.can_manage_periods ? null : 'No permission to create period',
        },
      ],
    },
  };
}

export async function buildAccountingCategoriesWorkspaceAggregate(
  ctx: RequestContext,
  organizationId: string
): Promise<AccountingCategoriesWorkspaceAggregate> {
  const agg = await getAccountingBaseRefreshedAggregate(ctx, organizationId);
  const perms = getPermissions(ctx);

  const rows = agg.categories.map((c) => {
    const usageCount = agg.entries.filter((e) => e.category_id === c.id).length;
    const isOrg = !c.is_system;
    return {
      category_id: c.id,
      code: c.code,
      name: c.name,
      category_type: c.category_type,
      status: c.status,
      ownership: c.is_system ? ('system' as const) : ('organization' as const),
      usage_count: usageCount,
      row_actions: [
        {
          action_key: 'update_category',
          enabled: perms.can_manage_categories && isOrg,
          disabled_reason: perms.can_manage_categories && isOrg ? null : 'System category cannot be updated',
        },
        {
          action_key: 'deactivate_category',
          enabled: perms.can_manage_categories && isOrg && c.status !== 'inactive',
          disabled_reason: perms.can_manage_categories && isOrg && c.status !== 'inactive' ? null : 'Category cannot be deactivated',
        },
      ],
    };
  });

  return {
    aggregate_key: 'accounting_categories_workspace_aggregate',
    status: { code: rows.length ? 'ok' : 'empty', label: rows.length ? 'Categories available' : 'No categories' },
    permissions: perms,
    table: {
      columns: [
        { key: 'code', label: 'Code', width: '14%' },
        { key: 'name', label: 'Name', width: '30%' },
        { key: 'category_type', label: 'Type', width: '16%' },
        { key: 'status', label: 'Status', width: '12%' },
        { key: 'ownership', label: 'Ownership', width: '12%' },
        { key: 'usage_count', label: 'Usage', width: '16%' },
      ],
      rows,
      table_actions: [
        {
          action_key: 'create_category',
          enabled: perms.can_manage_categories,
          disabled_reason: perms.can_manage_categories ? null : 'No permission to create category',
        },
      ],
    },
  };
}

function sumEntries(entries: AccountingEntryRow[]): Map<string, number> {
  const byCurrency = new Map<string, number>();
  for (const e of entries) {
    const sign = e.direction === 'credit' ? 1 : -1;
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + sign * e.amount);
  }
  return byCurrency;
}

export async function buildAccountingSummaryWorkspaceAggregate(
  ctx: RequestContext,
  organizationId: string
): Promise<AccountingSummaryWorkspaceAggregate> {
  const agg: AccountingBaseRefreshedAggregate = await getAccountingBaseRefreshedAggregate(ctx, organizationId);
  const perms = getPermissions(ctx);
  const categories = categoryMap(agg.categories);
  const periods = periodMap(agg.periods);

  const totalsByDirectionMap = new Map<string, number>();
  for (const e of agg.entries) {
    totalsByDirectionMap.set(e.direction, (totalsByDirectionMap.get(e.direction) ?? 0) + e.amount);
  }

  const byPeriod = new Map<string, { amount_total: number; currency: string }>();
  for (const e of agg.entries) {
    const prev = byPeriod.get(e.period_id);
    byPeriod.set(e.period_id, {
      amount_total: (prev?.amount_total ?? 0) + e.amount,
      currency: prev?.currency ?? e.currency,
    });
  }

  const byCategory = new Map<string, { amount_total: number; currency: string }>();
  for (const e of agg.entries) {
    const prev = byCategory.get(e.category_id);
    byCategory.set(e.category_id, {
      amount_total: (prev?.amount_total ?? 0) + e.amount,
      currency: prev?.currency ?? e.currency,
    });
  }

  const latestCalculatedAt = agg.summaries.length
    ? agg.summaries
        .map((s) => s.calculated_at)
        .sort((a, b) => (a > b ? -1 : 1))[0]
    : null;

  return {
    aggregate_key: 'accounting_summary_workspace_aggregate',
    status: {
      code: agg.entries.length ? 'fresh' : 'empty',
      label: agg.entries.length ? 'Summary available' : 'No data for summary',
    },
    permissions: perms,
    sections: {
      totals_by_direction: Array.from(totalsByDirectionMap.entries()).map(([direction, amount_total]) => ({
        direction,
        amount_total,
        currency: agg.entries[0]?.currency ?? 'ILS',
      })),
      totals_by_period: Array.from(byPeriod.entries()).map(([periodId, v]) => ({
        period_id: periodId,
        period_label: periods.get(periodId)?.period_label ?? '—',
        amount_total: v.amount_total,
        currency: v.currency,
      })),
      totals_by_category: Array.from(byCategory.entries()).map(([categoryId, v]) => ({
        category_id: categoryId,
        category_name: categories.get(categoryId)?.name ?? '—',
        amount_total: v.amount_total,
        currency: v.currency,
      })),
      metadata: {
        last_calculated_at: latestCalculatedAt,
        rows_count: agg.summaries.length,
      },
    },
    actions: [
      {
        action_key: 'recompute_summary',
        enabled: perms.can_recompute_summary,
        disabled_reason: perms.can_recompute_summary ? null : 'No permission to recompute summary',
      },
    ],
  };
}

export async function buildAccountingBaseWorkspaceAggregates(
  ctx: RequestContext,
  organizationId: string
): Promise<{
  accounting_entries_workspace_aggregate: AccountingEntriesWorkspaceAggregate;
  accounting_periods_workspace_aggregate: AccountingPeriodsWorkspaceAggregate;
  accounting_categories_workspace_aggregate: AccountingCategoriesWorkspaceAggregate;
  accounting_summary_workspace_aggregate: AccountingSummaryWorkspaceAggregate;
}> {
  const [entries, periods, categories, summary] = await Promise.all([
    buildAccountingEntriesWorkspaceAggregate(ctx, organizationId),
    buildAccountingPeriodsWorkspaceAggregate(ctx, organizationId),
    buildAccountingCategoriesWorkspaceAggregate(ctx, organizationId),
    buildAccountingSummaryWorkspaceAggregate(ctx, organizationId),
  ]);

  return {
    accounting_entries_workspace_aggregate: entries,
    accounting_periods_workspace_aggregate: periods,
    accounting_categories_workspace_aggregate: categories,
    accounting_summary_workspace_aggregate: summary,
  };
}
