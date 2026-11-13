/**
 * Tenant-scoped monthly self-employed NI handling settings.
 * Not Accounting Base payment truth. Not identity-number keyed.
 * TEMPORARY_COUNTRY_PACK_PENDING: the 15th office reminder is an internal
 * threshold applied in the reporting aggregate, not a statutory due date.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError } from '../../shared/errors.js';
import {
  parseSelfEmployedNiHandlingMethod,
  resolveSelfEmployedNiHandlingMethod,
  type SelfEmployedNiHandlingMethod,
  type SelfEmployedNiHandlingMethodSource,
  type SelfEmployedNiMonthSettingInput,
} from './client-operations-reporting-dashboard.pure.js';

export const SELF_EMPLOYED_NI_MONTH_SETTINGS_TABLE =
  'client_operations_self_employed_ni_month_settings';

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

export type SelfEmployedNiMonthSettingRow = SelfEmployedNiMonthSettingInput & {
  client_id: string;
};

export async function loadSelfEmployedNiMonthSettings(input: {
  organizationId: string;
  clientIds: readonly string[];
  throughPeriodKey: string;
}): Promise<Map<string, SelfEmployedNiMonthSettingRow[]>> {
  const byClient = new Map<string, SelfEmployedNiMonthSettingRow[]>();
  if (!input.clientIds.length) return byClient;
  const { data, error } = await supabaseAdmin
    .from(SELF_EMPLOYED_NI_MONTH_SETTINGS_TABLE)
    .select('client_id, period_key, handling_method')
    .eq('organization_id', input.organizationId)
    .in('client_id', [...input.clientIds])
    .lte('period_key', input.throughPeriodKey);
  assertQueryError(error, 'Failed to load self-employed national insurance month settings');
  for (const row of (data ?? []) as Array<{
    client_id: string;
    period_key: string;
    handling_method: string | null;
  }>) {
    const clientId = String(row.client_id ?? '');
    if (!clientId) continue;
    const list = byClient.get(clientId) ?? [];
    list.push({
      client_id: clientId,
      period_key: String(row.period_key ?? ''),
      handling_method: parseSelfEmployedNiHandlingMethod(row.handling_method),
    });
    byClient.set(clientId, list);
  }
  return byClient;
}

export async function persistSelfEmployedNiMonthSetting(input: {
  organizationId: string;
  clientId: string;
  periodKey: string;
  handlingMethod: SelfEmployedNiHandlingMethod | null;
  actorUserId: string;
  standingOrderUntil?: string | null;
}): Promise<{
  changed: boolean;
  previousMethod: SelfEmployedNiHandlingMethod | null;
  previousSource: SelfEmployedNiHandlingMethodSource;
}> {
  const { data: existingRows, error: loadError } = await supabaseAdmin
    .from(SELF_EMPLOYED_NI_MONTH_SETTINGS_TABLE)
    .select('period_key, handling_method')
    .eq('organization_id', input.organizationId)
    .eq('client_id', input.clientId)
    .lte('period_key', input.periodKey);
  assertQueryError(loadError, 'Failed to load self-employed national insurance month settings');
  const monthSettings: SelfEmployedNiMonthSettingInput[] = (
    (existingRows ?? []) as Array<{ period_key: string; handling_method: string | null }>
  ).map((row) => ({
    period_key: String(row.period_key ?? ''),
    handling_method: parseSelfEmployedNiHandlingMethod(row.handling_method),
  }));
  const existing = monthSettings.find((row) => row.period_key === input.periodKey);
  const before = resolveSelfEmployedNiHandlingMethod({
    periodKey: input.periodKey,
    standingOrderUntil: input.standingOrderUntil,
    monthSettings,
  });
  if (existing && existing.handling_method === input.handlingMethod) {
    return {
      changed: false,
      previousMethod: before.method,
      previousSource: before.source,
    };
  }
  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabaseAdmin.from(SELF_EMPLOYED_NI_MONTH_SETTINGS_TABLE).upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      period_key: input.periodKey,
      handling_method: input.handlingMethod,
      updated_by: input.actorUserId,
      updated_at: nowIso,
    },
    { onConflict: 'organization_id,client_id,period_key' },
  );
  assertQueryError(upsertError, 'Failed to record self-employed national insurance handling');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    moduleCode: 'client-operations',
    entityType: 'client_operations_self_employed_ni_month_setting',
    entityId: input.clientId,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_NI_HANDLING_METHOD_SET,
    payload: {
      client_id: input.clientId,
      operational_period_key: input.periodKey,
      previous_handling_method: before.method,
      previous_handling_method_source: before.source,
      handling_method: input.handlingMethod,
      handling_method_source: 'explicit',
      provenance: 'office_recorded',
      bank_verified: false,
      authority_verified: false,
      statutory_deadline: false,
    },
  });
  return {
    changed: true,
    previousMethod: before.method,
    previousSource: before.source,
  };
}
