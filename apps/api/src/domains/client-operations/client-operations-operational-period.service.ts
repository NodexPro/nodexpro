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
  isCurrentOpenOperationalPeriodKey,
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

export type PeriodMaterialFactRow = {
  material_brought: boolean;
  income_tax_advance_material_brought: boolean;
};

export async function loadPeriodMaterialFacts(input: {
  organizationId: string;
  operationalPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, PeriodMaterialFactRow>> {
  const out = new Map<string, PeriodMaterialFactRow>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_operations_period_material_facts')
    .select('client_id, material_brought, income_tax_advance_material_brought')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load period material facts');
  for (const row of (data ?? []) as Array<{
    client_id: string;
    material_brought: boolean;
    income_tax_advance_material_brought?: boolean;
  }>) {
    out.set(row.client_id, {
      material_brought: Boolean(row.material_brought),
      income_tax_advance_material_brought: Boolean(row.income_tax_advance_material_brought),
    });
  }
  return out;
}

/** Batch-load payroll salary_data_received for payroll_period_key (= operational period K). */
export async function loadPayrollPeriodSalaryDataReceived(input: {
  organizationId: string;
  payrollPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_payroll_period_state')
    .select('client_id, salary_data_received')
    .eq('organization_id', input.organizationId)
    .eq('payroll_period_key', input.payrollPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load payroll period salary_data_received');
  for (const row of (data ?? []) as Array<{ client_id: string; salary_data_received: boolean }>) {
    out.set(row.client_id, Boolean(row.salary_data_received));
  }
  return out;
}

/**
 * Batch-load מ״ה ניכויים registry completion (`reported`) for operational_period_key.
 * Reuses canonical client_income_tax_deductions_period — period_key = operational YYYY-MM.
 */
export async function loadIncomeTaxDeductionsPeriodReported(input: {
  organizationId: string;
  operationalPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_income_tax_deductions_period')
    .select('client_id, reported')
    .eq('organization_id', input.organizationId)
    .eq('period_key', input.operationalPeriodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load income-tax deductions period reported');
  for (const row of (data ?? []) as Array<{ client_id: string; reported: boolean }>) {
    out.set(row.client_id, Boolean(row.reported));
  }
  return out;
}

/** Toggle מ״ה ניכויים registry completion for a due operational month. */
export async function setIncomeTaxDeductionsReportedForRegistry(input: {
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  enabled: boolean;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: existing, error: readError } = await supabaseAdmin
    .from('client_income_tax_deductions_period')
    .select('reported, paid, not_relevant')
    .eq('organization_id', input.organizationId)
    .eq('client_id', input.clientId)
    .eq('period_key', input.operationalPeriodKey)
    .maybeSingle();
  assertQueryError(readError, 'Failed to read income-tax deductions period');
  const { error } = await supabaseAdmin.from('client_income_tax_deductions_period').upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      period_key: input.operationalPeriodKey,
      reported: input.enabled,
      paid: Boolean((existing as { paid?: boolean } | null)?.paid),
      not_relevant: Boolean((existing as { not_relevant?: boolean } | null)?.not_relevant),
      updated_at: nowIso,
    },
    { onConflict: 'organization_id,client_id,period_key' },
  );
  assertQueryError(error, 'Failed to upsert income-tax deductions period reported');
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

/**
 * After canonical מיסים tax-settings save: rebuild applicability for the
 * CURRENT/OPEN operational period only (default_period_key).
 *
 * Persistence: ONE atomic RPC (DELETE + INSERT in a single plpgsql transaction).
 * Applicability business logic stays in computeOperationalPeriodApplicability.
 * Historical period rows are never touched.
 *
 * Stale-payload prevention: pass client_tax_settings.updated_at; RPC rejects
 * if canonical settings changed under the lock → API reloads and retries.
 */
export async function reconcileCurrentOpenPeriodApplicabilitySnapshotForClient(input: {
  organizationId: string;
  clientId: string;
  now?: Date;
}): Promise<{
  reconciled: boolean;
  operational_period_key: string;
}> {
  const operationalPeriodKey = resolveDefaultOperationalPeriodKey(input.now);
  const clientId = String(input.clientId ?? '').trim();
  if (!clientId) {
    return { reconciled: false, operational_period_key: operationalPeriodKey };
  }
  if (!isCurrentOpenOperationalPeriodKey(operationalPeriodKey, input.now)) {
    // Defensive: resolveDefaultOperationalPeriodKey is the only open period.
    return { reconciled: false, operational_period_key: operationalPeriodKey };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const [{ data: client, error: clientError }, { data: profile, error: profileError }, { data: tax, error: taxError }] =
      await Promise.all([
        supabaseAdmin
          .from('clients')
          .select('id, created_at')
          .eq('organization_id', input.organizationId)
          .eq('id', clientId)
          .maybeSingle(),
        supabaseAdmin
          .from('client_operational_profiles')
          .select('payroll_flag')
          .eq('organization_id', input.organizationId)
          .eq('client_id', clientId)
          .maybeSingle(),
        supabaseAdmin
          .from('client_tax_settings')
          .select(
            'vat_type, vat_frequency, income_tax_advance_enabled, income_tax_advance_frequency, income_tax_deductions_enabled, income_tax_deductions_file_number, income_tax_deductions_frequency, national_insurance_type, national_insurance_monthly_amount, national_insurance_deductions_file_number, updated_at',
          )
          .eq('organization_id', input.organizationId)
          .eq('client_id', clientId)
          .maybeSingle(),
      ]);
    assertQueryError(clientError, 'Failed to load client for period snapshot reconcile');
    assertQueryError(profileError, 'Failed to load operational profile for period snapshot reconcile');
    assertQueryError(taxError, 'Failed to load tax settings for period snapshot reconcile');
    if (!client) {
      return { reconciled: false, operational_period_key: operationalPeriodKey };
    }

    if (
      !clientExistsInOperationalPeriod({
        client_created_at: (client as { created_at?: string | null }).created_at ?? null,
        operational_period_key: operationalPeriodKey,
      })
    ) {
      // Client not yet in this period — clear any accidental current snapshot via RPC with
      // empty applicability? Prefer leave ensure-path alone: delete-only is not exposed.
      // No snapshot row required when client does not exist in period.
      return { reconciled: true, operational_period_key: operationalPeriodKey };
    }

    const inputs: OperationalPeriodSnapshotInputs = {
      vat_type: tax?.vat_type ?? null,
      vat_frequency: tax?.vat_frequency ?? null,
      payroll_flag: profile?.payroll_flag ?? null,
      income_tax_advance_enabled: tax?.income_tax_advance_enabled ?? null,
      income_tax_advance_frequency: tax?.income_tax_advance_frequency ?? null,
      income_tax_deductions_enabled: tax?.income_tax_deductions_enabled ?? null,
      income_tax_deductions_file_number: tax?.income_tax_deductions_file_number ?? null,
      income_tax_deductions_frequency: tax?.income_tax_deductions_frequency ?? null,
      national_insurance_type: tax?.national_insurance_type ?? null,
      national_insurance_monthly_amount: tax?.national_insurance_monthly_amount ?? null,
      national_insurance_deductions_file_number:
        tax?.national_insurance_deductions_file_number ?? null,
    };
    const appl = computeOperationalPeriodApplicability(operationalPeriodKey, inputs);
    const expectedTaxUpdatedAt =
      (tax as { updated_at?: string | null } | null)?.updated_at ?? null;

    const { error: rpcError } = await supabaseAdmin.rpc(
      'replace_client_operations_period_applicability_snapshot',
      {
        p_organization_id: input.organizationId,
        p_client_id: clientId,
        p_operational_period_key: operationalPeriodKey,
        p_vat_type: inputs.vat_type,
        p_vat_frequency: inputs.vat_frequency,
        p_payroll_flag: inputs.payroll_flag,
        p_income_tax_advance_enabled: inputs.income_tax_advance_enabled,
        p_income_tax_advance_frequency: inputs.income_tax_advance_frequency,
        p_income_tax_deductions_enabled: inputs.income_tax_deductions_enabled,
        p_income_tax_deductions_frequency: inputs.income_tax_deductions_frequency,
        p_national_insurance_type: inputs.national_insurance_type,
        p_national_insurance_monthly_amount: inputs.national_insurance_monthly_amount,
        p_national_insurance_deductions_file_number:
          inputs.national_insurance_deductions_file_number,
        p_vat_applicable: appl.vat_applicable,
        p_payroll_applicable: appl.payroll_applicable,
        p_income_tax_advance_applicable: appl.income_tax_advance_applicable,
        p_income_tax_deductions_applicable: appl.income_tax_deductions_applicable,
        p_national_insurance_applicable: appl.national_insurance_applicable,
        p_national_insurance_deductions_applicable: appl.national_insurance_deductions_applicable,
        p_row_visible: appl.row_visible,
        p_client_created_at: (client as { created_at?: string | null }).created_at ?? null,
        p_expected_tax_settings_updated_at: expectedTaxUpdatedAt,
      },
    );

    if (!rpcError) {
      return { reconciled: true, operational_period_key: operationalPeriodKey };
    }

    const msg = String(rpcError.message ?? '');
    if (msg.includes('CLIENT_OPERATIONS_SNAPSHOT_REPLACE_STALE_TAX_SETTINGS') && attempt < maxAttempts) {
      continue;
    }
    throw new AppError(
      500,
      msg || 'Failed to atomically replace current-open period applicability snapshot',
      'SUPABASE_ERROR',
    );
  }

  throw new AppError(
    500,
    'Failed to atomically replace current-open period applicability snapshot after retries',
    'SUPABASE_ERROR',
  );
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

export async function upsertPeriodIncomeTaxAdvanceMaterialFact(input: {
  ctx: RequestContext;
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  incomeTaxAdvanceMaterialBrought: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_operations_period_material_facts').upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      operational_period_key: input.operationalPeriodKey,
      income_tax_advance_material_brought: input.incomeTaxAdvanceMaterialBrought,
      updated_by_user_id: input.ctx.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,client_id,operational_period_key' },
  );
  assertQueryError(error, 'Failed to upsert income-tax-advance period material fact');
}
