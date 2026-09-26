/**
 * Client Operations — user Excel columns × operational periods (I/O + commands helpers).
 * GET remains pure for setup/init writes; callers invoke named commands.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { isBlankCustomColumnLabel } from './client-operations-registry-presentation.pure.js';
import {
  isMeaningfulTypedValue,
  latestEarlierPeriodKey,
  mapEligibleColumnsForPeriodSetupDialog,
  type PeriodTypedValue,
} from './client-operations-user-columns-periods.pure.js';

export type RegistryCustomColumnDefinitionExtended = {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  data_type: 'text' | 'number' | 'date' | 'boolean';
  position: number;
  visible: boolean;
  auto_extend_to_future: boolean;
  auto_extend_from_period_key: string | null;
  legacy_baseline_period_key: string | null;
  legacy_baseline_completed_at: string | null;
};

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

function periodKeyFrom(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw badRequest('operational_period_key must be YYYY-MM');
  return key;
}

export async function loadActiveCustomColumnsExtended(
  orgId: string,
): Promise<RegistryCustomColumnDefinitionExtended[]> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .select(
      'id, organization_id, key, label, data_type, position, visible, auto_extend_to_future, auto_extend_from_period_key, legacy_baseline_period_key, legacy_baseline_completed_at',
    )
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  assertQueryError(error, 'Failed to load custom registry columns');
  return ((data ?? []) as RegistryCustomColumnDefinitionExtended[]).map((row) => ({
    ...row,
    auto_extend_to_future: Boolean(row.auto_extend_to_future),
    auto_extend_from_period_key: row.auto_extend_from_period_key ?? null,
    legacy_baseline_period_key: row.legacy_baseline_period_key ?? null,
    legacy_baseline_completed_at: row.legacy_baseline_completed_at ?? null,
  }));
}

export async function loadPeriodVisibilityColumnIds(
  orgId: string,
  operationalPeriodKey: string,
): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_visibility')
    .select('column_id')
    .eq('organization_id', orgId)
    .eq('operational_period_key', operationalPeriodKey);
  assertQueryError(error, 'Failed to load custom column period visibility');
  return new Set(((data ?? []) as Array<{ column_id: string }>).map((r) => r.column_id));
}

export async function loadAllVisibilityByColumn(
  orgId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_visibility')
    .select('column_id, operational_period_key')
    .eq('organization_id', orgId);
  assertQueryError(error, 'Failed to load custom column visibility map');
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ column_id: string; operational_period_key: string }>) {
    const list = map.get(row.column_id) ?? [];
    list.push(row.operational_period_key);
    map.set(row.column_id, list);
  }
  for (const [id, list] of map) map.set(id, list.sort());
  return map;
}

export async function isUserColumnsPeriodSetupComplete(
  orgId: string,
  operationalPeriodKey: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_user_columns_period_setup')
    .select('operational_period_key')
    .eq('organization_id', orgId)
    .eq('operational_period_key', operationalPeriodKey)
    .maybeSingle();
  assertQueryError(error, 'Failed to load user columns period setup');
  return Boolean(data);
}

export async function loadPeriodCustomColumnValues(
  orgId: string,
  operationalPeriodKey: string,
  clientIds: string[],
  columnIds: string[],
): Promise<Map<string, PeriodTypedValue>> {
  if (!clientIds.length || !columnIds.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_values')
    .select('client_id, column_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', orgId)
    .eq('operational_period_key', operationalPeriodKey)
    .in('client_id', clientIds)
    .in('column_id', columnIds);
  assertQueryError(error, 'Failed to load period custom column values');
  return new Map(
    ((data ?? []) as Array<PeriodTypedValue & { client_id: string; column_id: string }>).map((value) => [
      `${value.client_id}:${value.column_id}`,
      value,
    ]),
  );
}

async function loadLegacyValuesForColumn(
  orgId: string,
  columnId: string,
): Promise<Array<{ client_id: string } & PeriodTypedValue>> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_values')
    .select('client_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', orgId)
    .eq('column_id', columnId);
  assertQueryError(error, 'Failed to load legacy custom column values');
  return (data ?? []) as Array<{ client_id: string } & PeriodTypedValue>;
}

export async function columnHasMeaningfulLegacyValues(orgId: string, columnId: string): Promise<boolean> {
  const rows = await loadLegacyValuesForColumn(orgId, columnId);
  return rows.some((row) => isMeaningfulTypedValue(row));
}

export async function loadColumnsWithMeaningfulPriorData(input: {
  organizationId: string;
  columns: RegistryCustomColumnDefinitionExtended[];
}): Promise<Set<string>> {
  const out = new Set<string>();
  if (!input.columns.length) return out;

  const columnIds = input.columns.map((c) => c.id);
  const { data: periodData, error: periodError } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_values')
    .select('column_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', input.organizationId)
    .in('column_id', columnIds);
  assertQueryError(periodError, 'Failed to scan period custom values for eligibility');
  for (const row of (periodData ?? []) as Array<{ column_id: string } & PeriodTypedValue>) {
    if (isMeaningfulTypedValue(row)) out.add(row.column_id);
  }

  const { data: legacyData, error: legacyError } = await supabaseAdmin
    .from('client_operations_registry_custom_column_values')
    .select('column_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', input.organizationId)
    .in('column_id', columnIds);
  assertQueryError(legacyError, 'Failed to scan legacy custom values for eligibility');
  const legacyMeaningful = new Set<string>();
  for (const row of (legacyData ?? []) as Array<{ column_id: string } & PeriodTypedValue>) {
    if (isMeaningfulTypedValue(row)) legacyMeaningful.add(row.column_id);
  }

  for (const column of input.columns) {
    if (out.has(column.id)) continue;
    // Legacy meaningful counts for eligibility only AFTER baseline completed
    // (baseline itself creates period values at chosen period).
    if (legacyMeaningful.has(column.id) && column.legacy_baseline_completed_at) {
      out.add(column.id);
    }
  }
  return out;
}

export function columnNeedsLegacyBaseline(
  column: RegistryCustomColumnDefinitionExtended,
  hasMeaningfulLegacy: boolean,
): boolean {
  return hasMeaningfulLegacy && !column.legacy_baseline_completed_at;
}

/** Columns rendered for selected period (backend visibility truth). */
export function resolveVisibleCustomColumnsForPeriod(input: {
  columns: RegistryCustomColumnDefinitionExtended[];
  visibilityIds: Set<string>;
  setupComplete: boolean;
  columnsNeedingLegacyBaseline: Set<string>;
}): RegistryCustomColumnDefinitionExtended[] {
  return input.columns.filter((column) => {
    if (!column.visible) return false;
    if (input.columnsNeedingLegacyBaseline.has(column.id)) return true;
    if (input.visibilityIds.has(column.id)) return true;
    // Before first setup for this period, keep blank slots discoverable for gear/rename.
    if (!input.setupComplete && isBlankCustomColumnLabel(column.label)) return true;
    return false;
  });
}

