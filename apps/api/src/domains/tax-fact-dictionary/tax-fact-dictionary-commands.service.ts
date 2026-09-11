import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertOwnerLegalCommandAccess } from '../owner-country-legal-access/owner-country-legal-access.service.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from '../country-pack/country.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
import {
  taxFactDefinitionChecksum,
  taxFactDefinitionSemanticSnapshot,
} from './tax-fact-dictionary-checksum.pure.js';
import {
  assertCurrencyPolicy,
  assertEnumCode,
  assertEnumOptionLabels,
  assertEnumReadyForActivation,
  assertFactKey,
  assertLocale,
  assertOptionalUnitCode,
  assertStringArray,
  assertValidationJson,
  assertValueType,
} from './tax-fact-dictionary-validation.pure.js';
import {
  isTaxFactDictionaryCommand,
  type TaxFactDictionaryCommandName,
  type TaxFactDictionaryCommandResponse,
} from './tax-fact-dictionary.types.js';

export { isTaxFactDictionaryCommand, TAX_FACT_DICTIONARY_COMMANDS } from './tax-fact-dictionary.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DefinitionRow = {
  id: string;
  fact_key: string;
  country_code: string | null;
  status: string;
  semantic_title: string;
  owner_note: string | null;
};

type VersionRow = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  version_no: number;
  status: string;
  value_type: string;
  unit_code: string | null;
  currency_policy: Record<string, unknown> | null;
  validation_json: Record<string, unknown>;
  definition_checksum: string;
  effective_from: string;
  effective_to: string | null;
};

type EnumRow = {
  id: string;
  tax_fact_definition_version_id: string;
  code: string;
  sort_order: number;
};

type PresentationRow = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
};

const DEFINITION_SELECT = 'id, fact_key, country_code, status, semantic_title, owner_note';
const VERSION_SELECT =
  'id, tax_fact_definition_id, country_code, version_no, status, value_type, unit_code, currency_policy, validation_json, definition_checksum, effective_from, effective_to';

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

function asCountryCode(value: unknown, field = 'country_code'): string {
  const countryCode = asString(value, field).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw badRequest(`${field} must be ISO 3166-1 alpha-2`);
  }
  return countryCode;
}

function asOptionalCountryCode(value: unknown, field = 'country_code'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asCountryCode(value, field);
}

function asNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw badRequest(`${field} must be an integer >= 0`);
  }
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function throwIfFactWriteError(
  error: { code?: string; message?: string; details?: string } | null,
): void {
  if (!error) return;
  const code = String(error.code ?? '');
  const message = [error.message, error.details].filter(Boolean).join(' ');
  if (code === '23505' || /global fact_key must not collide/i.test(message) || /country-scoped fact_key must not collide/i.test(message)) {
    throw conflict(message || 'Fact Dictionary unique constraint violated');
  }
  if (code === '23503') {
    throw badRequest(message || 'Referenced Fact Dictionary row was not found');
  }
  if (code === '23P01' || /exclusion constraint/i.test(message) || /no_active_overlap/i.test(message)) {
    throw conflict('Active fact definition versions cannot overlap');
  }
  if (/must be inserted as draft/i.test(message) || /Invalid tax_fact/i.test(message)) {
    throw conflict(message);
  }
  if (
    /immutable/i.test(message)
    || /cannot activate/i.test(message)
    || /Cannot insert a fact definition version/i.test(message)
    || /requires the exact version to be draft/i.test(message)
    || /checksum mismatch/i.test(message)
    || /semantic snapshot mismatch/i.test(message)
    || /could not activate the exact draft version/i.test(message)
    || /expected definition_checksum is required/i.test(message)
  ) {
    throw conflict(message);
  }
  if (/Tax fact definition version not found/i.test(message)) {
    throw notFound('Tax fact definition version not found');
  }
  if (/Tax fact definition not found/i.test(message)) {
    throw notFound('Tax fact definition not found');
  }
  if (/monotonic per definition/i.test(message) || /effective_to cannot/i.test(message) || /effective_to is frozen/i.test(message)) {
    throw conflict(message);
  }
  if (/must use the identity country_code/i.test(message) || /country_code must match/i.test(message)) {
    throw badRequest(message);
  }
  if (code === '23514') {
    throw conflict(message || 'Fact Dictionary check constraint violated');
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
  countryCode: string | null,
): Promise<TaxFactDictionaryCommandResponse['refreshed']> {
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, {
      tax_knowledge_country_code: countryCode,
      strategy_engine_country_code: countryCode,
    }),
  };
}

