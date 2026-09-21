/**
 * Client Operations — operational period persistence (Phase 1).
 * Batch-first snapshot ensure + material facts load/upsert.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  buildAvailableOperationalPeriods,
  clientExistsInOperationalPeriod,
  computeOperationalPeriodApplicability,
  isOperationalPeriodKey,
  resolveDefaultOperationalPeriodKey,
  type OperationalPeriodSnapshotInputs,
} from './client-operations-operational-period.pure.js';

export type PeriodApplicabilitySnapshotRow = {
  organization_id: string;
  client_id: string;
  operational_period_key: string;
  vat_type: string | null;
  vat_frequency: string | null;
  payroll_flag: boolean | null;
  income_tax_advance_enabled: boolean | null;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean | null;
  income_tax_deductions_frequency: string | null;
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
  vat_applicable: boolean;
  payroll_applicable: boolean;
  income_tax_advance_applicable: boolean;
  income_tax_deductions_applicable: boolean;
  national_insurance_applicable: boolean;
  national_insurance_deductions_applicable: boolean;
  row_visible: boolean;
  client_created_at: string | null;
  captured_at: string;
};

export type ClientPeriodSourceRow = {
  client_id: string;
  client_created_at: string | null;
  inputs: OperationalPeriodSnapshotInputs;
};

function assertQueryError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new AppError(500, error.message || fallback, 'SUPABASE_ERROR');
}

export function resolveRegistryOperationalPeriodKey(
  requested: string | null | undefined,
  now: Date = new Date(),
): string {
  const defaultKey = resolveDefaultOperationalPeriodKey(now);
  if (requested == null || requested === '') return defaultKey;
  if (!isOperationalPeriodKey(requested)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  return requested;
}

export async function loadPeriodApplicabilitySnapshots(input: {
  organizationId: string;
  operationalPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, PeriodApplicabilitySnapshotRow>> {
  const out = new Map<string, PeriodApplicabilitySnapshotRow>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_operations_period_applicability_snapshots')
    .select(
      [
        'organization_id',
        'client_id',
        'operational_period_key',
        'vat_type',
        'vat_frequency',
        'payroll_flag',
        'income_tax_advance_enabled',
        'income_tax_advance_frequency',
        'income_tax_deductions_enabled',
        'income_tax_deductions_frequency',
        'national_insurance_type',
        'national_insurance_monthly_amount',
        'national_insurance_deductions_file_number',
        'vat_applicable',
        'payroll_applicable',
        'income_tax_advance_applicable',
        'income_tax_deductions_applicable',
        'national_insurance_applicable',
        'national_insurance_deductions_applicable',
        'row_visible',
        'client_created_at',
        'captured_at',
      ].join(', '),
    )
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load period applicability snapshots');
  for (const row of (data ?? []) as unknown as PeriodApplicabilitySnapshotRow[]) {
    out.set(row.client_id, row);
  }
  return out;
}

export async function loadPeriodMaterialFacts(input: {
  organizationId: string;
  operationalPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_operations_period_material_facts')
    .select('client_id, material_brought')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load period material facts');
  for (const row of (data ?? []) as Array<{ client_id: string; material_brought: boolean }>) {
    out.set(row.client_id, Boolean(row.material_brought));
  }
  return out;
}

/**
 * Frozen historical membership for a period = clients with an applicability
 * snapshot and/or a material fact row. Used so archived clients remain visible
 * in historical periods without inventing engagement history.
 */
export async function loadPeriodMembershipClientIds(input: {
  organizationId: string;
  operationalPeriodKey: string;
}): Promise<string[]> {
  const [snap, mats] = await Promise.all([
    supabaseAdmin
      .from('client_operations_period_applicability_snapshots')
      .select('client_id')
      .eq('organization_id', input.organizationId)
      .eq('operational_period_key', input.operationalPeriodKey),
    supabaseAdmin
      .from('client_operations_period_material_facts')
      .select('client_id')
      .eq('organization_id', input.organizationId)
      .eq('operational_period_key', input.operationalPeriodKey),
  ]);
  assertQueryError(snap.error, 'Failed to load period snapshot membership');
  assertQueryError(mats.error, 'Failed to load period material membership');
  return [
    ...new Set(
      [
        ...((snap.data ?? []) as Array<{ client_id: string }>),
        ...((mats.data ?? []) as Array<{ client_id: string }>),
      ].map((r) => r.client_id),
    ),
  ];
}

