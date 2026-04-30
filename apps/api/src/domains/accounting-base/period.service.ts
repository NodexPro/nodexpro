import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { notFound } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import type { AccountingPeriodRow, AccountingPeriodStatus } from './accounting-base.types.js';

type CreatePeriodInput = {
  period_start: string;
  period_end: string;
  period_label: string;
  base_currency: string;
  status?: AccountingPeriodStatus;
};

type UpdatePeriodInput = Partial<Pick<AccountingPeriodRow, 'period_start' | 'period_end' | 'period_label' | 'base_currency' | 'status' | 'closed_at' | 'closed_by'>>;

/**
 * Internal-only service for future command handlers.
 * Do not expose directly via routes/controllers.
 */
export async function forCommandCreatePeriod(ctx: RequestContext, organizationId: string, input: CreatePeriodInput): Promise<AccountingPeriodRow> {
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
  if (error) throw error;
  return data as AccountingPeriodRow;
}

export async function forCommandUpdatePeriod(
  ctx: RequestContext,
  organizationId: string,
  periodId: string,
  patch: UpdatePeriodInput
): Promise<AccountingPeriodRow> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_periods')
    .update(patch)
    .eq('id', periodId)
    .eq('organization_id', organizationId)
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting period not found');
  return data as AccountingPeriodRow;
}

export async function forCommandGetPeriod(ctx: RequestContext, organizationId: string, periodId: string): Promise<AccountingPeriodRow> {
  assertOrgInContext(ctx, organizationId);

  const { data, error } = await supabaseAdmin
    .from('accounting_periods')
    .select('*')
    .eq('id', periodId)
    .eq('organization_id', organizationId)
    .single();
  if (error) throw error;
  if (!data) throw notFound('Accounting period not found');
  return data as AccountingPeriodRow;
}
