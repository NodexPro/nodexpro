import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict } from '../../shared/errors.js';
import { assertCountryExists } from '../country-pack/country.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
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

function asOptionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = asString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw badRequest(`${field} must be YYYY-MM-DD`);
  }
  return v;
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

function throwIfUniqueConflict(
  error: { code?: string; message?: string } | null,
  message: string,
): void {
  if (!error) return;
  if (String(error.code ?? '') === '23505') {
    throw conflict(message);
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
  throwIfUniqueConflict(error, 'Tax source already exists for this country and source_code');
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
  throwIfUniqueConflict(error, 'Tax rule already exists for this country and rule_code');
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
    default:
      throw badRequest(`Unsupported tax-knowledge command: ${command}`);
  }
}