function refreshCountry(identityCountry: string | null, payload: Record<string, unknown>): string | null {
  return identityCountry ?? asOptionalCountryCode(payload.selected_country_code, 'selected_country_code');
}

async function loadDefinition(id: string): Promise<DefinitionRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_definitions')
    .select(DEFINITION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax fact definition not found');
  return data as DefinitionRow;
}

async function loadVersion(id: string): Promise<VersionRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_definition_versions')
    .select(VERSION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax fact definition version not found');
  const row = data as Omit<VersionRow, 'currency_policy' | 'validation_json'> & {
    currency_policy: unknown;
    validation_json: unknown;
  };
  return {
    ...row,
    currency_policy:
      row.currency_policy && typeof row.currency_policy === 'object' && !Array.isArray(row.currency_policy)
        ? (row.currency_policy as Record<string, unknown>)
        : null,
    validation_json: asObject(row.validation_json),
  };
}

async function loadEnumOption(id: string): Promise<EnumRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_enum_options')
    .select('id, tax_fact_definition_version_id, code, sort_order')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax fact enum option not found');
  return data as EnumRow;
}

async function loadPresentation(id: string): Promise<PresentationRow> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_presentations')
    .select('id, tax_fact_definition_id, country_code')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax fact presentation not found');
  return data as PresentationRow;
}

async function loadEnumCodes(versionId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_enum_options')
    .select('code')
    .eq('tax_fact_definition_version_id', versionId);
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { code: string }).code));
}

async function nextVersionNo(definitionId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('tax_fact_definition_versions')
    .select('version_no')
    .eq('tax_fact_definition_id', definitionId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.version_no ? Number(data.version_no) : 0) + 1;
}

/**
 * Recompute and persist definition_checksum while the version is still draft.
 * Publication itself is only tax_fact_definition_version_activate — never status=active here.
 */
async function persistDraftChecksum(versionId: string): Promise<string> {
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') {
    throw conflict('definition_checksum can only be recomputed on a draft version');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const enumCodes = await loadEnumCodes(versionId);
  const checksum = taxFactDefinitionChecksum({
    fact_key: identity.fact_key,
    country_code: identity.country_code,
    value_type: version.value_type,
    unit_code: version.unit_code,
    currency_policy: version.currency_policy,
    validation_json: version.validation_json,
    enum_codes: enumCodes,
  });
  if (version.definition_checksum !== checksum) {
    const { error } = await supabaseAdmin
      .from('tax_fact_definition_versions')
      .update({ definition_checksum: checksum })
      .eq('id', versionId)
      .eq('status', 'draft');
    throwIfFactWriteError(error);
  }
  return checksum;
}

function validateSemanticDraft(input: {
  value_type: unknown;
  unit_code: unknown;
  currency_policy: unknown;
  validation_json: unknown;
}): {
  value_type: ReturnType<typeof assertValueType>;
  unit_code: string | null;
  currency_policy: ReturnType<typeof assertCurrencyPolicy>;
  validation_json: Record<string, unknown>;
} {
  const valueType = assertValueType(input.value_type);
  return {
    value_type: valueType,
    unit_code: assertOptionalUnitCode(input.unit_code),
    currency_policy: assertCurrencyPolicy(input.currency_policy, valueType),
    validation_json: assertValidationJson(input.validation_json, valueType),
  };
}

async function handleCreateDefinition(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const factKey = assertFactKey(payload.fact_key);
  const countryCode = asOptionalCountryCode(payload.country_code);
  if (countryCode) await assertCountryExists(countryCode);
  const semanticTitle = asString(payload.semantic_title, 'semantic_title');
  const ownerNote = asOptionalString(payload.owner_note, 'owner_note');

  const { data, error } = await supabaseAdmin
    .from('tax_fact_definitions')
    .insert({
      fact_key: factKey,
      country_code: countryCode,
      status: 'draft',
      semantic_title: semanticTitle,
      owner_note: ownerNote,
    })
    .select('id')
    .single();
  throwIfFactWriteError(error);
  const id = String(data?.id ?? '');
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_CREATED, 'tax_fact_definition', id, {
    fact_key: factKey,
    country_code: countryCode,
  });
  return {
    ok: true,
    command: 'create_tax_fact_definition',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(countryCode, payload)),
  };
}

