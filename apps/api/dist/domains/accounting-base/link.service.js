import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreateLink(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_entry_links')
        .insert({
        organization_id: organizationId,
        accounting_entry_id: input.accounting_entry_id,
        target_entity_type: input.target_entity_type,
        target_entity_id: input.target_entity_id,
        relation_type: input.relation_type,
        created_by: ctx.user.id,
    })
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function forCommandDeleteLink(ctx, organizationId, linkId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_entry_links')
        .delete()
        .eq('id', linkId)
        .eq('organization_id', organizationId)
        .select('id')
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting entry link not found');
    return { deleted: true };
}
export async function forCommandListLinksByEntry(ctx, organizationId, entryId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_entry_links')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('accounting_entry_id', entryId)
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return (data ?? []);
}
