/**
 * Client Operations registry — NI deductions (102/100 monthly + 126 cycle).
 * Batch loaders + named commands. Caller returns refreshed registry aggregate.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { isOperationalPeriodKey } from './client-operations-operational-period.pure.js';
import {
  buildNiDeductionsRegistryCell,
  resolveOutstandingNiDeductions126Cycles,
  selectNextNiDeductions126CycleToComplete,
  type NiDeductions126CycleFact,
  type NiDeductions126CycleRef,
  type NiDeductionsRegistryCell,
} from './client-operations-ni-deductions-126.pure.js';

export type { NiDeductionsRegistryCell };

type NiPeriodFlags = {
  reported_102: boolean;
  reported_100: boolean;
  paid: boolean;
  payroll_in_progress: boolean;
  reminder_suppressed: boolean;
  not_relevant: boolean;
  auto_reminder_last_shown_at: string | null;
  all_completed_at: string | null;
};

function assertOrg(ctx: RequestContext): string {
  if (!ctx.organizationId) throw forbidden('Active organization required');
  return ctx.organizationId;
}

function assertEdit(ctx: RequestContext): void {
  if (!ctx.membership?.permissions?.includes('client_operations.edit')) {
    throw forbidden('client_operations.edit permission required');
  }
}

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: assertOrg(ctx),
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_ni_deductions',
    entityId,
    action,
    payload,
  });
}

async function ensureActiveClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .eq('is_archived', false)
    .maybeSingle();
  assertQueryError(error, 'Failed to validate client');
  if (!data) throw forbidden('Client not found');
}

function emptyNiPeriodFlags(): NiPeriodFlags {
  return {
    reported_102: false,
    reported_100: false,
    paid: false,
    payroll_in_progress: false,
    reminder_suppressed: false,
    not_relevant: false,
    auto_reminder_last_shown_at: null,
    all_completed_at: null,
  };
}

function flagsFromRow(row: Record<string, unknown> | null | undefined): NiPeriodFlags {
  if (!row) return emptyNiPeriodFlags();
  return {
    reported_102: Boolean(row.reported_102),
    reported_100: Boolean(row.reported_100),
    paid: Boolean(row.paid),
    payroll_in_progress: Boolean(row.payroll_in_progress),
    reminder_suppressed: Boolean(row.reminder_suppressed),
    not_relevant: Boolean(row.not_relevant),
    auto_reminder_last_shown_at: (row.auto_reminder_last_shown_at as string | null) ?? null,
    all_completed_at: (row.all_completed_at as string | null) ?? null,
  };
}

/** Batch monthly 102/100 facts (period_key = operational YYYY-MM). */
export async function loadNiDeductionsPeriodFlagsForClients(input: {
  organizationId: string;
  clientIds: string[];
  operationalPeriodKey: string;
}): Promise<Map<string, NiPeriodFlags>> {
  const out = new Map<string, NiPeriodFlags>();
  if (input.clientIds.length === 0) return out;
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  const { data, error } = await supabaseAdmin
    .from('client_ni_deductions_period')
    .select(
      'client_id, reported_102, reported_100, paid, payroll_in_progress, reminder_suppressed, not_relevant, auto_reminder_last_shown_at, all_completed_at',
    )
    .eq('organization_id', input.organizationId)
    .eq('period_key', input.operationalPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load NI deductions period flags');
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(String(row.client_id), flagsFromRow(row));
  }
  return out;
}

/** Batch 126 cycle facts for visible clients. */
export async function loadNiDeductions126CycleFactsForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, NiDeductions126CycleFact[]>> {
  const out = new Map<string, NiDeductions126CycleFact[]>();
  if (input.clientIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('client_ni_deductions_126_cycles')
    .select('client_id, reporting_year, cycle_type, completed')
    .eq('organization_id', input.organizationId)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load NI deductions 126 cycles');
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = String(row.client_id);
    const list = out.get(clientId) ?? [];
    list.push({
      reporting_year: Number(row.reporting_year),
      cycle_type: row.cycle_type === 'annual' ? 'annual' : 'h1',
      completed: Boolean(row.completed),
    });
    out.set(clientId, list);
  }
  return out;
}

/**
 * Batch earliest known NI-deductions applicable operational period per client.
 * READ-ONLY existing frozen snapshots — does not ensure/invent historical months.
 * YYYY-MM lexicographic order = chronological order.
 */
export async function loadEarliestNiDeductionsApplicablePeriodKeysForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (input.clientIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('client_operations_period_applicability_snapshots')
    .select('client_id, operational_period_key')
    .eq('organization_id', input.organizationId)
    .eq('national_insurance_deductions_applicable', true)
    .in('client_id', input.clientIds)
    .order('operational_period_key', { ascending: true });
  assertQueryError(error, 'Failed to load earliest NI deductions applicable periods');
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = String(row.client_id);
    if (out.has(clientId)) continue;
    const key = String(row.operational_period_key ?? '').trim();
    if (!isOperationalPeriodKey(key)) continue;
    out.set(clientId, key);
  }
  return out;
}

export function buildNiDeductionsRegistryCellForClient(input: {
  applicable: boolean;
  periodFlags: NiPeriodFlags | undefined;
  cycleFacts: NiDeductions126CycleFact[] | undefined;
  operationalPeriodKey: string;
  earliestApplicablePeriodKey: string | null;
}): NiDeductionsRegistryCell {
  const outstanding = input.applicable
    ? resolveOutstandingNiDeductions126Cycles({
        operationalPeriodKey: input.operationalPeriodKey,
        storedFacts: input.cycleFacts ?? [],
        earliestApplicablePeriodKey: input.earliestApplicablePeriodKey,
      })
    : [];
  return buildNiDeductionsRegistryCell({
    applicable: input.applicable,
    reported102: input.periodFlags?.reported_102 ?? false,
    reported100: input.periodFlags?.reported_100 ?? false,
    outstanding126: outstanding,
  });
}

