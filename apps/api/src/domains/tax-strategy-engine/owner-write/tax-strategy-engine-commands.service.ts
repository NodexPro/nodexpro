import { supabaseAdmin } from '../../../db/client.js';
import type { RequestContext } from '../../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../../shared/audit-events.js';
import { assertOwnerLegalCommandAccess } from '../../owner-country-legal-access/owner-country-legal-access.service.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { assertCountryExists } from '../../country-pack/country.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../../country-pack/country-pack-read-models.service.js';
import { taxStrategyChecksumFromDraftState } from '../tax-strategy-engine-checksum.pure.js';
import {
  isTaxStrategyEngineCommand,
  type TaxStrategyEngineCommandName,
  type TaxStrategyEngineCommandResponse,
} from '../tax-strategy-engine-commands.types.js';

export { isTaxStrategyEngineCommand, TAX_STRATEGY_ENGINE_COMMANDS } from '../tax-strategy-engine-commands.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORED_METADATA_KEYS = new Set([
  'explanation',
  'benefits',
  'risks',
  'constraints',
  'costs_tradeoffs',
  'category',
  'domain',
  'tags',
]);
const STRING_ARRAY_KEYS = new Set(['benefits', 'risks', 'constraints', 'costs_tradeoffs', 'tags']);
const OPTIONAL_STRING_KEYS = new Set(['category', 'domain']);

type StrategyIdentityRow = {
  id: string;
  country_code: string;
  strategy_code: string;
  admin_label: string | null;
  owner_note: string | null;
};

type ExclusiveGroupRow = {
  id: string;
  country_code: string;
  group_code: string;
  title: string;
  owner_note: string | null;
};

type StrategyVersionRow = {
  id: string;
  tax_strategy_id: string;
  country_code: string;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  title: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string | null;
  authored_metadata_json: Record<string, unknown>;
  strategy_checksum: string;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
};

type RulePinRow = {
  id: string;
  tax_strategy_version_id: string;
  tax_rule_version_id: string;
  pin_role: string;
};

type CalcPinRow = {
  id: string;
  tax_strategy_version_id: string;
  calculation_definition_version_id: string;
};

const VERSION_SELECT =
  'id, tax_strategy_id, country_code, version_no, status, effective_from, effective_to, title, requires_professional_judgment, exclusive_group_id, authored_metadata_json, strategy_checksum, supersedes_version_id, superseded_by_version_id';

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function asOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const next = value.trim();
  return next.length ? next : null;
}

function asDate(value: unknown, field: string): string {
  const next = asString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
    throw badRequest(`${field} must be YYYY-MM-DD`);
  }
  return next;
}

function asOptionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asDate(value, field);
}

function asUuid(value: unknown, field: string): string {
  const id = asString(value, field);
  if (!UUID_RE.test(id)) {
    throw badRequest(`${field} must be a UUID`);
  }
  return id;
}

function asOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asUuid(value, field);
}

function asCountryCode(value: unknown): string {
  const countryCode = asString(value, 'country_code').toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw badRequest('country_code must be ISO 3166-1 alpha-2');
  }
  return countryCode;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}

function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return asBoolean(value, field);
}

function rejectLatestResolution(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (/latest/i.test(key)) {
      throw badRequest('Strategy Engine commands do not resolve latest versions');
    }
  }
}

function parseAuthoredMetadata(value: unknown, field = 'authored_metadata_json'): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`${field} must be an object`);
  }
  const src = value as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (!AUTHORED_METADATA_KEYS.has(key)) {
      throw badRequest(`${field} contains unsupported key: ${key}`);
    }
  }
  const out: Record<string, unknown> = {};
  if ('explanation' in src) {
    if (typeof src.explanation !== 'string') {
      throw badRequest(`${field}.explanation must be a string`);
    }
    out.explanation = src.explanation;
  }
  for (const key of STRING_ARRAY_KEYS) {
    if (!(key in src)) continue;
    const arr = src[key];
    if (!Array.isArray(arr) || arr.some((item) => typeof item !== 'string')) {
      throw badRequest(`${field}.${key} must be a string array`);
    }
    out[key] = arr;
  }
  for (const key of OPTIONAL_STRING_KEYS) {
    if (!(key in src)) continue;
    if (src[key] !== null && typeof src[key] !== 'string') {
      throw badRequest(`${field}.${key} must be a string or null`);
    }
    out[key] = src[key];
  }
  return out;
}

