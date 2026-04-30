import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreatePeriod(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    const payload = {
        organization_id: organizationId,
        period_start: input.period_start,
        period_end: input.period_end,
        period_label: input.period_label,
        base_currency: input.base_currency,
        status: input.status ?? 'open',
    };
    const { data, error } = await supabaseAdmin.from('accounting_periods').insert(payload).select('*').single();
    if (error)
        throw error;
    return data;
}
export async function forCommandUpdatePeriod(ctx, organizationId, periodId, patch) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_periods')
        .update(patch)
        .eq('id', periodId)
        .eq('organization_id', organizationId)
        .select('*')
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting period not found');
    return data;
}
export async function forCommandGetPeriod(ctx, organizationId, periodId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_periods')
        .select('*')
        .eq('id', periodId)
        .eq('organization_id', organizationId)
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting period not found');
    return data;
}
