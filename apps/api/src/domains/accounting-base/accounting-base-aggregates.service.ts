import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import type {
  AccountingCategoryRow,
  AccountingEntryLinkRow,
  AccountingEntryRow,
  AccountingPeriodRow,
  AccountingSummaryRow,
} from './accounting-base.types.js';

export type AccountingBaseRefreshedAggregate = {
  organization_id: string;
  periods: AccountingPeriodRow[];
  categories: AccountingCategoryRow[];
  entries: AccountingEntryRow[];
  entry_links: AccountingEntryLinkRow[];
  summaries: AccountingSummaryRow[];
};

/**
 * Internal aggregate refresh for command flow.
 * Source for future command responses until dedicated read models are introduced.
 */
export async function getAccountingBaseRefreshedAggregate(
  ctx: RequestContext,
  organizationId: string
): Promise<AccountingBaseRefreshedAggregate> {
  assertOrgInContext(ctx, organizationId);

  const [periodsRes, categoriesRes, entriesRes, linksRes, summariesRes] = await Promise.all([
    supabaseAdmin
      .from('accounting_periods')
      .select('*')
      .eq('organization_id', organizationId)
      .order('period_start', { ascending: false }),
    supabaseAdmin
      .from('accounting_categories')
      .select('*')
      .or(`is_system.eq.true,organization_id.eq.${organizationId}`)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('accounting_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('accounting_entry_links')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('accounting_summaries')
      .select('*')
      .eq('organization_id', organizationId)
      .order('calculated_at', { ascending: false }),
  ]);

  if (periodsRes.error) throw periodsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (linksRes.error) throw linksRes.error;
  if (summariesRes.error) throw summariesRes.error;

  return {
    organization_id: organizationId,
    periods: (periodsRes.data ?? []) as AccountingPeriodRow[],
    categories: (categoriesRes.data ?? []) as AccountingCategoryRow[],
    entries: (entriesRes.data ?? []) as AccountingEntryRow[],
    entry_links: (linksRes.data ?? []) as AccountingEntryLinkRow[],
    summaries: (summariesRes.data ?? []) as AccountingSummaryRow[],
  };
}