function authoredFromRow(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function throwIfStrategyWriteError(
  error: { code?: string; message?: string; details?: string } | null,
  uniqueMessage: string,
): void {
  if (!error) return;
  const code = String(error.code ?? '');
  const message = [error.message, error.details].filter(Boolean).join(' ');
  if (code === '23505' || /monotonic per strategy/i.test(message)) {
    throw conflict(uniqueMessage);
  }
  if (code === '23503') {
    throw badRequest(message || 'Referenced Strategy Engine row was not found');
  }
  throwIfStrategyLifecycleError(error);
}

function throwIfStrategyLifecycleError(
  error: { code?: string; message?: string; details?: string } | null,
): void {
  if (!error) return;
  const code = String(error.code ?? '');
  const message = [error.message, error.details].filter(Boolean).join(' ');
  if (/cannot activate without/i.test(message) || /cannot activate while/i.test(message) || /cannot activate with required and prohibited/i.test(message)) {
    throw conflict(message);
  }
  if (/Invalid tax_strategy_versions status transition/i.test(message)) {
    throw conflict(message);
  }
  if (/effective_to cannot/i.test(message) || /effective_to is frozen/i.test(message)) {
    throw conflict(message);
  }
  if (code === '23P01' || /exclusion constraint/i.test(message) || /no_active_overlap/i.test(message)) {
    throw conflict('Active tax strategy versions cannot overlap');
  }
  if (/Tax strategy version not found/i.test(message)) {
    throw notFound('Tax strategy version not found');
  }
  if (/must be different/i.test(message) && /old_tax_strategy_version_id/i.test(message)) {
    throw badRequest('new_tax_strategy_version_id and old_tax_strategy_version_id must be different');
  }
  if (/NEW version to be draft/i.test(message) || /OLD version to be active/i.test(message)) {
    throw conflict(message);
  }
  if (/same tax_strategy/i.test(message) || /same country/i.test(message)) {
    throw badRequest(message);
  }
  if (/supersedes_version_id must be empty/i.test(message) || /authored fields are immutable/i.test(message)) {
    throw conflict(message);
  }
  if (/must be inserted as draft/i.test(message) || /children are immutable/i.test(message)) {
    throw conflict(message);
  }
  if (/Cross-country/i.test(message)) {
    throw badRequest(message);
  }
  if (/country_code is immutable/i.test(message) || /strategy_code is immutable/i.test(message) || /group_code is immutable/i.test(message)) {
    throw conflict(message);
  }
  if (code === '23505') {
    throw conflict(message || 'Strategy Engine unique constraint violated');
  }
  if (code === '23514') {
    throw conflict(message || 'tax strategy check constraint violated');
  }
  throw error;
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType,
    entityId,
    action,
    payload,
  });
}

async function refreshedOwnerLegalControlPanel(
  ctx: RequestContext,
  countryCode: string,
): Promise<TaxStrategyEngineCommandResponse['refreshed']> {
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, {
      tax_knowledge_country_code: countryCode,
      strategy_engine_country_code: countryCode,
    }),
  };
}

async function loadStrategy(id: string): Promise<StrategyIdentityRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategies')
    .select('id, country_code, strategy_code, admin_label, owner_note')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax strategy not found');
  return data as StrategyIdentityRow;
}

async function loadExclusiveGroup(id: string): Promise<ExclusiveGroupRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_exclusive_groups')
    .select('id, country_code, group_code, title, owner_note')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax strategy exclusive group not found');
  return data as ExclusiveGroupRow;
}

async function loadVersion(id: string): Promise<StrategyVersionRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .select(VERSION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax strategy version not found');
  return {
    ...(data as Omit<StrategyVersionRow, 'authored_metadata_json'>),
    authored_metadata_json: authoredFromRow((data as { authored_metadata_json?: unknown }).authored_metadata_json),
  };
}

async function loadRulePin(id: string): Promise<RulePinRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_version_rule_pins')
    .select('id, tax_strategy_version_id, tax_rule_version_id, pin_role')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax strategy rule pin not found');
  return data as RulePinRow;
}

