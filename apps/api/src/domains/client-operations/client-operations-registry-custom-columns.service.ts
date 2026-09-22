import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  assertNotSystemColumnKey,
  buildCustomColumnsCapability,
  CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
  isSystemRegistryColumnKey,
  slugifyCustomColumnKey,
  type ClientOperationsCustomColumnDataType,
  type RegistryQueryInput,
} from './client-operations-registry-presentation.pure.js';
import { resolveVatOperationalReportingPeriodKey } from './client-operations-client-quick-profile.pure.js';
import { syncVatMaterialWorkEvent } from './client-operations-work-engine-bridge.js';
import { setPayrollPeriodSalaryDataReceived } from './client-obligations-tasks-core.service.js';
import {
  ensurePeriodApplicabilitySnapshots,
  loadPeriodApplicabilitySnapshots,
  resolveRegistryOperationalPeriodKey,
  upsertPeriodIncomeTaxAdvanceMaterialFact,
  upsertPeriodMaterialFact,
  type PeriodApplicabilitySnapshotRow,
} from './client-operations-operational-period.service.js';
import {
  mapOperationalPeriodKeyToPayrollPeriodKey,
  resolveDefaultOperationalPeriodKey,
} from './client-operations-operational-period.pure.js';
import {
  completeCapitalDeclarationInstance,
  openCapitalDeclarationInstance,
  setAnnualReportOperationalTargetDate,
  setCapitalDeclarationOperationalTargetDate,
} from './client-operations-annual-capital-operational.service.js';
import {
  completeNiDeductions126CycleForRegistry,
  setNiDeductionsReportedStepForRegistry,
} from './client-operations-ni-deductions-registry.service.js';

export type RegistryCustomColumnDefinition = {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  data_type: ClientOperationsCustomColumnDataType;
  position: number;
  visible: boolean;
};

export type RegistryCustomColumnValue = {
  client_id: string;
  column_id: string;
  value_text: string | null;
  value_number: number | string | null;
  value_date: string | null;
  value_bool: boolean | null;
};

export type ClientOperationsRegistryCommandBody = {
  command?: string;
  label?: unknown;
  data_type?: unknown;
  column_id?: unknown;
  client_id?: unknown;
  value?: unknown;
  position?: unknown;
  ordered_column_ids?: unknown;
  operational_period_key?: unknown;
  operational_target_date?: unknown;
  tax_year?: unknown;
  label_he?: unknown;
  query?: RegistryQueryInput;
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

function labelFrom(value: unknown): string {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label) throw badRequest('label is required');
  if (label.length > 80) throw badRequest('label must be 80 characters or less');
  return label;
}

function dataTypeFrom(value: unknown): ClientOperationsCustomColumnDataType {
  if (value === 'text' || value === 'number' || value === 'date' || value === 'boolean') return value;
  throw badRequest('data_type must be text, number, date, or boolean');
}

function idFrom(value: unknown, name: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw badRequest(`${name} is required`);
  return id;
}

