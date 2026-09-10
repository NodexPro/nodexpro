import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { businessYmd } from '../../shared/business-time.js';
import { getOrganizationCountrySettings } from '../country-pack/organization-country.service.js';
import { assertTaxFactAnswerValue } from '../tax-fact-dictionary/tax-fact-dictionary-validation.pure.js';
import { TAX_ADVISORY_MODULE_CODE } from './tax-advisory.types.js';
import {
  isTaxAdvisoryCommand,
  TAX_ADVISORY_LIFECYCLE_DRAFT,
  TAX_ADVISORY_WORKFLOW_BUSINESS_SETUP,
  type TaxAdvisoryCommandName,
  type TaxAdvisoryCommandResponse,
} from './tax-advisory.types.js';
import {
  assertClientCountryCompatibility,
  requireOrgLegalCountry,
} from './tax-advisory-country.pure.js';
import { loadTenantActiveFactCatalog } from './tax-advisory-fact-catalog.service.js';
import {
  buildTaxAdvisoryCaseAggregate,
  canEditTaxAdvisory,
  isTaxAdvisoryUuid,
  loadOpenTaxAdvisoryCase,
  loadTaxAdvisoryCaseForOrg,
  loadTaxAdvisoryClient,
} from './tax-advisory-read-models.service.js';

const AS_OF_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireEdit(ctx: RequestContext): void {
  if (!canEditTaxAdvisory(ctx)) {
    throw forbidden('Insufficient permission');
  }
}

function requireOrgId(ctx: RequestContext): string {
  if (!ctx.organizationId) throw forbidden('Organization context required');
  return ctx.organizationId;
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isTaxAdvisoryUuid(value)) {
    throw badRequest(`${field} must be a uuid`);
  }
  return value;
}

function parseAsOf(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return businessYmd(new Date());
  }
  if (typeof value !== 'string' || !AS_OF_RE.test(value)) {
    throw badRequest('as_of must be YYYY-MM-DD', 'INVALID_AS_OF');
  }
  return value;
}

function parseWorkflowType(value: unknown): string {
  const workflow = typeof value === 'string' ? value.trim() : '';
  if (workflow !== TAX_ADVISORY_WORKFLOW_BUSINESS_SETUP) {
    throw badRequest('workflow_type must be business_setup', 'UNSUPPORTED_WORKFLOW_TYPE');
  }
  return workflow;
}

async function auditTaxAdvisory(input: {
  ctx: RequestContext;
  orgId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await writeAudit({
    organizationId: input.orgId,
    actorUserId: input.ctx.user.id,
    moduleCode: TAX_ADVISORY_MODULE_CODE,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    payload: input.payload,
  });
}

async function refresh(ctx: RequestContext, orgId: string, clientId: string): Promise<TaxAdvisoryCommandResponse['refreshed']> {
  const aggregate = await buildTaxAdvisoryCaseAggregate(ctx, orgId, clientId);
  return {
    aggregate_key: aggregate.aggregate_key,
    aggregate,
  };
}

async function handleCreate(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<TaxAdvisoryCommandResponse> {
  const clientId = parseUuid(payload.client_id, 'client_id');
  const workflowType = parseWorkflowType(payload.workflow_type);
  const asOf = parseAsOf(payload.as_of);

  const client = await loadTaxAdvisoryClient(orgId, clientId);
  if (!client) throw notFound('Client not found');

  const settings = await getOrganizationCountrySettings(orgId);
  const legalCountry = requireOrgLegalCountry(settings?.country_code ?? null);
  assertClientCountryCompatibility(legalCountry, client.country_code);

  const existing = await loadOpenTaxAdvisoryCase(orgId, clientId);
  if (existing) {
    throw conflict('An open Business Setup tax advisory case already exists', 'OPEN_CASE_EXISTS');
  }

  const { data, error } = await supabaseAdmin
    .from('tax_advisory_cases')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      country_code: legalCountry,
      workflow_type: workflowType,
      lifecycle_state: TAX_ADVISORY_LIFECYCLE_DRAFT,
      as_of: asOf,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || String(error.message ?? '').includes('uq_tax_advisory_cases_one_open')) {
      throw conflict('An open Business Setup tax advisory case already exists', 'OPEN_CASE_EXISTS');
    }
    throw error;
  }

  await auditTaxAdvisory({
    ctx,
    orgId,
    entityType: 'tax_advisory_case',
    entityId: String(data.id),
    action: AUDIT_ACTIONS.TAX_ADVISORY_CASE_CREATED,
    payload: {
      case_id: data.id,
      client_id: clientId,
      country_code: legalCountry,
      workflow_type: workflowType,
      as_of: asOf,
    },
  });

  return {
    ok: true,
    command: 'create_tax_advisory_case',
    refreshed: await refresh(ctx, orgId, clientId),
  };
}

