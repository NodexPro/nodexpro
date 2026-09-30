/**
 * Client Operations — explicit copy of user-entered period data (custom + manual).
 * Named command only. No silent tab-switch / period-init value propagation.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest } from '../../shared/errors.js';
import {
  CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH,
  initializeManualRowsForPeriod,
} from './client-operations-manual-rows.service.js';
import {
  isClientOperationsManualFreeTextColumnKey,
  isMeaningfulManualCellValue,
} from './client-operations-manual-rows.pure.js';
import {
  ensureVisibilityRowForPeriod,
  loadActiveCustomColumnsExtended,
  upsertPeriodCustomColumnValueRow,
} from './client-operations-user-columns-periods.service.js';
import { isMeaningfulTypedValue } from './client-operations-user-columns-periods.pure.js';
import {
  buildUserPeriodDataCopySourcePeriods,
  parseUserPeriodDataCopyMode,
  planCustomColumnPeriodValueCopies,
  planManualRowPeriodValueCopies,
  type CustomColumnPeriodValueRow,
  type ManualRowPeriodValueRow,
  type UserPeriodDataCopyMode,
} from './client-operations-user-period-data-copy.pure.js';

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

function periodKeyFrom(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw badRequest('operational_period_key must be YYYY-MM');
  return key;
}

async function loadCustomPeriodValues(input: {
  organizationId: string;
  operationalPeriodKey: string;
}): Promise<CustomColumnPeriodValueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_registry_custom_column_period_values')
    .select('client_id, column_id, value_text, value_number, value_date, value_bool')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey);
  assertQueryError(error, 'Failed to load custom column period values for copy');
  return (data ?? []) as CustomColumnPeriodValueRow[];
}

async function loadManualPeriodValues(input: {
  organizationId: string;
  operationalPeriodKey: string;
}): Promise<ManualRowPeriodValueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_manual_row_cell_values')
    .select('manual_row_slot, column_key, value_text')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey);
  assertQueryError(error, 'Failed to load manual row period values for copy');
  return (data ?? []).map((row) => ({
    slot: Number((row as { manual_row_slot: number }).manual_row_slot),
    column_key: String((row as { column_key: string }).column_key ?? ''),
    value_text: String((row as { value_text: string }).value_text ?? ''),
  }));
}

async function upsertManualPeriodValue(input: {
  organizationId: string;
  operationalPeriodKey: string;
  slot: number;
  columnKey: string;
  valueText: string;
  actorUserId: string;
}): Promise<void> {
  const trimmed = input.valueText.trim();
  if (!trimmed) return;
  if (trimmed.length > CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH) {
    throw badRequest(`value exceeds ${CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH} characters`);
  }
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('client_operations_manual_row_cell_values').upsert(
    {
      organization_id: input.organizationId,
      operational_period_key: input.operationalPeriodKey,
      manual_row_slot: input.slot,
      column_key: input.columnKey,
      value_text: trimmed,
      updated_at: now,
      updated_by: input.actorUserId,
    },
    { onConflict: 'organization_id,operational_period_key,manual_row_slot,column_key' },
  );
  assertQueryError(error, 'Failed to upsert manual row cell value during period copy');
}

async function markUserColumnsPeriodSetup(input: {
  organizationId: string;
  operationalPeriodKey: string;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('client_operations_user_columns_period_setup').upsert(
    {
      organization_id: input.organizationId,
      operational_period_key: input.operationalPeriodKey,
      initialized_at: new Date().toISOString(),
      initialized_by: input.actorUserId,
    },
    { onConflict: 'organization_id,operational_period_key' },
  );
  assertQueryError(error, 'Failed to mark user columns period setup after copy');
}

export async function copyClientOperationsUserPeriodData(input: {
  ctx: RequestContext;
  organizationId: string;
  sourceOperationalPeriodKey: unknown;
  targetOperationalPeriodKey: unknown;
  mode: unknown;
}): Promise<{
  source_period: string;
  target_period: string;
  mode: UserPeriodDataCopyMode;
  custom_values_copied_count: number;
  manual_values_copied_count: number;
}> {
  const sourcePeriod = periodKeyFrom(input.sourceOperationalPeriodKey);
  const targetPeriod = periodKeyFrom(input.targetOperationalPeriodKey);
  if (sourcePeriod === targetPeriod) {
    throw badRequest('source_operational_period_key must differ from target_operational_period_key');
  }

  let mode: UserPeriodDataCopyMode;
  try {
    mode = parseUserPeriodDataCopyMode(input.mode ?? 'empty_only');
  } catch {
    throw badRequest('mode must be empty_only | replace_existing');
  }

  const columns = await loadActiveCustomColumnsExtended(input.organizationId);
  const eligibleColumnIds = new Set(columns.map((c) => c.id));

  const [sourceCustom, targetCustom, sourceManual, targetManual] = await Promise.all([
    loadCustomPeriodValues({ organizationId: input.organizationId, operationalPeriodKey: sourcePeriod }),
    loadCustomPeriodValues({ organizationId: input.organizationId, operationalPeriodKey: targetPeriod }),
    loadManualPeriodValues({ organizationId: input.organizationId, operationalPeriodKey: sourcePeriod }),
    loadManualPeriodValues({ organizationId: input.organizationId, operationalPeriodKey: targetPeriod }),
  ]);

  const customPlan = planCustomColumnPeriodValueCopies({
    mode,
    sourceRows: sourceCustom,
    targetRows: targetCustom,
    eligibleColumnIds,
  });
  const manualPlan = planManualRowPeriodValueCopies({
    mode,
    sourceRows: sourceManual,
    targetRows: targetManual,
  });

  const columnIdsNeedingVisibility = new Set(customPlan.map((row) => row.column_id));
  for (const columnId of columnIdsNeedingVisibility) {
    await ensureVisibilityRowForPeriod({
      organizationId: input.organizationId,
      columnId,
      operationalPeriodKey: targetPeriod,
      actorUserId: input.ctx.user.id,
    });
  }

  if (manualPlan.length > 0) {
    await initializeManualRowsForPeriod({
      ctx: input.ctx,
      organizationId: input.organizationId,
      operationalPeriodKey: targetPeriod,
    });
  }

  for (const row of customPlan) {
    await upsertPeriodCustomColumnValueRow({
      organizationId: input.organizationId,
      clientId: row.client_id,
      columnId: row.column_id,
      operationalPeriodKey: targetPeriod,
      values: row.values,
    });
  }

  for (const row of manualPlan) {
    await upsertManualPeriodValue({
      organizationId: input.organizationId,
      operationalPeriodKey: targetPeriod,
      slot: row.slot,
      columnKey: row.column_key,
      valueText: row.value_text,
      actorUserId: input.ctx.user.id,
    });
  }

  if (customPlan.length > 0 || columnIdsNeedingVisibility.size > 0) {
    await markUserColumnsPeriodSetup({
      organizationId: input.organizationId,
      operationalPeriodKey: targetPeriod,
      actorUserId: input.ctx.user.id,
    });
  }

  const result = {
    source_period: sourcePeriod,
    target_period: targetPeriod,
    mode,
    custom_values_copied_count: customPlan.length,
    manual_values_copied_count: manualPlan.length,
  };

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_user_period_data',
    entityId: `${input.organizationId}:${targetPeriod}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_USER_PERIOD_DATA_COPIED,
    payload: result,
  });

  return result;
}

/**
 * Org-scoped periods that contain meaningful user-entered custom/manual values.
 * Independent of applicability snapshots / material facts / available_periods tabs.
 */
