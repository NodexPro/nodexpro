import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import type { AccountingEntryLinkRow } from './accounting-base.types.js';

type CreateLinkInput = {
  accounting_entry_id: string;
  target_entity_type: string;
  target_entity_id: string;
  relation_type: string;
};

/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreateLink(
  ctx: RequestContext,
  organizationId: string,
  input: CreateLinkInput
): Promise<AccountingEntryLinkRow> {
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
  if (error) throw error;
  return data as AccountingEntryLinkRow;
}

export async function forCommandDeleteLink(
  ctx: RequestContext,
  organizationId: string,
  linkId: string
): Promise<{ deleted: true }> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_entry_links')
    .delete()
    .eq('id', linkId)
    .eq('organization_id', organizationId)
    .select('id')
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting entry link not found');

  return { deleted: true };
}

export async function forCommandListLinksByEntry(
  ctx: RequestContext,
  organizationId: string,
  entryId: string
): Promise<AccountingEntryLinkRow[]> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_entry_links')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('accounting_entry_id', entryId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccountingEntryLinkRow[];
}