export async function buildUserColumnsPeriodAggregateExtras(input: {
  organizationId: string;
  columns: RegistryCustomColumnDefinitionExtended[];
  selectedPeriodKey: string;
  availablePeriods: string[];
  canEdit: boolean;
}): Promise<{
  visibleColumns: RegistryCustomColumnDefinitionExtended[];
  visibilityByColumn: Map<string, string[]>;
  user_column_period_setup: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null;
  columns_needing_legacy_baseline: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }>;
}> {
  const [visibilityIds, visibilityByColumn, setupComplete, meaningfulPrior] = await Promise.all([
    loadPeriodVisibilityColumnIds(input.organizationId, input.selectedPeriodKey),
    loadAllVisibilityByColumn(input.organizationId),
    isUserColumnsPeriodSetupComplete(input.organizationId, input.selectedPeriodKey),
    loadColumnsWithMeaningfulPriorData({
      organizationId: input.organizationId,
      columns: input.columns,
    }),
  ]);

  const legacyFlags = new Map<string, boolean>();
  await Promise.all(
    input.columns.map(async (column) => {
      legacyFlags.set(column.id, await columnHasMeaningfulLegacyValues(input.organizationId, column.id));
    }),
  );

  const needingBaseline = new Set<string>();
  const columns_needing_legacy_baseline: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }> = [];
  for (const column of input.columns) {
    const needs = columnNeedsLegacyBaseline(column, Boolean(legacyFlags.get(column.id)));
    if (needs) {
      needingBaseline.add(column.id);
      columns_needing_legacy_baseline.push({
        column_id: column.id,
        label: String(column.label ?? '').trim() || column.key,
        key: column.key,
        available_baseline_periods: input.availablePeriods,
      });
    }
  }

  const visibleColumns = resolveVisibleCustomColumnsForPeriod({
    columns: input.columns,
    visibilityIds,
    setupComplete,
    columnsNeedingLegacyBaseline: needingBaseline,
  });

  let user_column_period_setup: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null = null;

  if (!setupComplete) {
    const eligibleDefs = input.columns.filter(
      (column) =>
        meaningfulPrior.has(column.id) &&
        !needingBaseline.has(column.id) &&
        !isBlankCustomColumnLabel(column.label),
    );
    user_column_period_setup = {
      needed: true,
      operational_period_key: input.selectedPeriodKey,
      eligible_columns: mapEligibleColumnsForPeriodSetupDialog({
        eligible: eligibleDefs.map((column) => ({
          id: column.id,
          key: column.key,
          label: column.label,
          auto_extend_to_future: column.auto_extend_to_future,
          auto_extend_from_period_key: column.auto_extend_from_period_key,
        })),
        operational_period_key: input.selectedPeriodKey,
      }),
    };
  }

  return {
    visibleColumns,
    visibilityByColumn,
    user_column_period_setup: input.canEdit ? user_column_period_setup : null,
    columns_needing_legacy_baseline: input.canEdit ? columns_needing_legacy_baseline : [],
  };
}

