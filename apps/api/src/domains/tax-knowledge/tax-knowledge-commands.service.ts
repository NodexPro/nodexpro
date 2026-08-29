import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from '../country-pack/country.service.js';
import { assertPackBelongsToCountry } from '../country-pack/country-pack.service.js';
import { assertRulesetExists } from '../country-pack/ruleset.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
import { parseTaxRulePayloadJson, taxRulePayloadChecksum } from './tax-knowledge-checksum.pure.js';
import {
  TAX_KNOWLEDGE_INITIAL_STATUS,
  TAX_RULE_KIND,
  TAX_SOURCE_PROVENANCE_TYPES,
  isTaxKnowledgeCommand,
  type TaxKnowledgeCommandName,
  type TaxKnowledgeCommandResponse,
  type TaxSourceProvenanceType,
} from './tax-knowledge.types.js';

export { isTaxKnowledgeCommand, TAX_KNOWLEDGE_COMMANDS } from './tax-knowledge.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function asOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const v = value.trim();
  return v.length ? v : null;
}

function asDate(value: unknown, field: string): string {
  const v = asString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw badRequest(`${field} must be YYYY-MM-DD`);
  }
  return v;
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

function assertDraftCreateStatus(value: unknown, command: TaxKnowledgeCommandName): void {
  if (value === undefined || value === null || value === '') return;
  const status = asString(value, 'status');
  if (status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw badRequest(`${command} inserts status '${TAX_KNOWLEDGE_INITIAL_STATUS}' only`);
  }
}

function throwIfTaxKnowledgeWriteError(
  error: { code?: string; message?: string } | null,
  uniqueMessage: string,
): void {
  if (!error) return;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  if (code === '23505' || /monotonic per tax_rule_id/i.test(message)) {
    throw conflict(uniqueMessage);
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
): Promise<TaxKnowledgeCommandResponse['refreshed']> {
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, {
      tax_knowledge_country_code: countryCode,
    }),
  };
}

async function loadTaxSource(id: string): Promise<{
  id: string;
  country_code: string;
  source_code: string;
  status: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .select('id, country_code, source_code, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax source not found');
  return data as { id: string; country_code: string; source_code: string; status: string };
}

async function loadTaxRule(id: string): Promise<{
  id: string;
  country_code: string;
  rule_code: string;
  rule_kind: string;
  status: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('tax_rules')
    .select('id, country_code, rule_code, rule_kind, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax rule not found');
  return data as {
    id: string;
    country_code: string;
    rule_code: string;
    rule_kind: string;
    status: string;
  };
}

async function loadTaxRuleVersion(id: string): Promise<{
  id: string;
  tax_rule_id: string;
  country_code: string;
  country_pack_id: string;
  country_pack_ruleset_id: string;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  payload_json: Record<string, unknown>;
  payload_checksum: string;
  supersedes_version_id: string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .select(
      'id, tax_rule_id, country_code, country_pack_id, country_pack_ruleset_id, version_no, status, effective_from, effective_to, payload_json, payload_checksum, supersedes_version_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax rule version not found');
  return data as {
    id: string;
    tax_rule_id: string;
    country_code: string;
    country_pack_id: string;
    country_pack_ruleset_id: string;
    version_no: number;
    status: string;
    effective_from: string;
    effective_to: string | null;
    payload_json: Record<string, unknown>;
    payload_checksum: string;
    supersedes_version_id: string | null;
  };
}

async function assertPackRulesetForCountry(
  countryCode: string,
  countryPackId: string,
  countryPackRulesetId: string,
): Promise<void> {
  await assertPackBelongsToCountry(countryPackId, countryCode);
  const ruleset = await assertRulesetExists(countryPackRulesetId);
  if (ruleset.country_pack_id !== countryPackId) {
    throw badRequest('country_pack_ruleset_id must belong to country_pack_id');
  }
}

