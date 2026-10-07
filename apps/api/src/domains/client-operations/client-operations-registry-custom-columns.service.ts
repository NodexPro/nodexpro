import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  assertNotSystemColumnKey,
  buildCustomColumnsCapability,
  CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  isSystemRegistryColumnKey,
  planClientOperationsUserSlotKeysToCreate,
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
  setIncomeTaxDeductionsReportedForRegistry,
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
import {
  initializeUserColumnsForPeriod,
  loadActiveCustomColumnsExtended,
  setCustomColumnPeriodSettings,
  setPeriodCustomColumnValue,
} from './client-operations-user-columns-periods.service.js';
import { setClientOperationsManualRowCellValue, initializeManualRowsForPeriod } from './client-operations-manual-rows.service.js';
import { copyClientOperationsUserPeriodData } from './client-operations-user-period-data-copy.service.js';
import { assertCanAccessClientFromContext } from './organization-client-access.js';
import {
  isValidClientOperationsManualCellStatus,
  resolveAllowedManualStatusesForWrite,
  setClientOperationsCellManualStatus,
} from './client-operations-cell-manual-status.service.js';

export type RegistryCustomColumnDefinition = {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  data_type: ClientOperationsCustomColumnDataType;
  position: number;
  visible: boolean;
  auto_extend_to_future?: boolean;
  auto_extend_from_period_key?: string | null;
  legacy_baseline_period_key?: string | null;
  legacy_baseline_completed_at?: string | null;
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
  selected_periods?: unknown;
  auto_extend_to_future?: unknown;
  legacy_baseline_period_key?: unknown;
  column_ids?: unknown;
  column_key?: unknown;
  status?: unknown;
  manual_row_slot?: unknown;
  source_operational_period_key?: unknown;
  target_operational_period_key?: unknown;
  mode?: unknown;
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

/** Rename may clear a header back to an unused blank slot (stored as a single space). */
function labelFromAllowBlank(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('label is required');
  const trimmed = value.trim();
  if (trimmed.length > 80) throw badRequest('label must be 80 characters or less');
  return trimmed || ' ';
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

/**
 * Idempotent Excel-like user slots: fill remaining capacity up to 10 with blank-header
 * `user_slot_XX` columns. Existing custom columns/labels/values are never overwritten.
 * Safe under concurrent calls (unique key + max-10 trigger).
 */
export async function ensureClientOperationsUserColumnSlots(input: {
  organizationId: string;
  actorUserId: string | null;
}): Promise<{ created_keys: string[]; active_count: number }> {
  const columns = await loadActiveClientOperationsRegistryCustomColumns(input.organizationId);
  const toCreate = planClientOperationsUserSlotKeysToCreate(columns.map((c) => c.key));
  if (toCreate.length === 0) {
    return { created_keys: [], active_count: columns.length };
  }
  const capturedAt = new Date().toISOString();
  const rows = toCreate.map((key, index) => ({
    organization_id: input.organizationId,
    key,
    // Whitespace satisfies DB CHECK(char_length >= 1); UI renders blank header.
    label: ' ',
    data_type: 'text' as const,
    position: columns.length + index,
    visible: true,
    created_by: input.actorUserId,
    created_at: capturedAt,
    updated_at: capturedAt,
  }));
  const { error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .upsert(rows, { onConflict: 'organization_id,key', ignoreDuplicates: true });
  if (error?.message?.includes('CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT')) {
    const afterLimit = await loadActiveClientOperationsRegistryCustomColumns(input.organizationId);
    return { created_keys: [], active_count: afterLimit.length };
  }
  assertQueryError(error, 'Failed to ensure user column slots');
  const after = await loadActiveClientOperationsRegistryCustomColumns(input.organizationId);
  const created = toCreate.filter((key) => after.some((c) => c.key === key));
  return { created_keys: created, active_count: after.length };
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
    filter_operational_reporting:
      typeof query.filter_operational_reporting === 'string'
        ? query.filter_operational_reporting
        : null,
    filter_material: typeof query.filter_material === 'string' ? query.filter_material : null,
    filter_payroll: typeof query.filter_payroll === 'string' ? query.filter_payroll : null,
    filter_reporting_type:
      typeof query.filter_reporting_type === 'string' ? query.filter_reporting_type : null,
    filter_business_type:
      typeof query.filter_business_type === 'string' ? query.filter_business_type : null,
    filter_handler: typeof query.filter_handler === 'string' ? query.filter_handler : null,
    workspace_scope: typeof query.workspace_scope === 'string' ? query.workspace_scope : null,
    workspace_subject_user_id:
      typeof query.workspace_subject_user_id === 'string' ? query.workspace_subject_user_id : null,
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

const INCOME_TAX_DEDUCTIONS_REGISTRY_COMMANDS = new Set([
  'set_income_tax_deductions_reported',
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
        'vat_type, vat_frequency, income_tax_advance_enabled, income_tax_advance_frequency, income_tax_deductions_enabled, income_tax_deductions_file_number, income_tax_deductions_frequency, national_insurance_type, national_insurance_monthly_amount, national_insurance_deductions_file_number',
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
        income_tax_deductions_file_number: tax?.income_tax_deductions_file_number ?? null,
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

  // Client-scoped registry commands must obey assignment ACL before any write.
  if (body.client_id !== undefined && body.client_id !== null && String(body.client_id).trim() !== '') {
    await assertCanAccessClientFromContext(ctx, idFrom(body.client_id, 'client_id'));
  }

  if (command === 'create_client_operations_custom_column') {
    // Legacy create path: still max-10 + unique keys. Excel UX prefers ensure slots;
    // re-check count immediately before insert to reduce double-submit duplicates.
    const columns = await loadActiveClientOperationsRegistryCustomColumns(orgId);
    if (columns.length >= CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX) {
      throw new AppError(409, 'Custom column limit reached', 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT');
    }
    const label = labelFrom(body.label);
    const data_type = dataTypeFrom(body.data_type);
    const key = await uniqueKeyForLabel(orgId, label);
    const latest = await loadActiveClientOperationsRegistryCustomColumns(orgId);
    if (latest.length >= CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX) {
      throw new AppError(409, 'Custom column limit reached', 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT');
    }
    const { data, error } = await supabaseAdmin
      .from('client_operations_registry_custom_columns')
      .insert({
        organization_id: orgId,
        key,
        label,
        data_type,
        position: latest.length,
        visible: true,
        created_by: ctx.user.id,
      })
      .select('id')
      .single();
    if (error?.message.includes('CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT')) {
      throw new AppError(409, 'Custom column limit reached', 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT');
    }
    if (error?.code === '23505') {
      // Unique (organization_id, key) — concurrent duplicate create; return aggregate only.
    } else {
      assertQueryError(error, 'Failed to create custom registry column');
      if (!data) throw new AppError(500, 'Custom registry column was not returned after create', 'SUPABASE_ERROR');
      await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_CREATED, data.id, { key, label, data_type });
    }
  } else if (command === 'ensure_client_operations_user_column_slots') {
    const ensured = await ensureClientOperationsUserColumnSlots({
      organizationId: orgId,
      actorUserId: ctx.user.id,
    });
    if (ensured.created_keys.length) {
      await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_CREATED, 'user_slots', {
        created_keys: ensured.created_keys,
        active_count: ensured.active_count,
      });
    }
  } else if (command === 'rename_client_operations_custom_column') {
    const column = await loadOwnedColumn(orgId, body.column_id);
    const label = labelFromAllowBlank(body.label);
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
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const values = valuePayload(column.data_type, body.value);
    await setPeriodCustomColumnValue({
      organizationId: orgId,
      clientId,
      columnId: column.id,
      operationalPeriodKey,
      values,
      actorUserId: ctx.user.id,
      columnKey: column.key,
    });
  } else if (command === 'set_client_operations_cell_manual_status') {
    const clientId = idFrom(body.client_id, 'client_id');
    await ensureActiveClientInOrg(orgId, clientId);
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const columnKey = typeof body.column_key === 'string' ? body.column_key.trim() : '';
    if (!columnKey) throw badRequest('column_key is required');
    const statusRaw = body.status;
    const status =
      statusRaw === null || statusRaw === undefined || statusRaw === ''
        ? null
        : isValidClientOperationsManualCellStatus(statusRaw)
          ? statusRaw
          : (() => {
              throw badRequest('status must be ready | sent_for_approval | completed | null');
            })();
    const extended = await loadActiveCustomColumnsExtended(orgId);
    const isCustomColumn = extended.some((c) => c.key === columnKey && c.visible !== false);
    const allowedStatuses = await resolveAllowedManualStatusesForWrite({
      organizationId: orgId,
      clientId,
      operationalPeriodKey,
      columnKey,
      isCustomColumn,
    });
    if (!allowedStatuses.length) throw forbidden('Cell is not eligible for manual status');
    await setClientOperationsCellManualStatus({
      ctx,
      organizationId: orgId,
      clientId,
      operationalPeriodKey,
      columnKey,
      status,
      allowedStatuses,
    });
  } else if (command === 'set_client_operations_custom_column_period_settings') {
    const extended = await loadActiveCustomColumnsExtended(orgId);
    const columnId = idFrom(body.column_id, 'column_id');
    const column = extended.find((c) => c.id === columnId);
    if (!column) throw forbidden('Custom registry column not found');
    const selectedPeriods = Array.isArray(body.selected_periods)
      ? body.selected_periods.map((p) => String(p ?? ''))
      : [];
    await setCustomColumnPeriodSettings({
      ctx,
      organizationId: orgId,
      column,
      selectedPeriodKey: operationalPeriodKeyFrom(
        body.operational_period_key ?? (body.query as { operational_period_key?: unknown } | undefined)?.operational_period_key,
      ),
      selectedPeriods,
      autoExtendToFuture: booleanFrom(body.auto_extend_to_future ?? false, 'auto_extend_to_future'),
      legacyBaselinePeriodKey:
        body.legacy_baseline_period_key == null || body.legacy_baseline_period_key === ''
          ? null
          : String(body.legacy_baseline_period_key),
    });
  } else if (command === 'initialize_client_operations_user_columns_for_period') {
    const extended = await loadActiveCustomColumnsExtended(orgId);
    const periodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const columnIds = Array.isArray(body.column_ids) ? body.column_ids.map((id) => String(id ?? '')) : [];
    await initializeUserColumnsForPeriod({
      ctx,
      organizationId: orgId,
      operationalPeriodKey: periodKey,
      columnIds,
      allColumns: extended,
    });
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
  } else if (command === 'set_income_tax_deductions_reported') {
    const clientId = idFrom(body.client_id, 'client_id');
    const operationalPeriodKey = operationalPeriodKeyFrom(body.operational_period_key);
    const enabled = booleanFrom(body.value, 'value');
    const snapshot = await ensurePeriodSnapshotForMaterialCommand({
      orgId,
      clientId,
      operationalPeriodKey,
    });
    if (!snapshot?.income_tax_deductions_applicable) {
      throw badRequest('Income-tax deductions are not due for this period');
    }
    await setIncomeTaxDeductionsReportedForRegistry({
      organizationId: orgId,
      clientId,
      operationalPeriodKey,
      enabled,
    });
    await audit(ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_INCOME_TAX_DEDUCTIONS_REPORTED_SET, clientId, {
      client_id: clientId,
      operational_period_key: operationalPeriodKey,
      reported: enabled,
    });
  } else if (command === 'initialize_client_operations_manual_rows_for_period') {
    const periodKey = operationalPeriodKeyFrom(
      body.operational_period_key ?? (body.query as { operational_period_key?: unknown } | undefined)?.operational_period_key,
    );
    await initializeManualRowsForPeriod({
      ctx,
      organizationId: orgId,
      operationalPeriodKey: periodKey,
    });
  } else if (command === 'set_client_operations_manual_row_cell_value') {
    const operationalPeriodKey = operationalPeriodKeyFrom(
      body.operational_period_key ?? (body.query as { operational_period_key?: unknown } | undefined)?.operational_period_key,
    );
    const extended = await loadActiveCustomColumnsExtended(orgId);
    const eligibleColumnKeys = new Set<string>([
      ...CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => c.key).filter((key) => key !== 'folder'),
      ...extended.filter((c) => c.visible !== false).map((c) => c.key),
    ]);
    await setClientOperationsManualRowCellValue({
      ctx,
      organizationId: orgId,
      operationalPeriodKey,
      manualRowSlot: body.manual_row_slot,
      columnKey: String(body.column_key ?? ''),
      value: body.value,
      eligibleColumnKeys,
    });
  } else if (command === 'copy_client_operations_user_period_data') {
    const targetPeriodKey = operationalPeriodKeyFrom(
      body.target_operational_period_key ??
        body.operational_period_key ??
        (body.query as { operational_period_key?: unknown } | undefined)?.operational_period_key,
    );
    await copyClientOperationsUserPeriodData({
      ctx,
      organizationId: orgId,
      sourceOperationalPeriodKey: body.source_operational_period_key,
      targetOperationalPeriodKey: targetPeriodKey,
      mode: body.mode ?? 'empty_only',
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

  const [{ listClientOperationsRegistry }, { invalidateClientOperationsRegistryMaterializationCache }] =
    await Promise.all([
      import('./client-operations.service.js'),
      import('./client-operations-registry-materialization-cache.js'),
    ]);
  // Mutation result is always a fresh full aggregate (no cache read); drop cached pre-search
  // materializations for this org so a later GET cannot serve pre-mutation rows.
  invalidateClientOperationsRegistryMaterializationCache(orgId);
  const responseQuery = queryFrom(body.query);
  if (
    MATERIAL_REGISTRY_COMMANDS.has(command) ||
    OPERATIONAL_DATE_REGISTRY_COMMANDS.has(command) ||
    NI_DEDUCTIONS_REGISTRY_COMMANDS.has(command) ||
    INCOME_TAX_DEDUCTIONS_REGISTRY_COMMANDS.has(command)
  ) {
    responseQuery.operational_period_key = operationalPeriodKeyFrom(
      body.operational_period_key ?? responseQuery.operational_period_key,
    );
  }
  if (command === 'copy_client_operations_user_period_data') {
    responseQuery.operational_period_key = operationalPeriodKeyFrom(
      body.target_operational_period_key ??
        body.operational_period_key ??
        responseQuery.operational_period_key,
    );
  }
  return listClientOperationsRegistry(ctx, responseQuery);
}

export { buildCustomColumnsCapability };