async function upsertPeriodValueRow(input: {
  organizationId: string;
  clientId: string;
  columnId: string;
  operationalPeriodKey: string;
  values: PeriodTypedValue;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_operations_registry_custom_column_period_values').upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      column_id: input.columnId,
      operational_period_key: input.operationalPeriodKey,
      ...input.values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,client_id,column_id,operational_period_key' },
  );
  assertQueryError(error, 'Failed to upsert period custom column value');
}

async function ensureVisibilityRow(input: {
  organizationId: string;
  columnId: string;
  operationalPeriodKey: string;
  actorUserId: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_operations_registry_custom_column_period_visibility').upsert(
    {
      organization_id: input.organizationId,
      column_id: input.columnId,
      operational_period_key: input.operationalPeriodKey,
      created_by: input.actorUserId,
    },
    { onConflict: 'organization_id,column_id,operational_period_key', ignoreDuplicates: true },
  );
  assertQueryError(error, 'Failed to ensure period visibility');
}

async function carryForwardColumnIntoPeriod(input: {
  organizationId: string;
  columnId: string;
  operationalPeriodKey: string;
}): Promise<void> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_values')
    .select('client_id')
    .eq('organization_id', input.organizationId)
    .eq('column_id', input.columnId)
    .eq('operational_period_key', input.operationalPeriodKey);
  assertQueryError(existingError, 'Failed to load existing period values');
  const already = new Set(((existing ?? []) as Array<{ client_id: string }>).map((r) => r.client_id));

  const { data: priors, error: priorError } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_values')
    .select('client_id, operational_period_key, value_text, value_number, value_date, value_bool')
    .eq('organization_id', input.organizationId)
    .eq('column_id', input.columnId)
    .lt('operational_period_key', input.operationalPeriodKey);
  assertQueryError(priorError, 'Failed to load prior period values for carry-forward');

  const latestByClient = new Map<string, { period: string; value: PeriodTypedValue }>();
  for (const row of (priors ?? []) as Array<
    { client_id: string; operational_period_key: string } & PeriodTypedValue
  >) {
    const prev = latestByClient.get(row.client_id);
    if (!prev || row.operational_period_key > prev.period) {
      latestByClient.set(row.client_id, {
        period: row.operational_period_key,
        value: {
          value_text: row.value_text,
          value_number: row.value_number,
          value_date: row.value_date,
          value_bool: row.value_bool,
        },
      });
    }
  }

  for (const [clientId, pack] of latestByClient) {
    if (already.has(clientId)) continue;
    if (!isMeaningfulTypedValue(pack.value) && pack.value.value_bool == null) {
      // still copy blanks? only meaningful — skip empty
      if (!isMeaningfulTypedValue(pack.value)) continue;
    }
    await upsertPeriodValueRow({
      organizationId: input.organizationId,
      clientId,
      columnId: input.columnId,
      operationalPeriodKey: input.operationalPeriodKey,
      values: pack.value,
    });
  }
}

