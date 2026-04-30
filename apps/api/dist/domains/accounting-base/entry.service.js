import { supabaseAdmin } from '../../db/client.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { assertOrgInContext, assertPositiveAmount } from './accounting-base.guards.js';
const ALLOWED_ENTRY_TYPES = new Set(['income', 'expense', 'refund']);
function assertEntryTypeDirectionConsistency(entryType, direction) {
    if (!ALLOWED_ENTRY_TYPES.has(entryType)) {
        throw badRequest('entry_type must be one of: income, expense, refund');
    }
    // Accounting Base rule: refund (זיכוי / returned money) is outflow-only.
    if (entryType === 'refund' && direction !== 'debit') {
        throw badRequest('refund direction must be debit (outflow)');
    }
}
/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreateEntry(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    assertPositiveAmount(input.amount);
    assertEntryTypeDirectionConsistency(input.entry_type, input.direction);
    const postingState = input.posting_state ?? 'draft';
    const isFinalized = postingState === 'finalized';
    const { data, error } = await supabaseAdmin
        .from('accounting_entries')
        .insert({
        organization_id: organizationId,
        period_id: input.period_id,
        category_id: input.category_id,
        client_id: input.client_id ?? null,
        entry_type: input.entry_type,
        status: input.status ?? 'active',
        posting_state: postingState,
        description: input.description ?? null,
        entry_date: input.entry_date,
        amount: input.amount,
        currency: input.currency,
        direction: input.direction,
        source_type: input.source_type ?? null,
        created_by: ctx.user.id,
        finalized_at: isFinalized ? new Date().toISOString() : null,
        finalized_by: isFinalized ? ctx.user.id : null,
        is_archived: (input.status ?? 'active') === 'archived',
    })
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function forCommandUpdateEntry(ctx, organizationId, entryId, patch) {
    assertOrgInContext(ctx, organizationId);
    if (typeof patch.amount === 'number')
        assertPositiveAmount(patch.amount);
    const { data: current, error: currentError } = await supabaseAdmin
        .from('accounting_entries')
        .select('entry_type, direction')
        .eq('id', entryId)
        .eq('organization_id', organizationId)
        .single();
    if (currentError)
        throw currentError;
    if (!current)
        throw notFound('Accounting entry not found');
    const nextEntryType = (patch.entry_type ?? current.entry_type);
    const nextDirection = (patch.direction ?? current.direction);
    assertEntryTypeDirectionConsistency(nextEntryType, nextDirection);
    const { data, error } = await supabaseAdmin
        .from('accounting_entries')
        .update(patch)
        .eq('id', entryId)
        .eq('organization_id', organizationId)
        .select('*')
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting entry not found');
    return data;
}
export async function forCommandGetEntry(ctx, organizationId, entryId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_entries')
        .select('*')
        .eq('id', entryId)
        .eq('organization_id', organizationId)
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting entry not found');
    return data;
}