async function persistNiPeriodFlags(input: {
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  next: NiPeriodFlags;
  nowIso: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_ni_deductions_period').upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      period_key: input.operationalPeriodKey,
      reported_102: input.next.reported_102,
      reported_100: input.next.reported_100,
      paid: input.next.paid,
      payroll_in_progress: input.next.payroll_in_progress,
      reminder_suppressed: input.next.reminder_suppressed,
      not_relevant: input.next.not_relevant,
      auto_reminder_last_shown_at: input.next.auto_reminder_last_shown_at,
      all_completed_at: input.next.all_completed_at,
      updated_at: input.nowIso,
    },
    { onConflict: 'organization_id,client_id,period_key' },
  );
  assertQueryError(error, 'Failed to persist NI deductions period flags');
}

/** Toggle monthly 102/100 — canonical client_ni_deductions_period ownership. */
export async function setNiDeductionsReportedStepForRegistry(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey: string;
  step: 'reported_102' | 'reported_100';
  enabled: boolean;
}): Promise<{ period_key: string; step: string; enabled: boolean }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  await ensureActiveClientInOrg(orgId, input.clientId);
  const nowIso = new Date().toISOString();
  const map = await loadNiDeductionsPeriodFlagsForClients({
    organizationId: orgId,
    clientIds: [input.clientId],
    operationalPeriodKey: input.operationalPeriodKey,
  });
  const cur = map.get(input.clientId) ?? emptyNiPeriodFlags();
  if (cur.not_relevant) throw badRequest('ni_deductions marked not relevant for period');
  const next: NiPeriodFlags = { ...cur };
  if (input.step === 'reported_102') next.reported_102 = input.enabled;
  if (input.step === 'reported_100') next.reported_100 = input.enabled;
  if (!input.enabled) next.paid = false;
  if (!(next.reported_102 && next.reported_100 && next.paid)) {
    next.all_completed_at = null;
  }
  await persistNiPeriodFlags({
    organizationId: orgId,
    clientId: input.clientId,
    operationalPeriodKey: input.operationalPeriodKey,
    next,
    nowIso,
  });
  const action =
    input.step === 'reported_102'
      ? AUDIT_ACTIONS.CLIENT_OPERATIONS_NI_DEDUCTIONS_102_SET
      : AUDIT_ACTIONS.CLIENT_OPERATIONS_NI_DEDUCTIONS_100_SET;
  await audit(input.ctx, action, input.clientId, {
    client_id: input.clientId,
    operational_period_key: input.operationalPeriodKey,
    step: input.step,
    enabled: input.enabled,
  });
  return {
    period_key: input.operationalPeriodKey,
    step: input.step,
    enabled: input.enabled,
  };
}

/** Complete oldest outstanding activated 126 cycle for this operational period. */
export async function completeNiDeductions126CycleForRegistry(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey: string;
}): Promise<{
  reporting_year: number;
  cycle_type: 'h1' | 'annual';
  remaining_outstanding_count: number;
}> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  await ensureActiveClientInOrg(orgId, input.clientId);

  const [factsMap, earliestMap] = await Promise.all([
    loadNiDeductions126CycleFactsForClients({
      organizationId: orgId,
      clientIds: [input.clientId],
    }),
    loadEarliestNiDeductionsApplicablePeriodKeysForClients({
      organizationId: orgId,
      clientIds: [input.clientId],
    }),
  ]);
  const storedFacts = factsMap.get(input.clientId) ?? [];
  const outstanding = resolveOutstandingNiDeductions126Cycles({
    operationalPeriodKey: input.operationalPeriodKey,
    storedFacts,
    earliestApplicablePeriodKey: earliestMap.get(input.clientId) ?? null,
  });
  const target: NiDeductions126CycleRef | null = selectNextNiDeductions126CycleToComplete(outstanding);
  if (!target) {
    throw badRequest('No applicable outstanding Form 126 cycle for this period');
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('client_ni_deductions_126_cycles')
    .upsert(
      {
        organization_id: orgId,
        client_id: input.clientId,
        reporting_year: target.reporting_year,
        cycle_type: target.cycle_type,
        completed: true,
        completed_at: nowIso,
        completed_by: input.ctx.user.id,
        updated_at: nowIso,
        updated_by: input.ctx.user.id,
        created_by: input.ctx.user.id,
      },
      { onConflict: 'organization_id,client_id,reporting_year,cycle_type' },
    )
    .select('id')
    .maybeSingle();
  assertQueryError(error, 'Failed to complete Form 126 cycle');

  const remaining = outstanding.filter(
    (c) => !(c.reporting_year === target.reporting_year && c.cycle_type === target.cycle_type),
  );

  await audit(
    input.ctx,
    AUDIT_ACTIONS.CLIENT_OPERATIONS_NI_DEDUCTIONS_126_CYCLE_COMPLETED,
    data?.id ? String(data.id) : input.clientId,
    {
      client_id: input.clientId,
      operational_period_key: input.operationalPeriodKey,
      reporting_year: target.reporting_year,
      cycle_type: target.cycle_type,
      remaining_outstanding_count: remaining.length,
    },
  );

  return {
    reporting_year: target.reporting_year,
    cycle_type: target.cycle_type,
    remaining_outstanding_count: remaining.length,
  };
}