export async function applyLegacyBaselineTransition(input: {
  ctx: RequestContext;
  organizationId: string;
  column: RegistryCustomColumnDefinitionExtended;
  baselinePeriodKey: string;
}): Promise<void> {
  if (input.column.legacy_baseline_completed_at) return;
  const baseline = periodKeyFrom(input.baselinePeriodKey);
  const legacyRows = await loadLegacyValuesForColumn(input.organizationId, input.column.id);
  for (const row of legacyRows) {
    if (!isMeaningfulTypedValue(row)) continue;
    await upsertPeriodValueRow({
      organizationId: input.organizationId,
      clientId: row.client_id,
      columnId: input.column.id,
      operationalPeriodKey: baseline,
      values: {
        value_text: row.value_text,
        value_number: row.value_number,
        value_date: row.value_date,
        value_bool: row.value_bool,
      },
    });
  }
  await ensureVisibilityRow({
    organizationId: input.organizationId,
    columnId: input.column.id,
    operationalPeriodKey: baseline,
    actorUserId: input.ctx.user.id,
  });
  const { error } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .update({
      legacy_baseline_period_key: baseline,
      legacy_baseline_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.column.id);
  assertQueryError(error, 'Failed to mark legacy baseline completed');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_registry_custom_column',
    entityId: input.column.id,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_LEGACY_BASELINE,
    payload: { baseline_period_key: baseline, key: input.column.key },
  });
}

export async function setCustomColumnPeriodSettings(input: {
  ctx: RequestContext;
  organizationId: string;
  column: RegistryCustomColumnDefinitionExtended;
  selectedPeriodKey: string;
  selectedPeriods: string[];
  autoExtendToFuture: boolean;
  legacyBaselinePeriodKey?: string | null;
}): Promise<void> {
  const selectedPeriodKey = periodKeyFrom(input.selectedPeriodKey);
  const selected = [...new Set(input.selectedPeriods.map((p) => periodKeyFrom(p)))].sort();

  const needsLegacy = await columnHasMeaningfulLegacyValues(input.organizationId, input.column.id);
  if (columnNeedsLegacyBaseline(input.column, needsLegacy)) {
    const baseline = input.legacyBaselinePeriodKey;
    if (!baseline) throw badRequest('legacy_baseline_period_key is required for this column');
    await applyLegacyBaselineTransition({
      ctx: input.ctx,
      organizationId: input.organizationId,
      column: input.column,
      baselinePeriodKey: baseline,
    });
  }

  const autoExtend = Boolean(input.autoExtendToFuture);
  const { error: prefError } = await supabaseAdmin
    .from('client_operations_registry_custom_columns')
    .update({
      auto_extend_to_future: autoExtend,
      auto_extend_from_period_key: autoExtend ? selectedPeriodKey : null,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.column.id);
  assertQueryError(prefError, 'Failed to update column period preferences');

  const { data: existingVis, error: visLoadError } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_visibility')
    .select('operational_period_key')
    .eq('organization_id', input.organizationId)
    .eq('column_id', input.column.id);
  assertQueryError(visLoadError, 'Failed to load existing visibility');
  const existing = new Set(
    ((existingVis ?? []) as Array<{ operational_period_key: string }>).map((r) => r.operational_period_key),
  );

  const toAdd = selected.filter((p) => !existing.has(p));
  const toRemove = [...existing].filter((p) => !selected.includes(p));

  for (const period of toAdd) {
    await ensureVisibilityRow({
      organizationId: input.organizationId,
      columnId: input.column.id,
      operationalPeriodKey: period,
      actorUserId: input.ctx.user.id,
    });
    await carryForwardColumnIntoPeriod({
      organizationId: input.organizationId,
      columnId: input.column.id,
      operationalPeriodKey: period,
    });
  }

  if (toRemove.length) {
    const { error: delError } = await supabaseAdmin
      .from('client_operations_registry_custom_column_period_visibility')
      .delete()
      .eq('organization_id', input.organizationId)
      .eq('column_id', input.column.id)
      .in('operational_period_key', toRemove);
    assertQueryError(delError, 'Failed to remove period visibility');
  }

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_registry_custom_column',
    entityId: input.column.id,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_PERIOD_SETTINGS,
    payload: {
      key: input.column.key,
      selected_periods: selected,
      auto_extend_to_future: autoExtend,
      auto_extend_from_period_key: autoExtend ? selectedPeriodKey : null,
    },
  });
}