async function loadCalcPin(id: string): Promise<CalcPinRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_version_calculation_pins')
    .select('id, tax_strategy_version_id, calculation_definition_version_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax strategy calculation pin not found');
  return data as CalcPinRow;
}

async function loadRuleVersion(id: string): Promise<{ id: string; tax_rule_id: string; country_code: string; status: string }> {
  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('id, tax_rule_id, country_code, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax rule version not found');
  return data as { id: string; tax_rule_id: string; country_code: string; status: string };
}

async function loadCalcVersion(id: string): Promise<{
  id: string;
  tax_calculation_definition_id: string;
  country_code: string;
  status: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('tax_calculation_definition_versions')
    .select('id, tax_calculation_definition_id, country_code, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax calculation definition version not found');
  return data as {
    id: string;
    tax_calculation_definition_id: string;
    country_code: string;
    status: string;
  };
}

async function nextVersionNo(taxStrategyId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .select('version_no')
    .eq('tax_strategy_id', taxStrategyId)
    .order('version_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const current = data?.[0]?.version_no;
  return (typeof current === 'number' ? current : 0) + 1;
}

async function loadDraftPins(versionId: string): Promise<{
  rule_pins: Array<{ pin_role: string; tax_rule_version_id: string }>;
  calculation_pins: Array<{ calculation_definition_version_id: string }>;
}> {
  const [rules, calcs] = await Promise.all([
    supabaseAdmin
      .from('tax_strategy_version_rule_pins')
      .select('pin_role, tax_rule_version_id')
      .eq('tax_strategy_version_id', versionId),
    supabaseAdmin
      .from('tax_strategy_version_calculation_pins')
      .select('calculation_definition_version_id')
      .eq('tax_strategy_version_id', versionId),
  ]);
  if (rules.error) throw rules.error;
  if (calcs.error) throw calcs.error;
  return {
    rule_pins: (rules.data ?? []).map((row) => ({
      pin_role: String(row.pin_role),
      tax_rule_version_id: String(row.tax_rule_version_id),
    })),
    calculation_pins: (calcs.data ?? []).map((row) => ({
      calculation_definition_version_id: String(row.calculation_definition_version_id),
    })),
  };
}

async function persistDraftChecksum(version: StrategyVersionRow): Promise<string> {
  const pins = await loadDraftPins(version.id);
  const checksum = taxStrategyChecksumFromDraftState({
    country_code: version.country_code,
    title: version.title,
    requires_professional_judgment: version.requires_professional_judgment === true,
    exclusive_group_id: version.exclusive_group_id,
    authored_metadata_json: version.authored_metadata_json,
    rule_pins: pins.rule_pins,
    calculation_pins: pins.calculation_pins,
  });
  const { error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .update({ strategy_checksum: checksum })
    .eq('id', version.id)
    .eq('status', 'draft');
  throwIfStrategyLifecycleError(error);
  return checksum;
}

function checksumForEmptyPins(input: {
  country_code: string;
  title: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string | null;
  authored_metadata_json: Record<string, unknown>;
}): string {
  return taxStrategyChecksumFromDraftState({
    ...input,
    rule_pins: [],
    calculation_pins: [],
  });
}

async function handleCreateTaxStrategy(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const strategyCode = asString(payload.strategy_code, 'strategy_code');
  const adminLabel = asOptionalString(payload.admin_label, 'admin_label');
  const ownerNote = asOptionalString(payload.owner_note, 'owner_note');

  const { data, error } = await supabaseAdmin
    .from('tax_strategies')
    .insert({
      country_code: countryCode,
      strategy_code: strategyCode,
      admin_label: adminLabel,
      owner_note: ownerNote,
    })
    .select('id, country_code, strategy_code')
    .maybeSingle();
  throwIfStrategyWriteError(error, 'tax_strategy already exists for this country_code + strategy_code');
  if (!data) throw conflict('tax_strategy insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_CREATED, 'tax_strategy', String(data.id), {
    country_code: data.country_code,
    strategy_code: data.strategy_code,
  });

  return {
    ok: true,
    command: 'create_tax_strategy',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, countryCode),
  };
}