async function handleSetFact(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<TaxAdvisoryCommandResponse> {
  const caseId = parseUuid(payload.case_id, 'case_id');
  const factDefinitionId = parseUuid(payload.fact_definition_id, 'fact_definition_id');
  if (!('value' in payload)) {
    throw badRequest('value is required', 'FACT_VALUE_INVALID');
  }

  const current = await loadTaxAdvisoryCaseForOrg(orgId, caseId);
  if (!current) throw notFound('Tax advisory case not found');
  if (current.lifecycle_state !== TAX_ADVISORY_LIFECYCLE_DRAFT) {
    throw conflict('Facts can only be changed on a draft case', 'CASE_NOT_DRAFT');
  }

  const catalog = await loadTenantActiveFactCatalog({
    countryCode: current.country_code,
    asOf: current.as_of,
  });
  const definition = catalog.definitions.find((row) => row.id === factDefinitionId);
  if (!definition?.active_version) {
    throw badRequest('Fact is not available for this case country', 'FACT_NOT_IN_CATALOG');
  }
  const version = definition.active_version;
  const typedValue = assertTaxFactAnswerValue(payload.value, {
    value_type: version.value_type,
    enum_codes: version.enum_codes,
    currency_policy: version.currency_policy,
  });

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('tax_advisory_case_facts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('case_id', caseId)
    .eq('fact_definition_id', factDefinitionId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('tax_advisory_case_facts')
      .update({
        fact_definition_version_id: version.id,
        fact_key: definition.fact_key,
        value_type: version.value_type,
        value_json: typedValue,
        answered_at: new Date().toISOString(),
        answered_by: ctx.user.id,
      })
      .eq('id', existing.id)
      .eq('organization_id', orgId)
      .eq('case_id', caseId);
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from('tax_advisory_case_facts').insert({
      organization_id: orgId,
      client_id: current.client_id,
      case_id: caseId,
      fact_definition_id: factDefinitionId,
      fact_definition_version_id: version.id,
      fact_key: definition.fact_key,
      value_type: version.value_type,
      value_json: typedValue,
      answered_at: new Date().toISOString(),
      answered_by: ctx.user.id,
    });
    if (error) throw error;
  }

  await auditTaxAdvisory({
    ctx,
    orgId,
    entityType: 'tax_advisory_case_fact',
    entityId: caseId,
    action: AUDIT_ACTIONS.TAX_ADVISORY_FACT_SET,
    payload: {
      case_id: caseId,
      client_id: current.client_id,
      fact_definition_id: factDefinitionId,
      fact_definition_version_id: version.id,
      fact_key: definition.fact_key,
      value_type: version.value_type,
    },
  });

  return {
    ok: true,
    command: 'set_tax_advisory_case_fact',
    refreshed: await refresh(ctx, orgId, current.client_id),
  };
}

async function handleClearFact(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<TaxAdvisoryCommandResponse> {
  const caseId = parseUuid(payload.case_id, 'case_id');
  const factDefinitionId = parseUuid(payload.fact_definition_id, 'fact_definition_id');
  const current = await loadTaxAdvisoryCaseForOrg(orgId, caseId);
  if (!current) throw notFound('Tax advisory case not found');
  if (current.lifecycle_state !== TAX_ADVISORY_LIFECYCLE_DRAFT) {
    throw conflict('Facts can only be changed on a draft case', 'CASE_NOT_DRAFT');
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('tax_advisory_case_facts')
    .select('id, fact_key, fact_definition_version_id, value_type')
    .eq('organization_id', orgId)
    .eq('case_id', caseId)
    .eq('fact_definition_id', factDefinitionId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('tax_advisory_case_facts')
      .delete()
      .eq('id', existing.id)
      .eq('organization_id', orgId)
      .eq('case_id', caseId);
    if (error) throw error;
  }

  await auditTaxAdvisory({
    ctx,
    orgId,
    entityType: 'tax_advisory_case_fact',
    entityId: caseId,
    action: AUDIT_ACTIONS.TAX_ADVISORY_FACT_CLEARED,
    payload: {
      case_id: caseId,
      client_id: current.client_id,
      fact_definition_id: factDefinitionId,
      fact_definition_version_id: existing?.fact_definition_version_id ?? null,
      fact_key: existing?.fact_key ?? null,
      value_type: existing?.value_type ?? null,
    },
  });

  return {
    ok: true,
    command: 'clear_tax_advisory_case_fact',
    refreshed: await refresh(ctx, orgId, current.client_id),
  };
}

async function handleArchive(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<TaxAdvisoryCommandResponse> {
  const caseId = parseUuid(payload.case_id, 'case_id');
  const current = await loadTaxAdvisoryCaseForOrg(orgId, caseId);
  if (!current) throw notFound('Tax advisory case not found');
  if (current.lifecycle_state !== TAX_ADVISORY_LIFECYCLE_DRAFT) {
    throw conflict('Only a draft case can be archived', 'CASE_NOT_DRAFT');
  }

  const { error } = await supabaseAdmin
    .from('tax_advisory_cases')
    .update({
      lifecycle_state: 'archived',
      archived_at: new Date().toISOString(),
      archived_by: ctx.user.id,
    })
    .eq('id', caseId)
    .eq('organization_id', orgId)
    .eq('client_id', current.client_id);
  if (error) throw error;

  await auditTaxAdvisory({
    ctx,
    orgId,
    entityType: 'tax_advisory_case',
    entityId: caseId,
    action: AUDIT_ACTIONS.TAX_ADVISORY_CASE_ARCHIVED,
    payload: {
      case_id: caseId,
      client_id: current.client_id,
      country_code: current.country_code,
      workflow_type: current.workflow_type,
      as_of: current.as_of,
    },
  });

  return {
    ok: true,
    command: 'archive_tax_advisory_case',
    refreshed: await refresh(ctx, orgId, current.client_id),
  };
}

export async function executeTaxAdvisoryCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxAdvisoryCommandResponse> {
  requireEdit(ctx);
  const orgId = requireOrgId(ctx);
  if (!isTaxAdvisoryCommand(command)) {
    throw badRequest(`Unsupported tax-advisory command: ${command || 'unknown'}`);
  }
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

  switch (command as TaxAdvisoryCommandName) {
    case 'create_tax_advisory_case':
      return handleCreate(ctx, orgId, body);
    case 'set_tax_advisory_case_fact':
      return handleSetFact(ctx, orgId, body);
    case 'clear_tax_advisory_case_fact':
      return handleClearFact(ctx, orgId, body);
    case 'archive_tax_advisory_case':
      return handleArchive(ctx, orgId, body);
    default:
      throw badRequest(`Unsupported tax-advisory command: ${command}`);
  }
}