function booleanFrom(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${name} must be boolean`);
  return value;
}

export async function loadActiveClientOperationsRegistryCustomColumns(orgId: string): Promise<RegistryCustomColumnDefinition[]> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .select('id, organization_id, key, label, data_type, position, visible')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  assertQueryError(error, 'Failed to load custom registry columns');
  return (data ?? []) as RegistryCustomColumnDefinition[];
}

/** One org-and-client-batched value query; no per-client reads. */
export async function loadClientOperationsRegistryCustomColumnValues(
  orgId: string,
  clientIds: string[]
): Promise<Map<string, RegistryCustomColumnValue>> {
  if (clientIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_values')
    .select('client_id, column_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', orgId)
    .in('client_id', clientIds);
  assertQueryError(error, 'Failed to load custom registry column values');
  return new Map(
    ((data ?? []) as RegistryCustomColumnValue[]).map((value) => [`${value.client_id}:${value.column_id}`, value])
  );
}

function valuePayload(dataType: ClientOperationsCustomColumnDataType, value: unknown) {
  const empty = { value_text: null, value_number: null, value_date: null, value_bool: null };
  if (value === null || value === undefined || value === '') return empty;
  if (dataType === 'text') {
    if (typeof value !== 'string') throw badRequest('value must be text');
    return { ...empty, value_text: value };
  }
  if (dataType === 'number') {
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(numberValue)) throw badRequest('value must be a finite number');
    return { ...empty, value_number: numberValue };
  }
  if (dataType === 'boolean') {
    if (typeof value !== 'boolean') throw badRequest('value must be boolean');
    return { ...empty, value_bool: value };
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest('value must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw badRequest('value must be a valid date');
  return { ...empty, value_date: value };
}

async function loadOwnedColumn(orgId: string, rawColumnId: unknown): Promise<RegistryCustomColumnDefinition> {
  const columnId = idFrom(rawColumnId, 'column_id');
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .select('id, organization_id, key, label, data_type, position, visible')
    .eq('organization_id', orgId)
    .eq('id', columnId)
    .is('archived_at', null)
    .maybeSingle();
  assertQueryError(error, 'Failed to load custom registry column');
  if (!data) throw forbidden('Custom registry column not found');
  return data as RegistryCustomColumnDefinition;
}

async function uniqueKeyForLabel(orgId: string, label: string): Promise<string> {
  const seed = slugifyCustomColumnKey(label);
  try {
    assertNotSystemColumnKey(seed);
  } catch {
    throw badRequest('Custom column key conflicts with a system registry column');
  }
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .select('key')
    .eq('organization_id', orgId);
  assertQueryError(error, 'Failed to validate custom column key');
  const used = new Set((data ?? []).map((row: { key: string }) => row.key));
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? seed : `${seed.slice(0, 58)}_${suffix}`;
    if (!isSystemRegistryColumnKey(candidate) && !used.has(candidate)) return candidate;
  }
  throw badRequest('Could not allocate a custom column key');
}

async function audit(ctx: RequestContext, action: string, entityId: string, payload: Record<string, unknown>) {
  await writeAudit({
    organizationId: assertOrg(ctx),
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_registry_custom_column',
    entityId,
    action,
    payload,
  });
}

async function ensureActiveClientInOrg(
  orgId: string,
  clientId: string,
): Promise<{ created_at: string | null }> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, created_at')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .eq('is_archived', false)
    .maybeSingle();
  assertQueryError(clientError, 'Failed to validate client');
  if (!client) throw forbidden('Client not found');
  return client as { created_at: string | null };
}

async function syncVatMaterialForCurrentPeriod(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
): Promise<void> {
  const { data: taxSettings, error } = await supabaseAdmin
    .from('client_tax_settings')
    .select('vat_frequency')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  assertQueryError(error, 'Failed to load VAT settings');
  const periodKey = resolveVatOperationalReportingPeriodKey({
    vat_frequency: (taxSettings as { vat_frequency?: string | null } | null)?.vat_frequency ?? null,
  });
  if (!periodKey) return;
  await syncVatMaterialWorkEvent(ctx, orgId, clientId, periodKey);
}

function queryFrom(value: unknown): RegistryQueryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const query = value as Record<string, unknown>;
  return {
    q: typeof query.q === 'string' ? query.q : null,
    sort_by: typeof query.sort_by === 'string' ? query.sort_by : null,
    sort_dir: query.sort_dir === 'asc' || query.sort_dir === 'desc' ? query.sort_dir : null,
    operational_period_key:
      typeof query.operational_period_key === 'string' ? query.operational_period_key : null,
  };
}

function operationalPeriodKeyFrom(value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  return resolveRegistryOperationalPeriodKey(value);
}

const MATERIAL_REGISTRY_COMMANDS = new Set([
  'set_material_brought',
  'set_income_tax_advance_material_brought',
  'set_payroll_material_brought',
]);

const OPERATIONAL_DATE_REGISTRY_COMMANDS = new Set([
  'set_annual_report_operational_target_date',
  'open_capital_declaration_instance',
  'set_capital_declaration_operational_target_date',
  'complete_capital_declaration_instance',
]);

const NI_DEDUCTIONS_REGISTRY_COMMANDS = new Set([
  'set_ni_deductions_reported_102',
  'set_ni_deductions_reported_100',
  'complete_ni_deductions_126_cycle',
]);

async function ensurePeriodSnapshotForMaterialCommand(input: {
  orgId: string;
  clientId: string;
  operationalPeriodKey: string;
}): Promise<PeriodApplicabilitySnapshotRow | undefined> {
  const client = await ensureActiveClientInOrg(input.orgId, input.clientId);
  const [{ data: profile, error: profileError }, { data: tax, error: taxError }] = await Promise.all([
    supabaseAdmin
      .from('client_operational_profiles')
      .select('payroll_flag')
      .eq('organization_id', input.orgId)
      .eq('client_id', input.clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('client_tax_settings')
      .select(
        'vat_type, vat_frequency, income_tax_advance_enabled, income_tax_advance_frequency, income_tax_deductions_enabled, income_tax_deductions_frequency, national_insurance_type, national_insurance_monthly_amount, national_insurance_deductions_file_number',
      )
      .eq('organization_id', input.orgId)
      .eq('client_id', input.clientId)
      .maybeSingle(),
  ]);
  assertQueryError(profileError, 'Failed to load operational profile');
  assertQueryError(taxError, 'Failed to load tax settings');
  const existing = await loadPeriodApplicabilitySnapshots({
    organizationId: input.orgId,
    operationalPeriodKey: input.operationalPeriodKey,
    clientIds: [input.clientId],
  });
  const snapshots = await ensurePeriodApplicabilitySnapshots({
    organizationId: input.orgId,
    operationalPeriodKey: input.operationalPeriodKey,
    existing,
    sources: [{
      client_id: input.clientId,
      client_created_at: client.created_at,
      inputs: {
        vat_type: tax?.vat_type ?? null,
        vat_frequency: tax?.vat_frequency ?? null,
        payroll_flag: profile?.payroll_flag ?? null,
        income_tax_advance_enabled: tax?.income_tax_advance_enabled ?? null,
        income_tax_advance_frequency: tax?.income_tax_advance_frequency ?? null,
        income_tax_deductions_enabled: tax?.income_tax_deductions_enabled ?? null,
        income_tax_deductions_frequency: tax?.income_tax_deductions_frequency ?? null,
        national_insurance_type: tax?.national_insurance_type ?? null,
        national_insurance_monthly_amount: tax?.national_insurance_monthly_amount ?? null,
        national_insurance_deductions_file_number:
          tax?.national_insurance_deductions_file_number ?? null,
      },
    }],
  });
  return snapshots.get(input.clientId);
}

export async function executeClientOperationsRegistryCommand(
  ctx: RequestContext,
  body: ClientOperationsRegistryCommandBody
) {
  const orgId = assertOrg(ctx);
  assertEdit(ctx);
  const command = typeof body.command === 'string' ? body.command : '';

  if (command === 'create_client_operations_custom_column') {
    const columns = await loadActiveClientOperationsRegistryCustomColumns(orgId);
    if (columns.length >= CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX) {
      throw new AppError(409, 'Custom column limit reached', 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT');
    }
    const label = labelFrom(body.label);
    const data_type = dataTypeFrom(body.data_type);
    const key = await uniqueKeyForLabel(orgId, label);
    const { data, error } = await supabaseAdmin
      .from('client_operations_registry_custom_columns')
      .insert({ organization_id: orgId, key, label, data_type, position: columns.length, visible: true, created_by: ctx.user.id })
      .select('id')
      .single();
    if (error?.message.includes('CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT')) {
      throw new AppError(409, 'Custom column limit reached', 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT');
    }
    assertQueryError(error, 'Failed to create custom registry column');
    if (!data) throw new AppError(500, 'Custom registry column was not returned after create', 'SUPABASE_ERROR');
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_CREATED, data.id, { key, label, data_type });
  } else if (command === 'rename_client_operations_custom_column') {
    const column = await loadOwnedColumn(orgId, body.column_id);
    const label = labelFrom(body.label);
    const { error } = await supabaseAdmin
      .from('client_operations_registry_custom_columns')
      .update({ label, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', column.id);
    assertQueryError(error, 'Failed to rename custom registry column');
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_RENAMED, column.id, { key: column.key, before: column.label, after: label });
  } else if (command === 'hide_client_operations_custom_column' || command === 'show_client_operations_custom_column') {
    const column = await loadOwnedColumn(orgId, body.column_id);
    const visible = command === 'show_client_operations_custom_column';
    const { error } = await supabaseAdmin
      .from('client_operations_registry_custom_columns')
      .update({ visible, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', column.id);
    assertQueryError(error, 'Failed to update custom registry column visibility');
    await audit(ctx, visible ? AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_SHOWN : AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_HIDDEN, column.id, { key: column.key });
  } else if (command === 'reorder_client_operations_custom_column') {
    const columns = await loadActiveClientOperationsRegistryCustomColumns(orgId);
    let orderedIds: string[];
    if (Array.isArray(body.ordered_column_ids)) {
      orderedIds = body.ordered_column_ids.map((id) => idFrom(id, 'ordered_column_ids item'));
      const expected = new Set(columns.map((column) => column.id));
      if (orderedIds.length !== columns.length || new Set(orderedIds).size !== columns.length || orderedIds.some((id) => !expected.has(id))) {
        throw badRequest('ordered_column_ids must include every active custom column exactly once');
      }
    } else {
      const columnId = idFrom(body.column_id, 'column_id');
      const requestedPosition = Number(body.position);
      if (!Number.isInteger(requestedPosition)) throw badRequest('position must be an integer');
      const without = columns.filter((column) => column.id !== columnId);
      if (without.length === columns.length) throw forbidden('Custom registry column not found');
      without.splice(Math.max(0, Math.min(requestedPosition, without.length)), 0, columns.find((column) => column.id === columnId)!);
      orderedIds = without.map((column) => column.id);
    }
    const updates = await Promise.all(
      orderedIds.map((id, position) =>
        supabaseAdmin
          .from('client_operations_registry_custom_columns')
          .update({ position, updated_at: new Date().toISOString() })
          .eq('organization_id', orgId)
          .eq('id', id)
      )
    );
    for (const update of updates) assertQueryError(update.error, 'Failed to reorder custom registry columns');
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_REORDERED, orderedIds[0] ?? 'registry', { ordered_column_ids: orderedIds });
  } else if (command === 'set_client_operations_custom_column_value') {
    const column = await loadOwnedColumn(orgId, body.column_id);
    const clientId = idFrom(body.client_id, 'client_id');
    await ensureActiveClientInOrg(orgId, clientId);
    const values = valuePayload(column.data_type, body.value);
    const { error } = await supabaseAdmin.from('client_operations_registry_custom_column_values').upsert(
      { organization_id: orgId, client_id: clientId, column_id: column.id, ...values, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id,client_id,column_id' }
    );
    assertQueryError(error, 'Failed to set custom registry column value');
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_VALUE_SET, column.id, { client_id: clientId, key: column.key });
  } else if (command === 'set_material_brought') {
    const clientId = idFrom(body.client_id, 'client_id');
    const value = booleanFrom(body.value, 'value');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.vat_applicable) throw badRequest('Material brought is not applicable for this period');
    await upsertPeriodMaterialFact({
      ctx,
      organizationId: orgId,
      clientId,
      operationalPeriodKey,
      materialBrought: value,
    });
    if (operationalPeriodKey === resolveDefaultOperationalPeriodKey()) {
      const { error } = await supabaseAdmin
        .from('client_operational_profiles')
        .upsert(
          {
            organization_id: orgId,
            client_id: clientId,
            material_brought_flag: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,client_id' },
        );
      assertQueryError(error, 'Failed to mirror material brought flag');
    }
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_MATERIAL_BROUGHT_SET, clientId, {
      client_id: clientId,
      operational_period_key: operationalPeriodKey,
      material_brought: value,
    });
    if (!value && operationalPeriodKey === resolveDefaultOperationalPeriodKey()) {
      await syncVatMaterialForCurrentPeriod(ctx, orgId, clientId);
    }
  } else if (command === 'set_income_tax_advance_material_brought') {
    const clientId = idFrom(body.client_id, 'client_id');
    const value = booleanFrom(body.value, 'value');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.income_tax_advance_applicable) {
      throw badRequest('Income tax advance material is not applicable for this period');
    }
    await upsertPeriodIncomeTaxAdvanceMaterialFact({
      ctx,
      organizationId: orgId,
      clientId,
      operationalPeriodKey,
      incomeTaxAdvanceMaterialBrought: value,
    });
    if (operationalPeriodKey === resolveDefaultOperationalPeriodKey()) {
      const { error } = await supabaseAdmin
        .from('client_operational_profiles')
        .upsert(
          {
            organization_id: orgId,
            client_id: clientId,
            income_data_received_flag: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,client_id' },
        );
      assertQueryError(error, 'Failed to mirror income data received flag');
    }
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_INCOME_TAX_ADVANCE_MATERIAL_BROUGHT_SET, clientId, {
      client_id: clientId,
      operational_period_key: operationalPeriodKey,
      income_tax_advance_material_brought: value,
    });
  } else if (command === 'set_payroll_material_brought') {
    const clientId = idFrom(body.client_id, 'client_id');
    const value = booleanFrom(body.value, 'value');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.payroll_applicable) {
      throw badRequest('Payroll material is not applicable for this period');
    }
    const payrollPeriodKey = mapOperationalPeriodKeyToPayrollPeriodKey(operationalPeriodKey);
    await setPayrollPeriodSalaryDataReceived({
      organizationId: orgId,
      clientId,
      payrollPeriodKey,
      enabled: value,
    });
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_PAYROLL_MATERIAL_BROUGHT_SET, clientId, {
      client_id: clientId,
      operational_period_key: operationalPeriodKey,
      payroll_period_key: payrollPeriodKey,
      salary_data_received: value,
    });
  } else if (command === 'set_annual_report_operational_target_date') {
    await setAnnualReportOperationalTargetDate({
      ctx,
      clientId: idFrom(body.client_id, 'client_id'),
      operationalPeriodKey: operationalPeriodKeyFrom(body.operational_period_key),
      operationalTargetDate: body.operational_target_date,
    });
  } else if (command === 'open_capital_declaration_instance') {
    await openCapitalDeclarationInstance({
      ctx,
      clientId: idFrom(body.client_id, 'client_id'),
      taxYear: body.tax_year,
      labelHe: body.label_he,
    });
  } else if (command === 'set_capital_declaration_operational_target_date') {
    await setCapitalDeclarationOperationalTargetDate({
      ctx,
      clientId: idFrom(body.client_id, 'client_id'),
      operationalPeriodKey: operationalPeriodKeyFrom(body.operational_period_key),
      operationalTargetDate: body.operational_target_date,
    });
  } else if (command === 'complete_capital_declaration_instance') {
    await completeCapitalDeclarationInstance({
      ctx,
      clientId: idFrom(body.client_id, 'client_id'),
    });
  } else if (command === 'set_ni_deductions_reported_102' || command === 'set_ni_deductions_reported_100') {
    const clientId = idFrom(body.client_id, 'client_id');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const enabled = booleanFrom(body.value, 'value');
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.national_insurance_deductions_applicable) {
      throw badRequest('NI deductions are not applicable for this period');
    }
    await setNiDeductionsReportedStepForRegistry({
      ctx,
      clientId,
      operationalPeriodKey,
      step: command === 'set_ni_deductions_reported_102' ? 'reported_102' : 'reported_100',
      enabled,
    });
  } else if (command === 'complete_ni_deductions_126_cycle') {
    const clientId = idFrom(body.client_id, 'client_id');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.national_insurance_deductions_applicable) {
      throw badRequest('NI deductions are not applicable for this period');
    }
    await completeNiDeductions126CycleForRegistry({
      ctx,
      clientId,
      operationalPeriodKey,
    });
  } else if (command === 'archive_client_operations_custom_column') {
    const column = await loadOwnedColumn(orgId, body.column_id);
    const { error } = await supabaseAdmin
      .from('client_operations_registry_custom_columns')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', column.id);
    assertQueryError(error, 'Failed to archive custom registry column');
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_ARCHIVED, column.id, { key: column.key });
  } else {
    throw badRequest('Unknown registry command');
  }

  const { listClientOperationsRegistry } = await import('./client-operations.service.js');
  const responseQuery = queryFrom(body.query);
  if (
    MATERIAL_REGISTRY_COMMANDS.has(command) ||
    OPERATIONAL_DATE_REGISTRY_COMMANDS.has(command) ||
    NI_DEDUCTIONS_REGISTRY_COMMANDS.has(command)
  ) {
    responseQuery.operational_period_key = operationalPeriodKeyFrom(
      body.operational_period_key ?? responseQuery.operational_period_key,
    );
  }
  return listClientOperationsRegistry(ctx, responseQuery);
}

export { buildCustomColumnsCapability };