async function nextVersionNo(taxRuleId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('version_no')
    .eq('tax_rule_id', taxRuleId)
    .order('version_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const current = data?.[0]?.version_no;
  return (typeof current === 'number' ? current : 0) + 1;
}

async function handleCreateTaxSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const sourceCode = asString(payload.source_code, 'source_code');
  const title = asString(payload.title, 'title');
  const provenanceType = asString(payload.provenance_type, 'provenance_type');
  if (!(TAX_SOURCE_PROVENANCE_TYPES as readonly string[]).includes(provenanceType)) {
    throw badRequest('provenance_type is not a supported tax source provenance type');
  }
  assertDraftCreateStatus(payload.status, 'create_tax_source');

  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .insert({
      country_code: countryCode,
      source_code: sourceCode,
      title,
      provenance_type: provenanceType as TaxSourceProvenanceType,
      issuer: asOptionalString(payload.issuer, 'issuer'),
      citation_ref: asOptionalString(payload.citation_ref, 'citation_ref'),
      source_url: asOptionalString(payload.source_url, 'source_url'),
      published_on: asOptionalDate(payload.published_on, 'published_on'),
      status: TAX_KNOWLEDGE_INITIAL_STATUS,
      owner_note: asOptionalString(payload.owner_note, 'owner_note'),
    })
    .select('id, country_code, source_code, status')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Tax source already exists for this country and source_code');
  if (!data) throw new Error('tax_sources insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_SOURCE_CREATED, 'tax_source', String(data.id), {
    country_code: countryCode,
    source_code: data.source_code,
    status: data.status,
  });

  return {
    ok: true,
    command: 'create_tax_source',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, countryCode),
  };
}

async function handleCreateTaxRule(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const ruleCode = asString(payload.rule_code, 'rule_code');
  const title = asString(payload.title, 'title');
  const ruleKind = asString(payload.rule_kind ?? TAX_RULE_KIND, 'rule_kind');
  if (ruleKind !== TAX_RULE_KIND) {
    throw badRequest(`rule_kind must be '${TAX_RULE_KIND}'`);
  }
  assertDraftCreateStatus(payload.status, 'create_tax_rule');

  const { data, error } = await supabaseAdmin
    .from('tax_rules')
    .insert({
      country_code: countryCode,
      rule_code: ruleCode,
      title,
      rule_kind: TAX_RULE_KIND,
      status: TAX_KNOWLEDGE_INITIAL_STATUS,
      usage_hint: asOptionalString(payload.usage_hint, 'usage_hint'),
      owner_note: asOptionalString(payload.owner_note, 'owner_note'),
    })
    .select('id, country_code, rule_code, rule_kind, status')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Tax rule already exists for this country and rule_code');
  if (!data) throw new Error('tax_rules insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_CREATED, 'tax_rule', String(data.id), {
    country_code: countryCode,
    rule_code: data.rule_code,
    rule_kind: data.rule_kind,
    status: data.status,
  });

  return {
    ok: true,
    command: 'create_tax_rule',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, countryCode),
  };
}

async function handleCreateTaxRuleVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const taxRuleId = asUuid(payload.tax_rule_id, 'tax_rule_id');
  const parent = await loadTaxRule(taxRuleId);
  const countryCode = parent.country_code;
  const countryPackId = asUuid(payload.country_pack_id, 'country_pack_id');
  const countryPackRulesetId = asUuid(payload.country_pack_ruleset_id, 'country_pack_ruleset_id');
  await assertPackRulesetForCountry(countryCode, countryPackId, countryPackRulesetId);

  const effectiveFrom = asDate(payload.effective_from, 'effective_from');
  const effectiveTo = asOptionalDate(payload.effective_to, 'effective_to');
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw badRequest('effective_to must be >= effective_from');
  }

  const payloadJson = parseTaxRulePayloadJson(payload.payload_json);
  const payloadChecksum = taxRulePayloadChecksum(payloadJson);
  const supersedesVersionId = asOptionalUuid(payload.supersedes_version_id, 'supersedes_version_id');
  if (supersedesVersionId) {
    const prior = await loadTaxRuleVersion(supersedesVersionId);
    if (prior.tax_rule_id !== taxRuleId) {
      throw badRequest('supersedes_version_id must belong to the same tax rule');
    }
  }

  const versionNo = await nextVersionNo(taxRuleId);

  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .insert({
      tax_rule_id: taxRuleId,
      country_code: countryCode,
      country_pack_id: countryPackId,
      country_pack_ruleset_id: countryPackRulesetId,
      version_no: versionNo,
      status: TAX_KNOWLEDGE_INITIAL_STATUS,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      payload_json: payloadJson,
      payload_checksum: payloadChecksum,
      supersedes_version_id: supersedesVersionId,
    })
    .select('id, tax_rule_id, version_no, status, payload_checksum, country_code')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Tax rule version number conflict; retry the command');
  if (!data) throw new Error('tax_rule_versions insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_CREATED, 'tax_rule_version', String(data.id), {
    tax_rule_id: taxRuleId,
    country_code: countryCode,
    version_no: data.version_no,
    status: data.status,
    payload_checksum: data.payload_checksum,
  });

  return {
    ok: true,
    command: 'create_tax_rule_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, countryCode),
  };
}

async function handleUpdateTaxRuleVersionDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const current = await loadTaxRuleVersion(versionId);
  if (current.status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw conflict('Only draft tax rule versions can be updated');
  }

  const nextPackId =
    payload.country_pack_id === undefined
      ? current.country_pack_id
      : asUuid(payload.country_pack_id, 'country_pack_id');
  const nextRulesetId =
    payload.country_pack_ruleset_id === undefined
      ? current.country_pack_ruleset_id
      : asUuid(payload.country_pack_ruleset_id, 'country_pack_ruleset_id');
  if (nextPackId !== current.country_pack_id || nextRulesetId !== current.country_pack_ruleset_id) {
    await assertPackRulesetForCountry(current.country_code, nextPackId, nextRulesetId);
  }

  const nextFrom =
    payload.effective_from === undefined
      ? current.effective_from
      : asDate(payload.effective_from, 'effective_from');
  const nextTo =
    payload.effective_to === undefined
      ? current.effective_to
      : asOptionalDate(payload.effective_to, 'effective_to');
  if (nextTo && nextTo < nextFrom) {
    throw badRequest('effective_to must be >= effective_from');
  }

  let nextPayload = current.payload_json;
  let nextChecksum = current.payload_checksum;
  if (payload.payload_json !== undefined) {
    nextPayload = parseTaxRulePayloadJson(payload.payload_json);
    nextChecksum = taxRulePayloadChecksum(nextPayload);
  }

  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .update({
      country_pack_id: nextPackId,
      country_pack_ruleset_id: nextRulesetId,
      effective_from: nextFrom,
      effective_to: nextTo,
      payload_json: nextPayload,
      payload_checksum: nextChecksum,
    })
    .eq('id', versionId)
    .eq('status', TAX_KNOWLEDGE_INITIAL_STATUS)
    .select('id, tax_rule_id, country_code, status, payload_checksum, version_no')
    .maybeSingle();
  throwIfTaxKnowledgeWriteError(error, 'Tax rule version update conflict');
  if (!data) throw conflict('Only draft tax rule versions can be updated');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_DRAFT_UPDATED, 'tax_rule_version', versionId, {
    tax_rule_id: data.tax_rule_id,
    country_code: data.country_code,
    version_no: data.version_no,
    payload_checksum: data.payload_checksum,
  });

  return {
    ok: true,
    command: 'update_tax_rule_version_draft',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, current.country_code),
  };
}

async function handleActivateTaxSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const sourceId = asUuid(payload.tax_source_id, 'tax_source_id');
  const source = await loadTaxSource(sourceId);
  if (source.status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw conflict('activate_tax_source is only valid from draft to active');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .update({ status: 'active' })
    .eq('id', sourceId)
    .eq('status', TAX_KNOWLEDGE_INITIAL_STATUS)
    .select('id, country_code, source_code, status')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw conflict('activate_tax_source is only valid from draft to active');

  await audit(ctx, AUDIT_ACTIONS.TAX_SOURCE_ACTIVATED, 'tax_source', sourceId, {
    country_code: data.country_code,
    source_code: data.source_code,
    previous_status: source.status,
    status: data.status,
  });

  return {
    ok: true,
    command: 'activate_tax_source',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, source.country_code),
  };
}

async function handleRetireTaxSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const sourceId = asUuid(payload.tax_source_id, 'tax_source_id');
  const source = await loadTaxSource(sourceId);
  if (source.status !== 'draft' && source.status !== 'active') {
    throw conflict('retire_tax_source is only valid from draft or active');
  }
  const reason = asOptionalString(payload.reason, 'reason');

  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .update({
      status: 'retired',
      retired_at: new Date().toISOString(),
      retired_reason: reason,
    })
    .eq('id', sourceId)
    .in('status', ['draft', 'active'])
    .select('id, country_code, source_code, status')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw conflict('retire_tax_source is only valid from draft or active');

  await audit(ctx, AUDIT_ACTIONS.TAX_SOURCE_RETIRED, 'tax_source', sourceId, {
    country_code: data.country_code,
    source_code: data.source_code,
    previous_status: source.status,
    status: data.status,
    reason,
  });

  return {
    ok: true,
    command: 'retire_tax_source',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, source.country_code),
  };
}