async function handleUpdateTaxStrategyMetadata(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  if ('country_code' in payload || 'strategy_code' in payload) {
    throw badRequest('country_code and strategy_code are immutable');
  }
  const strategyId = asUuid(payload.tax_strategy_id, 'tax_strategy_id');
  const current = await loadStrategy(strategyId);
  const patch: Record<string, string | null> = {};
  if ('admin_label' in payload) patch.admin_label = asOptionalString(payload.admin_label, 'admin_label');
  if ('owner_note' in payload) patch.owner_note = asOptionalString(payload.owner_note, 'owner_note');

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('tax_strategies').update(patch).eq('id', strategyId);
    throwIfStrategyWriteError(error, 'tax_strategy metadata update failed');
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_METADATA_UPDATED, 'tax_strategy', strategyId, {
    country_code: current.country_code,
    strategy_code: current.strategy_code,
  });

  return {
    ok: true,
    command: 'update_tax_strategy_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, current.country_code),
  };
}

async function handleCreateExclusiveGroup(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const groupCode = asString(payload.group_code, 'group_code');
  const title = asString(payload.title, 'title');
  const ownerNote = asOptionalString(payload.owner_note, 'owner_note');

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_exclusive_groups')
    .insert({
      country_code: countryCode,
      group_code: groupCode,
      title,
      owner_note: ownerNote,
    })
    .select('id, country_code, group_code')
    .maybeSingle();
  throwIfStrategyWriteError(error, 'tax_strategy_exclusive_group already exists for this country_code + group_code');
  if (!data) throw conflict('tax_strategy_exclusive_group insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_EXCLUSIVE_GROUP_CREATED, 'tax_strategy_exclusive_group', String(data.id), {
    country_code: data.country_code,
    group_code: data.group_code,
  });

  return {
    ok: true,
    command: 'create_tax_strategy_exclusive_group',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, countryCode),
  };
}

async function handleUpdateExclusiveGroup(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  if ('country_code' in payload || 'group_code' in payload) {
    throw badRequest('country_code and group_code are immutable');
  }
  const groupId = asUuid(payload.tax_strategy_exclusive_group_id, 'tax_strategy_exclusive_group_id');
  const current = await loadExclusiveGroup(groupId);
  const patch: Record<string, string | null> = {};
  if ('title' in payload) patch.title = asString(payload.title, 'title');
  if ('owner_note' in payload) patch.owner_note = asOptionalString(payload.owner_note, 'owner_note');

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin
      .from('tax_strategy_exclusive_groups')
      .update(patch)
      .eq('id', groupId);
    throwIfStrategyWriteError(error, 'tax_strategy_exclusive_group update failed');
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_EXCLUSIVE_GROUP_UPDATED, 'tax_strategy_exclusive_group', groupId, {
    country_code: current.country_code,
    group_code: current.group_code,
  });

  return {
    ok: true,
    command: 'update_tax_strategy_exclusive_group',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, current.country_code),
  };
}

async function handleCreateTaxStrategyVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  if (payload.status !== undefined && payload.status !== null && payload.status !== '') {
    if (asString(payload.status, 'status') !== 'draft') {
      throw badRequest("create_tax_strategy_version inserts status 'draft' only");
    }
  }
  if (payload.version_no !== undefined) {
    throw badRequest('version_no is assigned by the backend');
  }
  if (payload.country_code !== undefined) {
    throw badRequest('country_code is inherited from the parent tax_strategy');
  }
  if (payload.supersedes_version_id !== undefined || payload.superseded_by_version_id !== undefined) {
    throw badRequest('create_tax_strategy_version does not set lineage');
  }

  const strategyId = asUuid(payload.tax_strategy_id, 'tax_strategy_id');
  const parent = await loadStrategy(strategyId);
  const effectiveFrom = asDate(payload.effective_from, 'effective_from');
  const effectiveTo = asOptionalDate(payload.effective_to, 'effective_to');
  if (effectiveTo != null && effectiveTo < effectiveFrom) {
    throw badRequest('effective_to must be >= effective_from');
  }
  const title = asString(payload.title, 'title');
  const requiresJudgment = asBoolean(payload.requires_professional_judgment, 'requires_professional_judgment');
  const exclusiveGroupId = asOptionalUuid(payload.exclusive_group_id, 'exclusive_group_id');
  if (!('authored_metadata_json' in payload)) {
    throw badRequest('authored_metadata_json is required');
  }
  const authored = parseAuthoredMetadata(payload.authored_metadata_json);
  if (exclusiveGroupId) {
    const group = await loadExclusiveGroup(exclusiveGroupId);
    if (group.country_code !== parent.country_code) {
      throw badRequest('exclusive_group_id must belong to the same country as the parent tax_strategy');
    }
  }

  const versionNo = await nextVersionNo(strategyId);
  const checksum = checksumForEmptyPins({
    country_code: parent.country_code,
    title,
    requires_professional_judgment: requiresJudgment,
    exclusive_group_id: exclusiveGroupId,
    authored_metadata_json: authored,
  });

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .insert({
      tax_strategy_id: strategyId,
      country_code: parent.country_code,
      version_no: versionNo,
      status: 'draft',
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      title,
      requires_professional_judgment: requiresJudgment,
      exclusive_group_id: exclusiveGroupId,
      authored_metadata_json: authored,
      strategy_checksum: checksum,
    })
    .select('id, tax_strategy_id, country_code, version_no, status, strategy_checksum')
    .maybeSingle();
  throwIfStrategyWriteError(error, 'tax_strategy_version insert conflict');
  if (!data) throw conflict('tax_strategy_version insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_CREATED, 'tax_strategy_version', String(data.id), {
    tax_strategy_id: data.tax_strategy_id,
    country_code: data.country_code,
    version_no: data.version_no,
    status: data.status,
    strategy_checksum: data.strategy_checksum,
  });

  return {
    ok: true,
    command: 'create_tax_strategy_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, parent.country_code),
  };
}

async function handleUpdateTaxStrategyVersionDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const current = await loadVersion(versionId);
  if (current.status !== 'draft') {
    throw conflict('update_tax_strategy_version_draft is only valid while the version is draft');
  }
  for (const locked of [
    'status',
    'version_no',
    'country_code',
    'tax_strategy_id',
    'supersedes_version_id',
    'superseded_by_version_id',
    'strategy_checksum',
    'activated_at',
    'retired_at',
    'retired_reason',
  ]) {
    if (locked in payload) {
      throw badRequest(`${locked} cannot be mutated by update_tax_strategy_version_draft`);
    }
  }

  const patch: Record<string, unknown> = {};
  let semanticChanged = false;
  if ('effective_from' in payload) patch.effective_from = asDate(payload.effective_from, 'effective_from');
  if ('effective_to' in payload) patch.effective_to = asOptionalDate(payload.effective_to, 'effective_to');
  if ('title' in payload) {
    patch.title = asString(payload.title, 'title');
    semanticChanged = true;
  }
  if ('requires_professional_judgment' in payload) {
    patch.requires_professional_judgment = asOptionalBoolean(
      payload.requires_professional_judgment,
      'requires_professional_judgment',
    );
    semanticChanged = true;
  }
  if ('exclusive_group_id' in payload) {
    const exclusiveGroupId = asOptionalUuid(payload.exclusive_group_id, 'exclusive_group_id');
    if (exclusiveGroupId) {
      const group = await loadExclusiveGroup(exclusiveGroupId);
      if (group.country_code !== current.country_code) {
        throw badRequest('exclusive_group_id must belong to the same country as the tax_strategy_version');
      }
    }
    patch.exclusive_group_id = exclusiveGroupId;
    semanticChanged = true;
  }
  if ('authored_metadata_json' in payload) {
    patch.authored_metadata_json = parseAuthoredMetadata(payload.authored_metadata_json);
    semanticChanged = true;
  }

  const nextFrom = (patch.effective_from as string | undefined) ?? current.effective_from;
  const nextTo =
    'effective_to' in patch ? (patch.effective_to as string | null) : current.effective_to;
  if (nextTo != null && nextTo < nextFrom) {
    throw badRequest('effective_to must be >= effective_from');
  }

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin
      .from('tax_strategy_versions')
      .update(patch)
      .eq('id', versionId)
      .eq('status', 'draft');
    throwIfStrategyLifecycleError(error);
  }

  if (semanticChanged) {
    const updated = await loadVersion(versionId);
    await persistDraftChecksum(updated);
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_DRAFT_UPDATED, 'tax_strategy_version', versionId, {
    tax_strategy_id: current.tax_strategy_id,
    country_code: current.country_code,
    checksum_updated: semanticChanged,
  });

  return {
    ok: true,
    command: 'update_tax_strategy_version_draft',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, current.country_code),
  };
}

