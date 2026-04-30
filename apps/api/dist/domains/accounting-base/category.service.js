import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreateCategory(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_categories')
        .insert({
        organization_id: organizationId,
        code: input.code,
        name: input.name,
        category_type: input.category_type,
        status: input.status ?? 'active',
        is_system: false,
        parent_category_id: input.parent_category_id ?? null,
    })
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function forCommandUpdateCategory(ctx, organizationId, categoryId, patch) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_categories')
        .update(patch)
        .eq('id', categoryId)
        .eq('organization_id', organizationId)
        .eq('is_system', false)
        .select('*')
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting category not found');
    return data;
}
export async function forCommandGetCategory(ctx, organizationId, categoryId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_categories')
        .select('*')
        .eq('id', categoryId)
        .or(`is_system.eq.true,organization_id.eq.${organizationId}`)
        .single();
    if (error)
        throw error;
    if (!data)
        throw notFound('Accounting category not found');
    return data;
}