export async function listKnownOperationalPeriodKeys(organizationId: string): Promise<string[]> {
  const [snap, mats] = await Promise.all([
    supabaseAdmin
      .from('client_operations_period_applicability_snapshots')
      .select('operational_period_key')
      .eq('organization_id', organizationId),
    supabaseAdmin
      .from('client_operations_period_material_facts')
      .select('operational_period_key')
      .eq('organization_id', organizationId),
  ]);
  assertQueryError(snap.error, 'Failed to list snapshot periods');
  assertQueryError(mats.error, 'Failed to list material periods');
  const keys = [
    ...((snap.data ?? []) as Array<{ operational_period_key: string }>),
    ...((mats.data ?? []) as Array<{ operational_period_key: string }>),
  ].map((r) => r.operational_period_key);
  return buildAvailableOperationalPeriods({
    default_period_key: resolveDefaultOperationalPeriodKey(),
    known_period_keys: keys,
  });
}

/**
 * Ensure snapshots exist for clients eligible in this period.
 * Existing snapshots are never rewritten (DB freeze trigger + skip-if-present).
 */
export async function ensurePeriodApplicabilitySnapshots(input: {
  organizationId: string;
  operationalPeriodKey: string;
  sources: ClientPeriodSourceRow[];
  existing: Map<string, PeriodApplicabilitySnapshotRow>;
}): Promise<Map<string, PeriodApplicabilitySnapshotRow>> {
  const result = new Map(input.existing);
  const toInsert: Array<Record<string, unknown>> = [];
  const capturedAt = new Date().toISOString();

  for (const source of input.sources) {
    if (result.has(source.client_id)) continue;
    if (
      !clientExistsInOperationalPeriod({
        client_created_at: source.client_created_at,
        operational_period_key: input.operationalPeriodKey,
      })
    ) {
      continue;
    }
    const appl = computeOperationalPeriodApplicability(input.operationalPeriodKey, source.inputs);
    const row: PeriodApplicabilitySnapshotRow = {
      organization_id: input.organizationId,
      client_id: source.client_id,
      operational_period_key: input.operationalPeriodKey,
      vat_type: source.inputs.vat_type,
      vat_frequency: source.inputs.vat_frequency,
      payroll_flag: source.inputs.payroll_flag,
      income_tax_advance_enabled: source.inputs.income_tax_advance_enabled,
      income_tax_advance_frequency: source.inputs.income_tax_advance_frequency,
      income_tax_deductions_enabled: source.inputs.income_tax_deductions_enabled,
      income_tax_deductions_frequency: source.inputs.income_tax_deductions_frequency,
      national_insurance_type: source.inputs.national_insurance_type,
      national_insurance_monthly_amount: source.inputs.national_insurance_monthly_amount,
      national_insurance_deductions_file_number:
        source.inputs.national_insurance_deductions_file_number,
      vat_applicable: appl.vat_applicable,
      payroll_applicable: appl.payroll_applicable,
      income_tax_advance_applicable: appl.income_tax_advance_applicable,
      income_tax_deductions_applicable: appl.income_tax_deductions_applicable,
      national_insurance_applicable: appl.national_insurance_applicable,
      national_insurance_deductions_applicable: appl.national_insurance_deductions_applicable,
      row_visible: appl.row_visible,
      client_created_at: source.client_created_at,
      captured_at: capturedAt,
    };
    result.set(source.client_id, row);
    toInsert.push(row);
  }

  if (toInsert.length) {
    const { error } = await supabaseAdmin
      .from('client_operations_period_applicability_snapshots')
      .upsert(toInsert, {
        onConflict: 'organization_id,client_id,operational_period_key',
        ignoreDuplicates: true,
      });
    assertQueryError(error, 'Failed to ensure period applicability snapshots');

    const insertedIds = toInsert.map((r) => String(r.client_id));
    const reloaded = await loadPeriodApplicabilitySnapshots({
      organizationId: input.organizationId,
      operationalPeriodKey: input.operationalPeriodKey,
      clientIds: insertedIds,
    });
    for (const [clientId, row] of reloaded) {
      result.set(clientId, row);
    }
  }

  return result;
}

export async function upsertPeriodMaterialFact(input: {
  ctx: RequestContext;
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  materialBrought: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_operations_period_material_facts').upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      operational_period_key: input.operationalPeriodKey,
      material_brought: input.materialBrought,
      updated_by_user_id: input.ctx.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,client_id,operational_period_key' },
  );
  assertQueryError(error, 'Failed to upsert period material fact');
}