async function handlePinTaxStrategyRule(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const ruleVersionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const pinRole = asString(payload.pin_role, 'pin_role');
  if (pinRole !== 'required' && pinRole !== 'prohibited') {
    throw badRequest('pin_role must be required or prohibited');
  }
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') {
    throw conflict('pin_tax_strategy_rule is only valid while the parent version is draft');
  }
  const ruleVersion = await loadRuleVersion(ruleVersionId);
  if (ruleVersion.country_code !== version.country_code) {
    throw badRequest('Cross-country tax strategy rule pin is forbidden');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_version_rule_pins')
    .insert({
      tax_strategy_version_id: versionId,
      country_code: version.country_code,
      tax_rule_version_id: ruleVersionId,
      pin_role: pinRole,
    })
    .select('id, tax_strategy_version_id, tax_rule_version_id, pin_role')
    .maybeSingle();
  throwIfStrategyWriteError(error, 'tax_strategy_version_rule_pin already exists for this version + tax_rule_version');
  if (!data) throw conflict('tax_strategy_version_rule_pin insert returned no row');

  const checksum = await persistDraftChecksum(version);
  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_RULE_PINNED, 'tax_strategy_version_rule_pin', String(data.id), {
    tax_strategy_version_id: versionId,
    tax_rule_version_id: ruleVersionId,
    pin_role: pinRole,
    country_code: version.country_code,
    strategy_checksum: checksum,
  });

  return {
    ok: true,
    command: 'pin_tax_strategy_rule',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleUnpinTaxStrategyRule(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const pinId = asUuid(payload.tax_strategy_version_rule_pin_id, 'tax_strategy_version_rule_pin_id');
  const pin = await loadRulePin(pinId);
  const version = await loadVersion(pin.tax_strategy_version_id);
  if (version.status !== 'draft') {
    throw conflict('unpin_tax_strategy_rule is only valid while the parent version is draft');
  }

  const { error } = await supabaseAdmin
    .from('tax_strategy_version_rule_pins')
    .delete()
    .eq('id', pinId);
  throwIfStrategyLifecycleError(error);

  const checksum = await persistDraftChecksum(version);
  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_RULE_UNPINNED, 'tax_strategy_version_rule_pin', pinId, {
    tax_strategy_version_id: version.id,
    tax_rule_version_id: pin.tax_rule_version_id,
    country_code: version.country_code,
    strategy_checksum: checksum,
  });

  return {
    ok: true,
    command: 'unpin_tax_strategy_rule',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handlePinTaxStrategyCalculation(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const calcVersionId = asUuid(payload.calculation_definition_version_id, 'calculation_definition_version_id');
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') {
    throw conflict('pin_tax_strategy_calculation is only valid while the parent version is draft');
  }
  const calcVersion = await loadCalcVersion(calcVersionId);
  if (calcVersion.country_code !== version.country_code) {
    throw badRequest('Cross-country tax strategy calculation pin is forbidden');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_version_calculation_pins')
    .insert({
      tax_strategy_version_id: versionId,
      country_code: version.country_code,
      calculation_definition_version_id: calcVersionId,
    })
    .select('id, tax_strategy_version_id, calculation_definition_version_id')
    .maybeSingle();
  throwIfStrategyWriteError(
    error,
    'tax_strategy_version_calculation_pin already exists for this version + calculation_definition_version',
  );
  if (!data) throw conflict('tax_strategy_version_calculation_pin insert returned no row');

  const checksum = await persistDraftChecksum(version);
  await audit(
    ctx,
    AUDIT_ACTIONS.TAX_STRATEGY_CALCULATION_PINNED,
    'tax_strategy_version_calculation_pin',
    String(data.id),
    {
      tax_strategy_version_id: versionId,
      calculation_definition_version_id: calcVersionId,
      country_code: version.country_code,
      strategy_checksum: checksum,
    },
  );

  return {
    ok: true,
    command: 'pin_tax_strategy_calculation',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleUnpinTaxStrategyCalculation(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const pinId = asUuid(
    payload.tax_strategy_version_calculation_pin_id,
    'tax_strategy_version_calculation_pin_id',
  );
  const pin = await loadCalcPin(pinId);
  const version = await loadVersion(pin.tax_strategy_version_id);
  if (version.status !== 'draft') {
    throw conflict('unpin_tax_strategy_calculation is only valid while the parent version is draft');
  }

  const { error } = await supabaseAdmin
    .from('tax_strategy_version_calculation_pins')
    .delete()
    .eq('id', pinId);
  throwIfStrategyLifecycleError(error);

  const checksum = await persistDraftChecksum(version);
  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_CALCULATION_UNPINNED, 'tax_strategy_version_calculation_pin', pinId, {
    tax_strategy_version_id: version.id,
    calculation_definition_version_id: pin.calculation_definition_version_id,
    country_code: version.country_code,
    strategy_checksum: checksum,
  });

  return {
    ok: true,
    command: 'unpin_tax_strategy_calculation',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleActivateTaxStrategyVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') {
    throw conflict('activate_tax_strategy_version is only valid from draft to active');
  }

  const checksum = await persistDraftChecksum(version);
  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .update({ status: 'active' })
    .eq('id', versionId)
    .eq('status', 'draft')
    .select('id, tax_strategy_id, country_code, status, version_no, strategy_checksum')
    .maybeSingle();
  throwIfStrategyLifecycleError(error);
  if (!data) {
    throw conflict('activate_tax_strategy_version is only valid from draft to active');
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_ACTIVATED, 'tax_strategy_version', versionId, {
    tax_strategy_id: data.tax_strategy_id,
    country_code: data.country_code,
    previous_status: version.status,
    status: data.status,
    version_no: data.version_no,
    strategy_checksum: data.strategy_checksum ?? checksum,
  });

  return {
    ok: true,
    command: 'activate_tax_strategy_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleRetireTaxStrategyVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const version = await loadVersion(versionId);
  if (version.status === 'retired') {
    throw conflict('tax_strategy_version is already retired');
  }
  if (version.status !== 'draft' && version.status !== 'active') {
    throw conflict('retire_tax_strategy_version is only valid from draft or active');
  }
  const retiredReason = asOptionalString(payload.retired_reason, 'retired_reason');

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .update({
      status: 'retired',
      retired_reason: retiredReason,
    })
    .eq('id', versionId)
    .in('status', ['draft', 'active'])
    .select('id, tax_strategy_id, country_code, status')
    .maybeSingle();
  throwIfStrategyLifecycleError(error);
  if (!data) {
    throw conflict('retire_tax_strategy_version is only valid from draft or active');
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_RETIRED, 'tax_strategy_version', versionId, {
    tax_strategy_id: data.tax_strategy_id,
    country_code: data.country_code,
    previous_status: version.status,
    status: data.status,
    retired_reason: retiredReason,
  });

  return {
    ok: true,
    command: 'retire_tax_strategy_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleCloseTaxStrategyVersionEffectiveTo(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const versionId = asUuid(payload.tax_strategy_version_id, 'tax_strategy_version_id');
  const effectiveTo = asDate(payload.effective_to, 'effective_to');
  const version = await loadVersion(versionId);
  if (version.status === 'retired') {
    throw conflict('tax_strategy_versions.effective_to is frozen after retirement');
  }
  if (version.status !== 'active') {
    throw conflict('close_tax_strategy_version_effective_to is only valid while the version is active');
  }
  if (effectiveTo < version.effective_from) {
    throw badRequest('effective_to must be >= effective_from');
  }
  if (version.effective_to != null && effectiveTo > version.effective_to) {
    throw conflict('tax_strategy_versions.effective_to cannot be extended after leaving draft');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_strategy_versions')
    .update({ effective_to: effectiveTo })
    .eq('id', versionId)
    .eq('status', 'active')
    .select('id, tax_strategy_id, country_code, status, effective_from, effective_to')
    .maybeSingle();
  throwIfStrategyLifecycleError(error);
  if (!data) {
    throw conflict('close_tax_strategy_version_effective_to is only valid while the version is active');
  }

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_EFFECTIVE_TO_CLOSED, 'tax_strategy_version', versionId, {
    tax_strategy_id: data.tax_strategy_id,
    country_code: data.country_code,
    previous_effective_to: version.effective_to,
    effective_to: data.effective_to,
  });

  return {
    ok: true,
    command: 'close_tax_strategy_version_effective_to',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleSupersedeTaxStrategyVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  rejectLatestResolution(payload);
  const newId = asUuid(payload.new_tax_strategy_version_id, 'new_tax_strategy_version_id');
  const oldId = asUuid(payload.old_tax_strategy_version_id, 'old_tax_strategy_version_id');
  if (newId === oldId) {
    throw badRequest('new_tax_strategy_version_id and old_tax_strategy_version_id must be different');
  }

  const neu = await loadVersion(newId);
  const old = await loadVersion(oldId);
  if (neu.status !== 'draft') {
    throw conflict('supersede_tax_strategy_version requires the NEW version to be draft');
  }
  if (old.status !== 'active') {
    throw conflict('supersede_tax_strategy_version requires the OLD version to be active');
  }
  if (neu.tax_strategy_id !== old.tax_strategy_id) {
    throw badRequest('NEW and OLD tax strategy versions must belong to the same tax_strategy');
  }
  if (neu.country_code !== old.country_code) {
    throw badRequest('NEW and OLD tax strategy versions must belong to the same country');
  }
  if (neu.supersedes_version_id != null && neu.supersedes_version_id !== old.id) {
    throw conflict('NEW.supersedes_version_id must be empty or exactly the OLD version');
  }

  const checksum = await persistDraftChecksum(neu);
  const { data, error } = await supabaseAdmin.rpc('tax_strategy_engine_supersede_tax_strategy_version', {
    p_new_tax_strategy_version_id: newId,
    p_old_tax_strategy_version_id: oldId,
  });
  throwIfStrategyLifecycleError(error);
  if (!data) throw new Error('tax_strategy_engine_supersede_tax_strategy_version returned no result');

  await audit(ctx, AUDIT_ACTIONS.TAX_STRATEGY_VERSION_SUPERSEDED, 'tax_strategy_version', newId, {
    old_tax_strategy_version_id: oldId,
    new_tax_strategy_version_id: newId,
    tax_strategy_id: neu.tax_strategy_id,
    country_code: neu.country_code,
    previous_old_status: old.status,
    previous_new_status: neu.status,
    strategy_checksum: checksum,
  });

  return {
    ok: true,
    command: 'supersede_tax_strategy_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, neu.country_code),
  };
}

export async function executeTaxStrategyEngineCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxStrategyEngineCommandResponse> {
  await assertOwnerLegalCommandAccess(ctx, command, payload);

  if (!isTaxStrategyEngineCommand(command)) {
    throw badRequest(`Unsupported tax-strategy-engine command: ${command || 'unknown'}`);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw badRequest('payload must be an object');
  }

  const name: TaxStrategyEngineCommandName = command;
  switch (name) {
    case 'create_tax_strategy':
      return handleCreateTaxStrategy(ctx, payload);
    case 'update_tax_strategy_metadata':
      return handleUpdateTaxStrategyMetadata(ctx, payload);
    case 'create_tax_strategy_exclusive_group':
      return handleCreateExclusiveGroup(ctx, payload);
    case 'update_tax_strategy_exclusive_group':
      return handleUpdateExclusiveGroup(ctx, payload);
    case 'create_tax_strategy_version':
      return handleCreateTaxStrategyVersion(ctx, payload);
    case 'update_tax_strategy_version_draft':
      return handleUpdateTaxStrategyVersionDraft(ctx, payload);
    case 'activate_tax_strategy_version':
      return handleActivateTaxStrategyVersion(ctx, payload);
    case 'retire_tax_strategy_version':
      return handleRetireTaxStrategyVersion(ctx, payload);
    case 'close_tax_strategy_version_effective_to':
      return handleCloseTaxStrategyVersionEffectiveTo(ctx, payload);
    case 'supersede_tax_strategy_version':
      return handleSupersedeTaxStrategyVersion(ctx, payload);
    case 'pin_tax_strategy_rule':
      return handlePinTaxStrategyRule(ctx, payload);
    case 'unpin_tax_strategy_rule':
      return handleUnpinTaxStrategyRule(ctx, payload);
    case 'pin_tax_strategy_calculation':
      return handlePinTaxStrategyCalculation(ctx, payload);
    case 'unpin_tax_strategy_calculation':
      return handleUnpinTaxStrategyCalculation(ctx, payload);
    default: {
      const _never: never = name;
      throw badRequest(`Unsupported tax-strategy-engine command: ${String(_never)}`);
    }
  }
}
