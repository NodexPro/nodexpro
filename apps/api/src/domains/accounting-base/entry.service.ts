import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { assertOrgInContext, assertPositiveAmount } from './accounting-base.guards.js';
import type { AccountingEntryRow, AccountingDirection, AccountingEntryPostingState, AccountingEntryStatus } from './accounting-base.types.js';

type CreateEntryInput = {
  period_id: string;
  category_id: string;
  client_id?: string | null;
  entry_type: string;
  status?: AccountingEntryStatus;
  posting_state?: AccountingEntryPostingState;
  description?: string | null;
  entry_date: string;
  amount: number;
  currency: string;
  direction: AccountingDirection;
  source_type?: string | null;
};

type UpdateEntryInput = Partial<
  Pick<
    AccountingEntryRow,
    | 'period_id'
    | 'category_id'
    | 'client_id'
    | 'entry_type'
    | 'status'
    | 'posting_state'
    | 'description'
    | 'entry_date'
    | 'amount'
    | 'currency'
    | 'direction'
    | 'source_type'
    | 'finalized_at'
    | 'finalized_by'
  >
>;

const ALLOWED_ENTRY_TYPES = new Set(['income', 'expense', 'refund']);

function assertEntryTypeDirectionConsistency(entryType: string, direction: AccountingDirection): void {
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
export async function forCommandCreateEntry(
  ctx: RequestContext,
  organizationId: string,
  input: CreateEntryInput
): Promise<AccountingEntryRow> {
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
  if (error) throw error;
  return data as AccountingEntryRow;
}

export async function forCommandUpdateEntry(
  ctx: RequestContext,
  organizationId: string,
  entryId: string,
  patch: UpdateEntryInput
): Promise<AccountingEntryRow> {
  assertOrgInContext(ctx, organizationId);
  if (typeof patch.amount === 'number') assertPositiveAmount(patch.amount);

  const { data: current, error: currentError } = await supabaseAdmin
    .from('accounting_entries')
    .select('entry_type, direction')
    .eq('id', entryId)
    .eq('organization_id', organizationId)
    .single();
  if (currentError) throw currentError;
  if (!current) throw notFound('Accounting entry not found');

  const nextEntryType = (patch.entry_type ?? current.entry_type) as string;
  const nextDirection = (patch.direction ?? current.direction) as AccountingDirection;
  assertEntryTypeDirectionConsistency(nextEntryType, nextDirection);

  const { data, error } = await supabaseAdmin
    .from('accounting_entries')
    .update(patch)
    .eq('id', entryId)
    .eq('organization_id', organizationId)
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting entry not found');
  return data as AccountingEntryRow;
}

export async function forCommandGetEntry(ctx: RequestContext, organizationId: string, entryId: string): Promise<AccountingEntryRow> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_entries')
    .select('*')
    .eq('id', entryId)
    .eq('organization_id', organizationId)
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting entry not found');
  return data as AccountingEntryRow;
}
