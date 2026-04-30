import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import type { AccountingCategoryRow } from './accounting-base.types.js';

type CreateCategoryInput = {
  code: string;
  name: string;
  category_type: string;
  status?: 'active' | 'inactive';
  parent_category_id?: string | null;
};

type UpdateCategoryInput = Partial<Pick<AccountingCategoryRow, 'code' | 'name' | 'category_type' | 'status' | 'parent_category_id'>>;

/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreateCategory(
  ctx: RequestContext,
  organizationId: string,
  input: CreateCategoryInput
): Promise<AccountingCategoryRow> {
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
  if (error) throw error;
  return data as AccountingCategoryRow;
}

export async function forCommandUpdateCategory(
  ctx: RequestContext,
  organizationId: string,
  categoryId: string,
  patch: UpdateCategoryInput
): Promise<AccountingCategoryRow> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_categories')
    .update(patch)
    .eq('id', categoryId)
    .eq('organization_id', organizationId)
    .eq('is_system', false)
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting category not found');
  return data as AccountingCategoryRow;
}

export async function forCommandGetCategory(
  ctx: RequestContext,
  organizationId: string,
  categoryId: string
): Promise<AccountingCategoryRow> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_categories')
    .select('*')
    .eq('id', categoryId)
    .or(`is_system.eq.true,organization_id.eq.${organizationId}`)
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting category not found');
  return data as AccountingCategoryRow;
}