export async function initializeUserColumnsForPeriod(input: {
  ctx: RequestContext;
  organizationId: string;
  operationalPeriodKey: string;
  columnIds: string[];
  allColumns: RegistryCustomColumnDefinitionExtended[];
}): Promise<void> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const already = await isUserColumnsPeriodSetupComplete(input.organizationId, periodKey);
  if (already) {
    // Idempotent: still ensure blank slots remain visible if requested empty init.
  }

  const selectedIds = new Set(
    input.columnIds.map((id) => {
      const trimmed = String(id ?? '').trim();
      if (!trimmed) throw badRequest('column_ids items must be non-empty');
      return trimmed;
    }),
  );
  for (const id of selectedIds) {
    if (!input.allColumns.some((c) => c.id === id)) throw forbidden('Custom registry column not found');
  }

  // Always keep blank slots discoverable after setup.
  for (const column of input.allColumns) {
    if (isBlankCustomColumnLabel(column.label)) selectedIds.add(column.id);
  }

  for (const columnId of selectedIds) {
    await ensureVisibilityRow({
      organizationId: input.organizationId,
      columnId,
      operationalPeriodKey: periodKey,
      actorUserId: input.ctx.user.id,
    });
    await carryForwardColumnIntoPeriod({
      organizationId: input.organizationId,
      columnId,
      operationalPeriodKey: periodKey,
    });
  }

  const { error } = await supabaseAdmin.from('client_operations_user_columns_period_setup').upsert(
    {
      organization_id: input.organizationId,
      operational_period_key: periodKey,
      initialized_at: new Date().toISOString(),
      initialized_by: input.ctx.user.id,
    },
    { onConflict: 'organization_id,operational_period_key' },
  );
  assertQueryError(error, 'Failed to mark user columns period setup');

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_user_columns_period_setup',
    entityId: `${input.organizationId}:${periodKey}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_USER_COLUMNS_PERIOD_INITIALIZED,
    payload: { operational_period_key: periodKey, column_ids: [...selectedIds] },
  });
}

export async function setPeriodCustomColumnValue(input: {
  organizationId: string;
  clientId: string;
  columnId: string;
  operationalPeriodKey: string;
  values: PeriodTypedValue;
  actorUserId: string;
  columnKey: string;
}): Promise<void> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  await upsertPeriodValueRow({
    organizationId: input.organizationId,
    clientId: input.clientId,
    columnId: input.columnId,
    operationalPeriodKey: periodKey,
    values: input.values,
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    moduleCode: 'client-operations',
    entityType: 'client_operations_registry_custom_column',
    entityId: input.columnId,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CUSTOM_COLUMN_VALUE_SET,
    payload: {
      client_id: input.clientId,
      key: input.columnKey,
      operational_period_key: periodKey,
    },
  });
}

export { latestEarlierPeriodKey, periodKeyFrom };