async function handleUpdateDefinitionMetadata(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_id, 'tax_fact_definition_id');
  const definition = await loadDefinition(id);
  if (definition.status === 'retired') {
    throw conflict('Retired fact definitions cannot be edited');
  }
  const patch: Record<string, unknown> = {};
  if ('semantic_title' in payload) patch.semantic_title = asString(payload.semantic_title, 'semantic_title');
  if ('owner_note' in payload) patch.owner_note = asOptionalString(payload.owner_note, 'owner_note');
  if (!Object.keys(patch).length) {
    throw badRequest('No editable identity metadata supplied');
  }
  const { error } = await supabaseAdmin.from('tax_fact_definitions').update(patch).eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_METADATA_UPDATED, 'tax_fact_definition', id, patch);
  return {
    ok: true,
    command: 'update_tax_fact_definition_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleActivateDefinition(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_id, 'tax_fact_definition_id');
  const definition = await loadDefinition(id);
  const { error } = await supabaseAdmin.from('tax_fact_definitions').update({ status: 'active' }).eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_ACTIVATED, 'tax_fact_definition', id, {
    fact_key: definition.fact_key,
  });
  return {
    ok: true,
    command: 'activate_tax_fact_definition',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleRetireDefinition(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_id, 'tax_fact_definition_id');
  const definition = await loadDefinition(id);
  const retiredReason = asOptionalString(payload.retired_reason, 'retired_reason');
  const { error } = await supabaseAdmin
    .from('tax_fact_definitions')
    .update({ status: 'retired', retired_reason: retiredReason })
    .eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_RETIRED, 'tax_fact_definition', id, {
    retired_reason: retiredReason,
  });
  return {
    ok: true,
    command: 'retire_tax_fact_definition',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleCreateVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const definitionId = asUuid(payload.tax_fact_definition_id, 'tax_fact_definition_id');
  const definition = await loadDefinition(definitionId);
  if (definition.status === 'retired') {
    throw conflict('Cannot insert a fact definition version on a retired fact identity');
  }
  const semantic = validateSemanticDraft({
    value_type: payload.value_type,
    unit_code: payload.unit_code as string | null,
    currency_policy: payload.currency_policy,
    validation_json: payload.validation_json,
  });
  const effectiveFrom = asDate(payload.effective_from, 'effective_from');
  const effectiveTo = asOptionalDate(payload.effective_to, 'effective_to');
  const versionNo = await nextVersionNo(definitionId);
  const checksum = taxFactDefinitionChecksum({
    fact_key: definition.fact_key,
    country_code: definition.country_code,
    value_type: semantic.value_type,
    unit_code: semantic.unit_code,
    currency_policy: semantic.currency_policy,
    validation_json: semantic.validation_json,
    enum_codes: [],
  });

  const { data, error } = await supabaseAdmin
    .from('tax_fact_definition_versions')
    .insert({
      tax_fact_definition_id: definitionId,
      country_code: definition.country_code,
      version_no: versionNo,
      status: 'draft',
      value_type: semantic.value_type,
      unit_code: semantic.unit_code,
      currency_policy: semantic.currency_policy,
      validation_json: semantic.validation_json,
      definition_checksum: checksum,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
    })
    .select('id')
    .single();
  throwIfFactWriteError(error);
  const id = String(data?.id ?? '');
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_VERSION_CREATED, 'tax_fact_definition_version', id, {
    tax_fact_definition_id: definitionId,
    version_no: versionNo,
    definition_checksum: checksum,
  });
  return {
    ok: true,
    command: 'create_tax_fact_definition_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleUpdateVersionDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_version_id, 'tax_fact_definition_version_id');
  const version = await loadVersion(id);
  if (version.status !== 'draft') {
    throw conflict('Only draft fact definition versions can be updated');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const nextValueType = 'value_type' in payload ? payload.value_type : version.value_type;
  const semantic = validateSemanticDraft({
    value_type: nextValueType,
    unit_code: 'unit_code' in payload ? payload.unit_code : version.unit_code,
    currency_policy: 'currency_policy' in payload ? payload.currency_policy : version.currency_policy,
    validation_json: 'validation_json' in payload ? payload.validation_json : version.validation_json,
  });
  const enumCodes = await loadEnumCodes(id);
  if (semantic.value_type !== 'enum' && enumCodes.length) {
    throw conflict('Remove enum options before changing value_type away from enum');
  }
  const checksum = taxFactDefinitionChecksum({
    fact_key: identity.fact_key,
    country_code: identity.country_code,
    value_type: semantic.value_type,
    unit_code: semantic.unit_code,
    currency_policy: semantic.currency_policy,
    validation_json: semantic.validation_json,
    enum_codes: enumCodes,
  });
  const patch: Record<string, unknown> = {
    value_type: semantic.value_type,
    unit_code: semantic.unit_code,
    currency_policy: semantic.currency_policy,
    validation_json: semantic.validation_json,
    definition_checksum: checksum,
  };
  if ('effective_from' in payload) patch.effective_from = asDate(payload.effective_from, 'effective_from');
  if ('effective_to' in payload) patch.effective_to = asOptionalDate(payload.effective_to, 'effective_to');

  const { error } = await supabaseAdmin.from('tax_fact_definition_versions').update(patch).eq('id', id).eq('status', 'draft');
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_VERSION_DRAFT_UPDATED, 'tax_fact_definition_version', id, {
    definition_checksum: checksum,
  });
  return {
    ok: true,
    command: 'update_tax_fact_definition_version_draft',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleActivateVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_version_id, 'tax_fact_definition_version_id');
  const version = await loadVersion(id);
  if (version.status !== 'draft') {
    throw conflict(
      `tax_fact_definition_version_activate requires the exact version to be draft (status=${version.status})`,
    );
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const semantic = validateSemanticDraft({
    value_type: version.value_type,
    unit_code: version.unit_code,
    currency_policy: version.currency_policy,
    validation_json: version.validation_json,
  });
  const enumCodes = await loadEnumCodes(id);
  assertEnumReadyForActivation(semantic.value_type, enumCodes);
  if (identity.status !== 'active') {
    throw conflict('tax_fact_definition_versions cannot activate unless the fact identity is active');
  }
  const checksumInput = {
    fact_key: identity.fact_key,
    country_code: identity.country_code,
    value_type: semantic.value_type,
    unit_code: semantic.unit_code,
    currency_policy: semantic.currency_policy,
    validation_json: semantic.validation_json,
    enum_codes: enumCodes,
  };
  const expectedChecksum = taxFactDefinitionChecksum(checksumInput);
  const expectedSnapshot = taxFactDefinitionSemanticSnapshot(checksumInput);
  const { data, error } = await supabaseAdmin.rpc('tax_fact_definition_version_activate', {
    p_version_id: id,
    p_expected_definition_checksum: expectedChecksum,
    p_expected_semantic_snapshot: expectedSnapshot,
  });
  throwIfFactWriteError(error);
  if (!data) {
    throw conflict('tax_fact_definition_version_activate could not activate the exact draft version');
  }
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_VERSION_ACTIVATED, 'tax_fact_definition_version', id, {
    definition_checksum: expectedChecksum,
  });
  return {
    ok: true,
    command: 'activate_tax_fact_definition_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleRetireVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_version_id, 'tax_fact_definition_version_id');
  const version = await loadVersion(id);
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const retiredReason = asOptionalString(payload.retired_reason, 'retired_reason');
  const { error } = await supabaseAdmin
    .from('tax_fact_definition_versions')
    .update({ status: 'retired', retired_reason: retiredReason })
    .eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_VERSION_RETIRED, 'tax_fact_definition_version', id, {
    retired_reason: retiredReason,
  });
  return {
    ok: true,
    command: 'retire_tax_fact_definition_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleCloseEffectiveTo(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_definition_version_id, 'tax_fact_definition_version_id');
  const version = await loadVersion(id);
  if (version.status !== 'active') {
    throw conflict('effective_to can only be closed on an active version');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const effectiveTo = asDate(payload.effective_to, 'effective_to');
  const { error } = await supabaseAdmin
    .from('tax_fact_definition_versions')
    .update({ effective_to: effectiveTo })
    .eq('id', id)
    .eq('status', 'active');
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_DEFINITION_VERSION_EFFECTIVE_TO_CLOSED, 'tax_fact_definition_version', id, {
    effective_to: effectiveTo,
  });
  return {
    ok: true,
    command: 'close_tax_fact_definition_version_effective_to',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleAddEnumOption(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const versionId = asUuid(payload.tax_fact_definition_version_id, 'tax_fact_definition_version_id');
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') {
    throw conflict('Enum options can only be added while the parent version is draft');
  }
  if (version.value_type !== 'enum') {
    throw badRequest('tax_fact_enum_options are only valid on value_type = enum versions');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const code = assertEnumCode(payload.code);
  const sortOrder = asNonNegativeInt(payload.sort_order, 'sort_order');
  const { data, error } = await supabaseAdmin
    .from('tax_fact_enum_options')
    .insert({
      tax_fact_definition_version_id: versionId,
      code,
      sort_order: sortOrder,
    })
    .select('id')
    .single();
  throwIfFactWriteError(error);
  const checksum = await persistDraftChecksum(versionId);
  const id = String(data?.id ?? '');
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_ENUM_OPTION_ADDED, 'tax_fact_enum_option', id, {
    tax_fact_definition_version_id: versionId,
    code,
    definition_checksum: checksum,
  });
  return {
    ok: true,
    command: 'add_tax_fact_enum_option',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleUpdateEnumOption(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_enum_option_id, 'tax_fact_enum_option_id');
  const option = await loadEnumOption(id);
  const version = await loadVersion(option.tax_fact_definition_version_id);
  if (version.status !== 'draft') {
    throw conflict('Enum options can only be updated while the parent version is draft');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const patch: Record<string, unknown> = {};
  if ('code' in payload) patch.code = assertEnumCode(payload.code);
  if ('sort_order' in payload) patch.sort_order = asNonNegativeInt(payload.sort_order, 'sort_order');
  if (!Object.keys(patch).length) {
    throw badRequest('No enum option fields supplied');
  }
  const { error } = await supabaseAdmin.from('tax_fact_enum_options').update(patch).eq('id', id);
  throwIfFactWriteError(error);
  const checksum = await persistDraftChecksum(version.id);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_ENUM_OPTION_UPDATED, 'tax_fact_enum_option', id, {
    ...patch,
    definition_checksum: checksum,
  });
  return {
    ok: true,
    command: 'update_tax_fact_enum_option',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

async function handleRemoveEnumOption(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_enum_option_id, 'tax_fact_enum_option_id');
  const option = await loadEnumOption(id);
  const version = await loadVersion(option.tax_fact_definition_version_id);
  if (version.status !== 'draft') {
    throw conflict('Enum options can only be removed while the parent version is draft');
  }
  const identity = await loadDefinition(version.tax_fact_definition_id);
  const { error } = await supabaseAdmin.from('tax_fact_enum_options').delete().eq('id', id);
  throwIfFactWriteError(error);
  const checksum = await persistDraftChecksum(version.id);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_ENUM_OPTION_REMOVED, 'tax_fact_enum_option', id, {
    code: option.code,
    definition_checksum: checksum,
  });
  return {
    ok: true,
    command: 'remove_tax_fact_enum_option',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(identity.country_code, payload)),
  };
}

type TaxFactPresentationPatch = {
  country_code?: string | null;
  locale?: string;
  label?: string;
  professional_question?: string;
  client_question?: string | null;
  help_text?: string | null;
  aliases?: string[];
  enum_option_labels?: Record<string, string>;
};

function presentationPatch(payload: Record<string, unknown>, required: boolean): TaxFactPresentationPatch {
  const patch: TaxFactPresentationPatch = {};
  if (required || 'country_code' in payload) {
    const country = asOptionalCountryCode(payload.country_code);
    if (country) {
      patch.country_code = country;
    } else if ('country_code' in payload || required) {
      patch.country_code = null;
    }
  }
  if (required || 'locale' in payload) patch.locale = assertLocale(payload.locale);
  if (required || 'label' in payload) patch.label = asString(payload.label, 'label');
  if (required || 'professional_question' in payload) {
    patch.professional_question = asString(payload.professional_question, 'professional_question');
  }
  if ('client_question' in payload || required) {
    patch.client_question = asOptionalString(payload.client_question, 'client_question');
  }
  if ('help_text' in payload || required) {
    patch.help_text = asOptionalString(payload.help_text, 'help_text');
  }
  if ('aliases' in payload || required) patch.aliases = assertStringArray(payload.aliases, 'aliases');
  if ('enum_option_labels' in payload || required) {
    patch.enum_option_labels = assertEnumOptionLabels(payload.enum_option_labels);
  }
  return patch;
}

async function handleCreatePresentation(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const definitionId = asUuid(payload.tax_fact_definition_id, 'tax_fact_definition_id');
  const definition = await loadDefinition(definitionId);
  const countryCode = asOptionalCountryCode(payload.country_code);
  if (countryCode) await assertCountryExists(countryCode);
  const row = {
    tax_fact_definition_id: definitionId,
    ...presentationPatch(payload, true),
  };
  const { data, error } = await supabaseAdmin.from('tax_fact_presentations').insert(row).select('id').single();
  throwIfFactWriteError(error);
  const id = String(data?.id ?? '');
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_PRESENTATION_CREATED, 'tax_fact_presentation', id, {
    tax_fact_definition_id: definitionId,
    locale: row.locale,
  });
  return {
    ok: true,
    command: 'create_tax_fact_presentation',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleUpdatePresentation(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_presentation_id, 'tax_fact_presentation_id');
  const presentation = await loadPresentation(id);
  const definition = await loadDefinition(presentation.tax_fact_definition_id);
  const patch = presentationPatch(payload, false);
  if (!Object.keys(patch).length) {
    throw badRequest('No presentation fields supplied');
  }
  if (patch.country_code) await assertCountryExists(String(patch.country_code));
  const { error } = await supabaseAdmin.from('tax_fact_presentations').update(patch).eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_PRESENTATION_UPDATED, 'tax_fact_presentation', id, patch);
  return {
    ok: true,
    command: 'update_tax_fact_presentation',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

async function handleDeletePresentation(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  const id = asUuid(payload.tax_fact_presentation_id, 'tax_fact_presentation_id');
  const presentation = await loadPresentation(id);
  const definition = await loadDefinition(presentation.tax_fact_definition_id);
  const { error } = await supabaseAdmin.from('tax_fact_presentations').delete().eq('id', id);
  throwIfFactWriteError(error);
  await audit(ctx, AUDIT_ACTIONS.TAX_FACT_PRESENTATION_DELETED, 'tax_fact_presentation', id, {
    tax_fact_definition_id: definition.id,
  });
  return {
    ok: true,
    command: 'delete_tax_fact_presentation',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, refreshCountry(definition.country_code, payload)),
  };
}

export async function executeTaxFactDictionaryCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxFactDictionaryCommandResponse> {
  await assertOwnerLegalCommandAccess(ctx, command, payload);
  if (!isTaxFactDictionaryCommand(command)) {
    throw badRequest(`Unknown Fact Dictionary command: ${command}`);
  }
  switch (command as TaxFactDictionaryCommandName) {
    case 'create_tax_fact_definition':
      return handleCreateDefinition(ctx, payload);
    case 'update_tax_fact_definition_metadata':
      return handleUpdateDefinitionMetadata(ctx, payload);
    case 'activate_tax_fact_definition':
      return handleActivateDefinition(ctx, payload);
    case 'retire_tax_fact_definition':
      return handleRetireDefinition(ctx, payload);
    case 'create_tax_fact_definition_version':
      return handleCreateVersion(ctx, payload);
    case 'update_tax_fact_definition_version_draft':
      return handleUpdateVersionDraft(ctx, payload);
    case 'activate_tax_fact_definition_version':
      return handleActivateVersion(ctx, payload);
    case 'retire_tax_fact_definition_version':
      return handleRetireVersion(ctx, payload);
    case 'close_tax_fact_definition_version_effective_to':
      return handleCloseEffectiveTo(ctx, payload);
    case 'add_tax_fact_enum_option':
      return handleAddEnumOption(ctx, payload);
    case 'update_tax_fact_enum_option':
      return handleUpdateEnumOption(ctx, payload);
    case 'remove_tax_fact_enum_option':
      return handleRemoveEnumOption(ctx, payload);
    case 'create_tax_fact_presentation':
      return handleCreatePresentation(ctx, payload);
    case 'update_tax_fact_presentation':
      return handleUpdatePresentation(ctx, payload);
    case 'delete_tax_fact_presentation':
      return handleDeletePresentation(ctx, payload);
    default:
      throw badRequest(`Unknown Fact Dictionary command: ${command}`);
  }
}