async function handleUpdateTaxSourceMetadata(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const sourceId = asUuid(payload.tax_source_id, 'tax_source_id');
  const source = await loadTaxSource(sourceId);
  if ('country_code' in payload || 'source_code' in payload || 'status' in payload) {
    throw badRequest('country_code, source_code, and status cannot be changed via update_tax_source_metadata');
  }

  const patch: Record<string, unknown> = {};
  if (payload.title !== undefined) patch.title = asString(payload.title, 'title');
  if (payload.provenance_type !== undefined) {
    const provenanceType = asString(payload.provenance_type, 'provenance_type');
    if (!(TAX_SOURCE_PROVENANCE_TYPES as readonly string[]).includes(provenanceType)) {
      throw badRequest('provenance_type is not a supported tax source provenance type');
    }
    patch.provenance_type = provenanceType;
  }
  if (payload.issuer !== undefined) patch.issuer = asOptionalString(payload.issuer, 'issuer');
  if (payload.citation_ref !== undefined) patch.citation_ref = asOptionalString(payload.citation_ref, 'citation_ref');
  if (payload.source_url !== undefined) patch.source_url = asOptionalString(payload.source_url, 'source_url');
  if (payload.published_on !== undefined) {
    patch.published_on = asOptionalDate(payload.published_on, 'published_on');
  }
  if (payload.owner_note !== undefined) patch.owner_note = asOptionalString(payload.owner_note, 'owner_note');
  if (!Object.keys(patch).length) {
    throw badRequest('update_tax_source_metadata requires at least one metadata field');
  }

  const { error } = await supabaseAdmin.from('tax_sources').update(patch).eq('id', sourceId);
  if (error) throw error;

  await audit(ctx, AUDIT_ACTIONS.TAX_SOURCE_METADATA_UPDATED, 'tax_source', sourceId, {
    country_code: source.country_code,
    source_code: source.source_code,
    fields: Object.keys(patch),
  });

  return {
    ok: true,
    command: 'update_tax_source_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, source.country_code),
  };
}

async function handleUpdateTaxRuleMetadata(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const ruleId = asUuid(payload.tax_rule_id, 'tax_rule_id');
  const rule = await loadTaxRule(ruleId);
  if (
    'country_code' in payload ||
    'rule_code' in payload ||
    'rule_kind' in payload ||
    'status' in payload
  ) {
    throw badRequest(
      'country_code, rule_code, rule_kind, and status cannot be changed via update_tax_rule_metadata',
    );
  }

  const patch: Record<string, unknown> = {};
  if (payload.title !== undefined) patch.title = asString(payload.title, 'title');
  if (payload.usage_hint !== undefined) patch.usage_hint = asOptionalString(payload.usage_hint, 'usage_hint');
  if (payload.owner_note !== undefined) patch.owner_note = asOptionalString(payload.owner_note, 'owner_note');
  if (!Object.keys(patch).length) {
    throw badRequest('update_tax_rule_metadata requires at least one metadata field');
  }

  const { error } = await supabaseAdmin.from('tax_rules').update(patch).eq('id', ruleId);
  if (error) throw error;

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_METADATA_UPDATED, 'tax_rule', ruleId, {
    country_code: rule.country_code,
    rule_code: rule.rule_code,
    fields: Object.keys(patch),
  });

  return {
    ok: true,
    command: 'update_tax_rule_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, rule.country_code),
  };
}

export async function executeTaxKnowledgeCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  assertPlatformOwner(ctx);

  if (!isTaxKnowledgeCommand(command)) {
    throw badRequest(`Unsupported tax-knowledge command: ${command || 'unknown'}`);
  }

  switch (command) {
    case 'create_tax_source':
      return handleCreateTaxSource(ctx, payload);
    case 'create_tax_rule':
      return handleCreateTaxRule(ctx, payload);
    case 'create_tax_rule_version':
      return handleCreateTaxRuleVersion(ctx, payload);
    case 'update_tax_rule_version_draft':
      return handleUpdateTaxRuleVersionDraft(ctx, payload);
    case 'activate_tax_source':
      return handleActivateTaxSource(ctx, payload);
    case 'retire_tax_source':
      return handleRetireTaxSource(ctx, payload);
    case 'update_tax_source_metadata':
      return handleUpdateTaxSourceMetadata(ctx, payload);
    case 'update_tax_rule_metadata':
      return handleUpdateTaxRuleMetadata(ctx, payload);
    default:
      throw badRequest(`Unsupported tax-knowledge command: ${command}`);
  }
}
