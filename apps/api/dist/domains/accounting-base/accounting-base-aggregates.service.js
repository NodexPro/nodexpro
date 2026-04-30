import { supabaseAdmin } from '../../db/client.js';
import { assertOrgInContext } from './accounting-base.guards.js';
/**
 * Internal aggregate refresh for command flow.
 * Source for future command responses until dedicated read models are introduced.
 */
export async function getAccountingBaseRefreshedAggregate(ctx, organizationId) {
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
    if (periodsRes.error)
        throw periodsRes.error;
    if (categoriesRes.error)
        throw categoriesRes.error;
    if (entriesRes.error)
        throw entriesRes.error;
    if (linksRes.error)
        throw linksRes.error;
    if (summariesRes.error)
        throw summariesRes.error;
    return {
        organization_id: organizationId,
        periods: (periodsRes.data ?? []),
        categories: (categoriesRes.data ?? []),
        entries: (entriesRes.data ?? []),
        entry_links: (linksRes.data ?? []),
        summaries: (summariesRes.data ?? []),
    };
}