export async function loadUserPeriodDataCopySourcePeriods(
  organizationId: string,
): Promise<string[]> {
  const [customRes, manualRes] = await Promise.all([
    supabaseAdmin
      .from('client_operations_registry_custom_column_period_values')
      .select('operational_period_key, value_text, value_number, value_date, value_bool')
      .eq('organization_id', organizationId),
    supabaseAdmin
      .from('client_operations_manual_row_cell_values')
      .select('operational_period_key, column_key, value_text')
      .eq('organization_id', organizationId),
  ]);
  assertQueryError(customRes.error, 'Failed to load custom period keys for copy sources');
  assertQueryError(manualRes.error, 'Failed to load manual period keys for copy sources');

  const customPeriodKeys: string[] = [];
  for (const row of (customRes.data ?? []) as Array<{
    operational_period_key: string;
    value_text: string | null;
    value_number: number | string | null;
    value_date: string | null;
    value_bool: boolean | null;
  }>) {
    if (
      !isMeaningfulTypedValue({
        value_text: row.value_text,
        value_number: row.value_number,
        value_date: row.value_date,
        value_bool: row.value_bool,
      })
    ) {
      continue;
    }
    customPeriodKeys.push(row.operational_period_key);
  }

  const manualPeriodKeys: string[] = [];
  for (const row of (manualRes.data ?? []) as Array<{
    operational_period_key: string;
    column_key: string;
    value_text: string;
  }>) {
    if (!isClientOperationsManualFreeTextColumnKey(row.column_key)) continue;
    if (!isMeaningfulManualCellValue(row.value_text)) continue;
    manualPeriodKeys.push(row.operational_period_key);
  }

  return buildUserPeriodDataCopySourcePeriods({ customPeriodKeys, manualPeriodKeys });
}
