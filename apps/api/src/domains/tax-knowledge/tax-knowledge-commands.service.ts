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
  TAX_RULE_RELATIONSHIP_TYPES,
  TAX_SOURCE_PROVENANCE_TYPES,
  isTaxKnowledgeCommand,
  type TaxKnowledgeCommandName,
  type TaxKnowledgeCommandResponse,
  type TaxRuleRelationshipType,
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

function throwIfTaxRuleVersionLifecycleError(
  error: { code?: string; message?: string; details?: string } | null,
): void {
  if (!error) return;
  const code = String(error.code ?? '');
  const message = [error.message, error.details].filter(Boolean).join(' ');
  if (/cannot activate without at least one citation/i.test(message)) {
    throw conflict('tax_rule_versions cannot activate without at least one citation to an active tax_source');
  }
  if (/cannot activate while a blocking relationship/i.test(message)) {
    throw conflict(
      'tax_rule_versions cannot activate while a blocking relationship points to a non-active tax_rule_version',
    );
  }
  if (/Invalid tax_rule_versions status transition/i.test(message)) {
    throw conflict(message);
  }
  if (
    /effective_to cannot be/i.test(message) ||
    /effective_to is frozen/i.test(message) ||
    /effective_to is null or effective_to >= effective_from/i.test(message)
  ) {
    throw conflict(message);
  }
  if (code === '23P01' || /exclusion constraint/i.test(message) || /no_active_overlap/i.test(message)) {
    throw conflict('Active tax rule versions cannot overlap');
  }
  if (/Tax rule version not found/i.test(message)) {
    throw notFound('Tax rule version not found');
  }
  if (/must be different/i.test(message) && /old_tax_rule_version_id/i.test(message)) {
    throw badRequest('new_tax_rule_version_id and old_tax_rule_version_id must be different');
  }
  if (/NEW version to be draft/i.test(message) || /OLD version to be active/i.test(message)) {
    throw conflict(message);
  }
  if (/same tax_rule/i.test(message) || /same country/i.test(message)) {
    throw badRequest(message);
  }
  if (/supersedes_version_id must be empty/i.test(message)) {
    throw conflict(message);
  }
  if (code === '23514') {
    throw conflict(message || 'tax_rule_versions check constraint violated');
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

function normalizeCitationLocator(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('locator must be a string');
  const locator = value.trim();
  return locator.length ? locator : null;
}

function assertParentVersionDraft(status: string, command: string): void {
  if (status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw conflict(`${command} is only allowed while the tax rule version is draft`);
  }
}

function locatorKey(locator: string | null | undefined): string {
  return locator == null ? '' : locator.trim();
}

function asRelationshipType(value: unknown): TaxRuleRelationshipType {
  const relationshipType = asString(value, 'relationship_type');
  if (!(TAX_RULE_RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType)) {
    throw badRequest('relationship_type must be one of the K1.3 allowed types');
  }
  return relationshipType as TaxRuleRelationshipType;
}

function assertCreateRelationshipPayload(payload: Record<string, unknown>): void {
  for (const field of ['organization_id', 'status', 'created_at', 'retired_at', 'retired_reason'] as const) {
    if (field in payload) {
      throw badRequest(`create_tax_rule_relationship does not accept ${field}`);
    }
  }
}

async function loadLegalValueIdentity(id: string): Promise<{
  id: string;
  country_code: string;
  value_key: string;
  label: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('country_legal_values')
    .select('id, country_code, value_key, label')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Legal value not found');
  return data as { id: string; country_code: string; value_key: string; label: string };
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
  if (source.status !== 'draft' && source.status !== 'active') {
    throw conflict('update_tax_source_metadata is only valid from draft or active');
  }
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

  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .update(patch)
    .eq('id', sourceId)
    .in('status', ['draft', 'active'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw conflict('update_tax_source_metadata is only valid from draft or active');

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

async function handlePinTaxRuleVersionSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const sourceId = asUuid(payload.tax_source_id, 'tax_source_id');
  const version = await loadTaxRuleVersion(versionId);
  assertParentVersionDraft(version.status, 'pin_tax_rule_version_source');
  const source = await loadTaxSource(sourceId);
  if (source.country_code !== version.country_code) {
    throw badRequest('tax_source_id must belong to the same country as the tax rule version');
  }
  const locator = normalizeCitationLocator(payload.locator);

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('tax_rule_version_sources')
    .select('id, locator')
    .eq('tax_rule_version_id', versionId)
    .eq('tax_source_id', sourceId);
  if (existingErr) throw existingErr;
  if ((existing ?? []).some((row) => locatorKey(row.locator as string | null) === locatorKey(locator))) {
    throw conflict('Tax source citation already exists for this version');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_rule_version_sources')
    .insert({
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      country_code: version.country_code,
      locator,
    })
    .select('id, tax_rule_version_id, tax_source_id, locator')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Tax source citation already exists for this version');
  if (!data) throw new Error('tax_rule_version_sources insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_SOURCE_PINNED, 'tax_rule_version_source', String(data.id), {
    tax_rule_version_id: versionId,
    tax_source_id: sourceId,
    country_code: version.country_code,
    locator,
  });

  return {
    ok: true,
    command: 'pin_tax_rule_version_source',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleUnpinTaxRuleVersionSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const citationId = asUuid(payload.tax_rule_version_source_id, 'tax_rule_version_source_id');
  const { data: citation, error: citationErr } = await supabaseAdmin
    .from('tax_rule_version_sources')
    .select('id, tax_rule_version_id, tax_source_id, country_code')
    .eq('id', citationId)
    .maybeSingle();
  if (citationErr) throw citationErr;
  if (!citation) throw notFound('Tax source citation not found');

  const version = await loadTaxRuleVersion(String(citation.tax_rule_version_id));
  assertParentVersionDraft(version.status, 'unpin_tax_rule_version_source');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_version_sources')
    .delete()
    .eq('id', citationId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax source citation not found');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_SOURCE_UNPINNED, 'tax_rule_version_source', citationId, {
    tax_rule_version_id: version.id,
    tax_source_id: citation.tax_source_id,
    country_code: version.country_code,
  });

  return {
    ok: true,
    command: 'unpin_tax_rule_version_source',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleBindTaxRuleVersionLegalValue(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  if (
    'legal_value_version_id' in payload ||
    'rate' in payload ||
    'threshold' in payload ||
    'amount' in payload
  ) {
    throw badRequest(
      'bind_tax_rule_version_legal_value stores legal_value_id only; legal_value_version_id and amounts are not accepted',
    );
  }
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const legalValueId = asUuid(payload.legal_value_id, 'legal_value_id');
  const version = await loadTaxRuleVersion(versionId);
  assertParentVersionDraft(version.status, 'bind_tax_rule_version_legal_value');
  const legalValue = await loadLegalValueIdentity(legalValueId);
  if (legalValue.country_code !== version.country_code) {
    throw badRequest('legal_value_id must belong to the same country as the tax rule version');
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('tax_rule_version_legal_values')
    .select('id')
    .eq('tax_rule_version_id', versionId)
    .eq('legal_value_id', legalValueId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) throw conflict('Legal value binding already exists for this version');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_version_legal_values')
    .insert({
      tax_rule_version_id: versionId,
      legal_value_id: legalValueId,
      country_code: version.country_code,
    })
    .select('id, tax_rule_version_id, legal_value_id')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Legal value binding already exists for this version');
  if (!data) throw new Error('tax_rule_version_legal_values insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_LEGAL_VALUE_BOUND, 'tax_rule_version_legal_value', String(data.id), {
    tax_rule_version_id: versionId,
    legal_value_id: legalValueId,
    country_code: version.country_code,
    value_key: legalValue.value_key,
  });

  return {
    ok: true,
    command: 'bind_tax_rule_version_legal_value',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleUnbindTaxRuleVersionLegalValue(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const bindingId = asUuid(payload.tax_rule_version_legal_value_id, 'tax_rule_version_legal_value_id');
  const { data: binding, error: bindingErr } = await supabaseAdmin
    .from('tax_rule_version_legal_values')
    .select('id, tax_rule_version_id, legal_value_id, country_code')
    .eq('id', bindingId)
    .maybeSingle();
  if (bindingErr) throw bindingErr;
  if (!binding) throw notFound('Legal value binding not found');

  const version = await loadTaxRuleVersion(String(binding.tax_rule_version_id));
  assertParentVersionDraft(version.status, 'unbind_tax_rule_version_legal_value');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_version_legal_values')
    .delete()
    .eq('id', bindingId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Legal value binding not found');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_LEGAL_VALUE_UNBOUND, 'tax_rule_version_legal_value', bindingId, {
    tax_rule_version_id: version.id,
    legal_value_id: binding.legal_value_id,
    country_code: version.country_code,
  });

  return {
    ok: true,
    command: 'unbind_tax_rule_version_legal_value',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleCreateTaxRuleRelationship(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  assertCreateRelationshipPayload(payload);
  const fromId = asUuid(payload.from_tax_rule_version_id, 'from_tax_rule_version_id');
  const toId = asUuid(payload.to_tax_rule_version_id, 'to_tax_rule_version_id');
  const relationshipType = asRelationshipType(payload.relationship_type);
  if (fromId === toId) {
    throw badRequest('from_tax_rule_version_id and to_tax_rule_version_id must be different');
  }
  const from = await loadTaxRuleVersion(fromId);
  assertParentVersionDraft(from.status, 'create_tax_rule_relationship');
  const to = await loadTaxRuleVersion(toId);
  if (to.country_code !== from.country_code) {
    throw badRequest('to_tax_rule_version_id must belong to the same country as from_tax_rule_version_id');
  }
  const ownerNote = asOptionalString(payload.owner_note, 'owner_note');

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('tax_rule_relationships')
    .select('id')
    .eq('from_tax_rule_version_id', fromId)
    .eq('to_tax_rule_version_id', toId)
    .eq('relationship_type', relationshipType)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) throw conflict('Tax rule relationship already exists');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_relationships')
    .insert({
      from_tax_rule_version_id: fromId,
      to_tax_rule_version_id: toId,
      relationship_type: relationshipType,
      country_code: from.country_code,
      status: 'active',
      owner_note: ownerNote,
    })
    .select('id, from_tax_rule_version_id, to_tax_rule_version_id, relationship_type')
    .single();
  throwIfTaxKnowledgeWriteError(error, 'Tax rule relationship already exists');
  if (!data) throw new Error('tax_rule_relationships insert returned no row');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_RELATIONSHIP_CREATED, 'tax_rule_relationship', String(data.id), {
    from_tax_rule_version_id: fromId,
    to_tax_rule_version_id: toId,
    relationship_type: relationshipType,
    country_code: from.country_code,
  });

  return {
    ok: true,
    command: 'create_tax_rule_relationship',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, from.country_code),
  };
}

async function handleDeleteTaxRuleRelationship(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const relationshipId = asUuid(payload.tax_rule_relationship_id, 'tax_rule_relationship_id');
  const { data: relationship, error: relationshipErr } = await supabaseAdmin
    .from('tax_rule_relationships')
    .select('id, from_tax_rule_version_id, to_tax_rule_version_id, relationship_type, country_code')
    .eq('id', relationshipId)
    .maybeSingle();
  if (relationshipErr) throw relationshipErr;
  if (!relationship) throw notFound('Tax rule relationship not found');

  const from = await loadTaxRuleVersion(String(relationship.from_tax_rule_version_id));
  assertParentVersionDraft(from.status, 'delete_tax_rule_relationship');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_relationships')
    .delete()
    .eq('id', relationshipId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax rule relationship not found');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_RELATIONSHIP_DELETED, 'tax_rule_relationship', relationshipId, {
    from_tax_rule_version_id: from.id,
    to_tax_rule_version_id: relationship.to_tax_rule_version_id,
    relationship_type: relationship.relationship_type,
    country_code: from.country_code,
  });

  return {
    ok: true,
    command: 'delete_tax_rule_relationship',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, from.country_code),
  };
}

async function handleActivateTaxRuleVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const version = await loadTaxRuleVersion(versionId);
  if (version.status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw conflict('activate_tax_rule_version is only valid from draft to active');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .update({ status: 'active' })
    .eq('id', versionId)
    .eq('status', TAX_KNOWLEDGE_INITIAL_STATUS)
    .select('id, tax_rule_id, country_code, status, version_no, payload_checksum')
    .maybeSingle();
  throwIfTaxRuleVersionLifecycleError(error);
  if (!data) throw conflict('activate_tax_rule_version is only valid from draft to active');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_ACTIVATED, 'tax_rule_version', versionId, {
    tax_rule_id: data.tax_rule_id,
    country_code: data.country_code,
    previous_status: version.status,
    status: data.status,
    version_no: data.version_no,
    payload_checksum: data.payload_checksum,
  });

  return {
    ok: true,
    command: 'activate_tax_rule_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleRetireTaxRuleVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const version = await loadTaxRuleVersion(versionId);
  if (version.status === 'retired') {
    throw conflict('tax_rule_version is already retired');
  }
  if (version.status !== 'draft' && version.status !== 'active' && version.status !== 'superseded') {
    throw conflict('retire_tax_rule_version is only valid from draft, active, or superseded');
  }
  const reason = asOptionalString(payload.reason, 'reason');

  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .update({
      status: 'retired',
      retired_at: new Date().toISOString(),
      retired_reason: reason,
    })
    .eq('id', versionId)
    .in('status', ['draft', 'active', 'superseded'])
    .select('id, tax_rule_id, country_code, status')
    .maybeSingle();
  throwIfTaxRuleVersionLifecycleError(error);
  if (!data) throw conflict('retire_tax_rule_version is only valid from draft, active, or superseded');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_RETIRED, 'tax_rule_version', versionId, {
    tax_rule_id: data.tax_rule_id,
    country_code: data.country_code,
    previous_status: version.status,
    status: data.status,
    reason,
  });

  return {
    ok: true,
    command: 'retire_tax_rule_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleCloseTaxRuleVersionEffectiveTo(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const versionId = asUuid(payload.tax_rule_version_id, 'tax_rule_version_id');
  const effectiveTo = asDate(payload.effective_to, 'effective_to');
  const version = await loadTaxRuleVersion(versionId);
  if (version.status === 'superseded' || version.status === 'retired') {
    throw conflict('tax_rule_versions.effective_to is frozen after supersession/retirement');
  }
  if (version.status !== 'active') {
    throw conflict('close_tax_rule_version_effective_to is only valid while the version is active');
  }
  if (effectiveTo < version.effective_from) {
    throw badRequest('effective_to must be >= effective_from');
  }
  if (version.effective_to != null && effectiveTo > version.effective_to) {
    throw conflict('tax_rule_versions.effective_to cannot be extended after leaving draft');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .update({ effective_to: effectiveTo })
    .eq('id', versionId)
    .eq('status', 'active')
    .select('id, tax_rule_id, country_code, status, effective_from, effective_to')
    .maybeSingle();
  throwIfTaxRuleVersionLifecycleError(error);
  if (!data) throw conflict('close_tax_rule_version_effective_to is only valid while the version is active');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_EFFECTIVE_TO_CLOSED, 'tax_rule_version', versionId, {
    tax_rule_id: data.tax_rule_id,
    country_code: data.country_code,
    previous_effective_to: version.effective_to,
    effective_to: data.effective_to,
  });

  return {
    ok: true,
    command: 'close_tax_rule_version_effective_to',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, version.country_code),
  };
}

async function handleSupersedeTaxRuleVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const newId = asUuid(payload.new_tax_rule_version_id, 'new_tax_rule_version_id');
  const oldId = asUuid(payload.old_tax_rule_version_id, 'old_tax_rule_version_id');
  if (newId === oldId) {
    throw badRequest('new_tax_rule_version_id and old_tax_rule_version_id must be different');
  }

  const neu = await loadTaxRuleVersion(newId);
  const old = await loadTaxRuleVersion(oldId);
  if (neu.status !== TAX_KNOWLEDGE_INITIAL_STATUS) {
    throw conflict('supersede_tax_rule_version requires the NEW version to be draft');
  }
  if (old.status !== 'active') {
    throw conflict('supersede_tax_rule_version requires the OLD version to be active');
  }
  if (neu.tax_rule_id !== old.tax_rule_id) {
    throw badRequest('NEW and OLD tax rule versions must belong to the same tax_rule');
  }
  if (neu.country_code !== old.country_code) {
    throw badRequest('NEW and OLD tax rule versions must belong to the same country');
  }
  if (neu.supersedes_version_id != null && neu.supersedes_version_id !== old.id) {
    throw conflict('NEW.supersedes_version_id must be empty or exactly the OLD version');
  }

  const { data, error } = await supabaseAdmin.rpc('tax_knowledge_supersede_tax_rule_version', {
    p_new_tax_rule_version_id: newId,
    p_old_tax_rule_version_id: oldId,
  });
  throwIfTaxRuleVersionLifecycleError(error);
  if (!data) throw new Error('tax_knowledge_supersede_tax_rule_version returned no result');

  await audit(ctx, AUDIT_ACTIONS.TAX_RULE_VERSION_SUPERSEDED, 'tax_rule_version', newId, {
    old_tax_rule_version_id: oldId,
    new_tax_rule_version_id: newId,
    tax_rule_id: neu.tax_rule_id,
    country_code: neu.country_code,
    previous_old_status: old.status,
    previous_new_status: neu.status,
  });

  return {
    ok: true,
    command: 'supersede_tax_rule_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx, neu.country_code),
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
    case 'pin_tax_rule_version_source':
      return handlePinTaxRuleVersionSource(ctx, payload);
    case 'unpin_tax_rule_version_source':
      return handleUnpinTaxRuleVersionSource(ctx, payload);
    case 'bind_tax_rule_version_legal_value':
      return handleBindTaxRuleVersionLegalValue(ctx, payload);
    case 'unbind_tax_rule_version_legal_value':
      return handleUnbindTaxRuleVersionLegalValue(ctx, payload);
    case 'create_tax_rule_relationship':
      return handleCreateTaxRuleRelationship(ctx, payload);
    case 'delete_tax_rule_relationship':
      return handleDeleteTaxRuleRelationship(ctx, payload);
    case 'activate_tax_rule_version':
      return handleActivateTaxRuleVersion(ctx, payload);
    case 'retire_tax_rule_version':
      return handleRetireTaxRuleVersion(ctx, payload);
    case 'close_tax_rule_version_effective_to':
      return handleCloseTaxRuleVersionEffectiveTo(ctx, payload);
    case 'supersede_tax_rule_version':
      return handleSupersedeTaxRuleVersion(ctx, payload);
    default:
      throw badRequest(`Unsupported tax-knowledge command: ${command}`);
  }
}
