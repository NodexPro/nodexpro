import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { resolveOwnerLegalValueRulesetContextForCountry } from '../country-pack/legal-value.service.js';
import { generateLegalMachineCode } from '../tax-knowledge/tax-knowledge-library.pure.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_TRUSTED_PROVENANCE_FIELDS,
  applyTaxKnowledgeProposalRuleTextCorrections,
  canSetTaxKnowledgeProposalReviewStatus,
  isProposalRevisionConflictError,
  isTaxKnowledgeProposalCreationOrigin,
  isTaxKnowledgeProposalStatus,
  nextProposalRevisionNo,
  parseTaxKnowledgeProposalRuleTextCorrections,
  proposalJsonIsObject,
} from './knowledge-trainer-tax-knowledge-proposal.pure.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC,
  TaxKnowledgeProposalPublishPlanError,
  buildTaxKnowledgeProposalCanonicalDraftPlan,
  earliestPublishableRuleEffectiveFrom,
  proposalMachineCodeTargets,
} from './tax-knowledge-proposal-canonical-draft-plan.pure.js';
import { validateTaxKnowledgeProposalV1AgainstStore } from './tax-knowledge-proposal-v1-catalog.service.js';
import { canOwnerApproveTaxKnowledgeProposal } from './tax-knowledge-proposal-v1.pure.js';
import type { TaxKnowledgeProposalV1ValidationResult } from './tax-knowledge-proposal-v1.types.js';
import {
  appendOwnerExternalUnresolvedReference,
  parseOwnerExternalReferencePayload,
} from './tax-knowledge-proposal-external-reference.pure.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_INSERT_ATTEMPTS = 8;
const PROPOSAL_TABLE = 'legal_ingestion_tax_knowledge_proposals';

export type TaxKnowledgeProposalCommandResult = {
  country_code: string;
  document_id: string;
  draft_id: string;
  proposal_id: string;
};

function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function asOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asUuid(value, field);
}

function throwIfProposalSchemaMissing(error: unknown): void {
  if (error && isSupabaseMissingTableError(error as { message?: string; code?: string }, PROPOSAL_TABLE)) {
    throw badRequest('Knowledge Trainer tax knowledge proposal schema is not applied. Migration 636 is required on DEV.');
  }
}

function assertNoTrustedProvenance(payload: Record<string, unknown>): void {
  for (const field of TAX_KNOWLEDGE_PROPOSAL_TRUSTED_PROVENANCE_FIELDS) {
    if (field in payload && payload[field] !== undefined) {
      throw badRequest(`${field} is resolved by the backend and cannot be supplied`);
    }
  }
}

function parseProposalJson(value: unknown): Record<string, unknown> {
  if (!proposalJsonIsObject(value)) {
    throw badRequest('proposal_json must be an object');
  }
  return value;
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: PROPOSAL_TABLE,
    entityId,
    action,
    payload,
  });
}

const PROPOSAL_SELECT =
  'id, country_code, document_id, tax_source_id, legal_text_draft_id, structure_run_id, creation_origin, status, revision_no, supersedes_proposal_id, created_at';

function throwIfProposalContractInvalid(
  result: TaxKnowledgeProposalV1ValidationResult,
  message: string,
  code: string,
): void {
  if (result.valid_schema) return;
  throw new AppError(400, message, code, {
    valid_schema: result.valid_schema,
    publication_eligible: result.publication_eligible,
    owner_approval_allowed: result.owner_approval_allowed,
    errors: result.errors,
    warnings: result.warnings,
    blocking_uncertainties: result.blocking_uncertainties,
  });
}

async function loadDraft(draftId: string) {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select('id, country_code, document_id, tax_source_id, structure_run_id, draft_legal_text')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Legal text draft not found');
  return data;
}

export async function validateProposalJsonForDraft(
  proposalJson: Record<string, unknown>,
  draft: {
    id: string;
    country_code: string;
    tax_source_id: string;
    draft_legal_text: string | null;
  },
): Promise<TaxKnowledgeProposalV1ValidationResult> {
  return validateTaxKnowledgeProposalV1AgainstStore({
    proposal_json: proposalJson,
    context: {
      country_code: String(draft.country_code),
      tax_source_id: String(draft.tax_source_id),
      legal_text_draft_id: String(draft.id),
      draft_legal_text: String(draft.draft_legal_text ?? ''),
    },
  });
}

async function loadProposal(proposalId: string) {
  const { data, error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select(PROPOSAL_SELECT)
    .eq('id', proposalId)
    .maybeSingle();
  throwIfProposalSchemaMissing(error);
  if (error) throw error;
  if (!data) throw notFound('Tax knowledge proposal not found');
  return data;
}

async function loadCorrectedProposalJsonFromRuleText(
  sourceId: string,
  rawCorrections: unknown,
): Promise<Record<string, unknown>> {
  const corrections = parseTaxKnowledgeProposalRuleTextCorrections(rawCorrections);
  if (!corrections) {
    throw badRequest('rule_text_corrections must be human-readable rule title, statement, and notes only');
  }
  const { data, error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select('proposal_json')
    .eq('id', sourceId)
    .maybeSingle();
  throwIfProposalSchemaMissing(error);
  if (error) throw error;
  const applied = applyTaxKnowledgeProposalRuleTextCorrections(parseProposalJson(data?.proposal_json), corrections);
  if (!applied.ok) throw badRequest(applied.message);
  return applied.proposal_json;
}

async function nextRevisionNo(draftId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select('revision_no')
    .eq('legal_text_draft_id', draftId)
    .order('revision_no', { ascending: false })
    .limit(1);
  throwIfProposalSchemaMissing(error);
  if (error) throw error;
  return nextProposalRevisionNo(data?.[0]?.revision_no == null ? null : Number(data[0].revision_no));
}

export async function insertProposedTaxKnowledgeProposalRow(
  row: Record<string, unknown>,
): Promise<{ id: string; revision_no: number }> {
  return insertProposalSnapshot(row);
}

async function insertProposalSnapshot(row: Record<string, unknown>): Promise<{ id: string; revision_no: number }> {
  const draftId = String(row.legal_text_draft_id);
  let lastError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < REVISION_INSERT_ATTEMPTS; attempt += 1) {
    const revisionNo = await nextRevisionNo(draftId);
    const { data, error } = await supabaseAdmin
      .from(PROPOSAL_TABLE)
      .insert({ ...row, revision_no: revisionNo })
      .select('id, revision_no')
      .single();
    if (!error && data) {
      return { id: String(data.id), revision_no: Number(data.revision_no) };
    }
    lastError = error;
    throwIfProposalSchemaMissing(error);
    if (isProposalRevisionConflictError(error) && attempt < REVISION_INSERT_ATTEMPTS - 1) continue;
    if (isProposalRevisionConflictError(error)) {
      throw conflict('Tax knowledge proposal revision number conflict; retry the command');
    }
    if (error) throw error;
  }
  throw conflict('Tax knowledge proposal revision number conflict; retry the command');
}

export async function createTaxKnowledgeProposal(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  assertNoTrustedProvenance(payload);
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  if (payload.creation_origin === 'ai_proposal') {
    throw badRequest('AI proposals must be created with generate_tax_knowledge_proposal');
  }
  if (!isTaxKnowledgeProposalCreationOrigin(payload.creation_origin)) {
    throw badRequest('creation_origin must be owner_corrected');
  }
  const proposalJson = parseProposalJson(payload.proposal_json);
  const supersedesId = asOptionalUuid(payload.supersedes_proposal_id, 'supersedes_proposal_id');
  const draft = await loadDraft(draftId);
  const validation = await validateProposalJsonForDraft(proposalJson, draft);
  throwIfProposalContractInvalid(
    validation,
    'proposal_json failed tax_knowledge_proposal_v1 validation',
    'TAX_KNOWLEDGE_PROPOSAL_INVALID',
  );
  if (supersedesId) {
    const prior = await loadProposal(supersedesId);
    if (String(prior.legal_text_draft_id) !== draftId) {
      throw badRequest('supersedes_proposal_id must belong to the same Owner Draft');
    }
  }

  const created = await insertProposalSnapshot({
    country_code: draft.country_code,
    document_id: draft.document_id,
    tax_source_id: draft.tax_source_id,
    legal_text_draft_id: draft.id,
    structure_run_id: draft.structure_run_id,
    creation_origin: payload.creation_origin,
    status: 'proposed',
    supersedes_proposal_id: supersedesId,
    proposal_json: proposalJson,
    created_by: ctx.user.id,
    updated_by: ctx.user.id,
  });

  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_CREATED, created.id, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    legal_text_draft_id: draftId,
    creation_origin: payload.creation_origin,
    revision_no: created.revision_no,
    supersedes_proposal_id: supersedesId,
  });

  return {
    country_code: String(draft.country_code),
    document_id: String(draft.document_id),
    draft_id: draftId,
    proposal_id: created.id,
  };
}

export async function setTaxKnowledgeProposalReviewStatus(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  const proposalId = asUuid(payload.tax_knowledge_proposal_id ?? payload.proposal_id, 'tax_knowledge_proposal_id');
  if (!isTaxKnowledgeProposalStatus(payload.status)) {
    throw badRequest('status must be a Layer B2 proposal workflow status');
  }
  if (payload.status === 'published_to_canonical_draft') {
    throw badRequest('published_to_canonical_draft is not available; there is no publication command');
  }
  if ('proposal_json' in payload && payload.proposal_json !== undefined) {
    throw badRequest('proposal_json cannot be mutated in place; create a corrected revision');
  }
  const current = await loadProposal(proposalId);
  if (!canSetTaxKnowledgeProposalReviewStatus(String(current.status), payload.status)) {
    throw conflict(`Invalid proposal status transition: ${String(current.status)} → ${payload.status}`);
  }
  if (payload.status === 'owner_approved') {
    const [{ data: proposalRow, error: proposalError }, draft] = await Promise.all([
      supabaseAdmin.from(PROPOSAL_TABLE).select('proposal_json').eq('id', proposalId).maybeSingle(),
      loadDraft(String(current.legal_text_draft_id)),
    ]);
    throwIfProposalSchemaMissing(proposalError);
    if (proposalError) throw proposalError;
    const proposalJson = parseProposalJson(proposalRow?.proposal_json);
    const validation = await validateProposalJsonForDraft(proposalJson, draft);
    if (!canOwnerApproveTaxKnowledgeProposal(validation)) {
      throw new AppError(
        409,
        'owner_approved requires a valid tax_knowledge_proposal_v1 contract',
        'TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVABLE',
        {
          valid_schema: validation.valid_schema,
          publication_eligible: validation.publication_eligible,
          owner_approval_allowed: validation.owner_approval_allowed,
          errors: validation.errors,
          warnings: validation.warnings,
          blocking_uncertainties: validation.blocking_uncertainties,
        },
      );
    }
  }
  const { error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .update({ status: payload.status, updated_by: ctx.user.id })
    .eq('id', proposalId);
  throwIfProposalSchemaMissing(error);
  if (error) throw error;

  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_REVIEW_STATUS_SET, proposalId, {
    country_code: current.country_code,
    document_id: current.document_id,
    legal_text_draft_id: current.legal_text_draft_id,
    from_status: current.status,
    status: payload.status,
  });

  return {
    country_code: String(current.country_code),
    document_id: String(current.document_id),
    draft_id: String(current.legal_text_draft_id),
    proposal_id: proposalId,
  };
}

export async function createCorrectedTaxKnowledgeProposal(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  assertNoTrustedProvenance(payload);
  if ('creation_origin' in payload && payload.creation_origin !== undefined) {
    throw badRequest('creation_origin is owner_corrected for this command and cannot be supplied');
  }
  const sourceId = asUuid(
    payload.source_tax_knowledge_proposal_id ?? payload.tax_knowledge_proposal_id ?? payload.proposal_id,
    'source_tax_knowledge_proposal_id',
  );
  const hasProposalJson = payload.proposal_json !== undefined;
  const hasRuleTextCorrections = payload.rule_text_corrections !== undefined;
  if (hasProposalJson && hasRuleTextCorrections) {
    throw badRequest('send either proposal_json or rule_text_corrections, not both');
  }
  const source = await loadProposal(sourceId);
  const proposalJson = hasRuleTextCorrections
    ? await loadCorrectedProposalJsonFromRuleText(sourceId, payload.rule_text_corrections)
    : parseProposalJson(payload.proposal_json);
  const sourceDraftId = String(source.legal_text_draft_id);
  const requestedDraftId = asOptionalUuid(payload.legal_text_draft_id, 'legal_text_draft_id');
  if (requestedDraftId && requestedDraftId !== sourceDraftId) {
    throw badRequest('corrected proposal must stay on the same Owner Draft');
  }
  const draft = await loadDraft(sourceDraftId);
  const validation = await validateProposalJsonForDraft(proposalJson, draft);
  throwIfProposalContractInvalid(
    validation,
    'corrected proposal_json failed tax_knowledge_proposal_v1 validation',
    'TAX_KNOWLEDGE_PROPOSAL_INVALID',
  );

  const created = await insertProposalSnapshot({
    country_code: draft.country_code,
    document_id: draft.document_id,
    tax_source_id: draft.tax_source_id,
    legal_text_draft_id: draft.id,
    structure_run_id: draft.structure_run_id,
    creation_origin: 'owner_corrected',
    status: 'proposed',
    supersedes_proposal_id: sourceId,
    proposal_json: proposalJson,
    created_by: ctx.user.id,
    updated_by: ctx.user.id,
  });

  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_CORRECTED, created.id, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    legal_text_draft_id: sourceDraftId,
    source_tax_knowledge_proposal_id: sourceId,
    creation_origin: 'owner_corrected',
    revision_no: created.revision_no,
  });

  return {
    country_code: String(draft.country_code),
    document_id: String(draft.document_id),
    draft_id: sourceDraftId,
    proposal_id: created.id,
  };
}

export async function recordTaxKnowledgeProposalExternalReference(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  assertNoTrustedProvenance(payload);
  const parsed = parseOwnerExternalReferencePayload(payload);
  const sourceId = asUuid(parsed.tax_knowledge_proposal_id, 'tax_knowledge_proposal_id');
  await loadProposal(sourceId);
  const { data, error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select('proposal_json')
    .eq('id', sourceId)
    .maybeSingle();
  throwIfProposalSchemaMissing(error);
  if (error) throw error;
  const nextJson = appendOwnerExternalUnresolvedReference(parseProposalJson(data?.proposal_json), parsed);
  const created = await createCorrectedTaxKnowledgeProposal(ctx, {
    source_tax_knowledge_proposal_id: sourceId,
    proposal_json: nextJson,
  });
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_EXTERNAL_REFERENCE_RECORDED, created.proposal_id, {
    country_code: created.country_code,
    document_id: created.document_id,
    legal_text_draft_id: created.draft_id,
    source_tax_knowledge_proposal_id: sourceId,
    proposal_rule_key: parsed.proposal_rule_key,
    relationship_type: parsed.relationship_type,
    cited_instrument_kind: parsed.cited_instrument_kind,
    locator_text: parsed.locator_text,
    cited_law_name: parsed.cited_law_name,
    owner_authored: true,
    unresolved: true,
  });
  return created;
}

function assertPublishPayload(payload: Record<string, unknown>): void {
  assertNoTrustedProvenance(payload);
  const extra = Object.keys(payload).filter((key) => payload[key] !== undefined && key !== 'tax_knowledge_proposal_id');
  if (extra.length) {
    throw badRequest('publish_tax_knowledge_proposal_to_canonical_draft accepts tax_knowledge_proposal_id only');
  }
}

function throwIfPublishPlanError(error: unknown): never | void {
  if (error instanceof TaxKnowledgeProposalPublishPlanError) {
    const status = error.code === 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH' ? 403 : 409;
    throw new AppError(status, error.message, error.code);
  }
}

function throwIfPublishRpcError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const message = String(error.message ?? 'canonical draft publication failed');
  if (/only from owner_approved/i.test(message)) {
    throw conflict(message, 'TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVED');
  }
  if (/Country Legal Values|legal_value_id/i.test(message)) {
    throw new AppError(409, message, 'TAX_KNOWLEDGE_PROPOSAL_MISSING_LEGAL_VALUE');
  }
  if (/Fact Dictionary|tax_fact_definition/i.test(message)) {
    throw new AppError(409, message, 'TAX_KNOWLEDGE_PROPOSAL_MISSING_FACT');
  }
  if (/country|tax_source/i.test(message)) {
    throw forbidden(message, 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH');
  }
  throw conflict(message, 'TAX_KNOWLEDGE_PROPOSAL_PUBLISH_FAILED');
}

function generatedMachineCodes(targets: ReturnType<typeof proposalMachineCodeTargets>): {
  node_codes: Record<string, string>;
  rule_codes: Record<string, string>;
} {
  const node_codes: Record<string, string> = {};
  const rule_codes: Record<string, string> = {};
  for (const node of targets.nodes) {
    if (!node.local_key) continue;
    node_codes[node.local_key] = generateLegalMachineCode('node', node.title || node.local_key, randomBytes(6).toString('hex'));
  }
  for (const rule of targets.rules) {
    if (!rule.local_key) continue;
    rule_codes[rule.local_key] = generateLegalMachineCode('rule', rule.title || rule.local_key, randomBytes(6).toString('hex'));
  }
  return { node_codes, rule_codes };
}

export async function publishTaxKnowledgeProposalToCanonicalDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  assertPublishPayload(payload);
  const proposalId = asUuid(payload.tax_knowledge_proposal_id, 'tax_knowledge_proposal_id');
  const current = await loadProposal(proposalId);
  const draft = await loadDraft(String(current.legal_text_draft_id));
  if (String(draft.country_code) !== String(current.country_code) || String(draft.tax_source_id) !== String(current.tax_source_id)) {
    throw forbidden('Tax knowledge proposal country and tax_source must match the Owner Draft', 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH');
  }

  const retryPlan = { country_code: String(current.country_code) };
  if (String(current.status) === 'published_to_canonical_draft') {
    const retry = await supabaseAdmin.rpc(TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC, {
      p_tax_knowledge_proposal_id: proposalId,
      p_actor_user_id: ctx.user.id,
      p_plan: retryPlan,
    });
    throwIfPublishRpcError(retry.error);
    await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_PUBLISHED_TO_CANONICAL_DRAFT, proposalId, {
      country_code: current.country_code,
      document_id: current.document_id,
      legal_text_draft_id: current.legal_text_draft_id,
      already_published: true,
    });
    return {
      country_code: String(current.country_code),
      document_id: String(current.document_id),
      draft_id: String(current.legal_text_draft_id),
      proposal_id: proposalId,
    };
  }

  if (String(current.status) !== 'owner_approved') {
    throw conflict(
      'proposal may be published_to_canonical_draft only from owner_approved',
      'TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVED',
    );
  }

  const { data: proposalRow, error: proposalError } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select('proposal_json')
    .eq('id', proposalId)
    .maybeSingle();
  throwIfProposalSchemaMissing(proposalError);
  if (proposalError) throw proposalError;
  const proposalJson = parseProposalJson(proposalRow?.proposal_json);
  const validation = await validateProposalJsonForDraft(proposalJson, draft);
  if (!validation.publication_eligible) {
    throw new AppError(
      409,
      'canonical draft publication requires a TAX-639 publication_eligible proposal',
      'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
      {
        valid_schema: validation.valid_schema,
        publication_eligible: validation.publication_eligible,
        owner_approval_allowed: validation.owner_approval_allowed,
        errors: validation.errors,
        warnings: validation.warnings,
        blocking_uncertainties: validation.blocking_uncertainties,
      },
    );
  }

  const ruleset = await resolveOwnerLegalValueRulesetContextForCountry({
    countryCode: String(current.country_code),
    effectiveDate: earliestPublishableRuleEffectiveFrom(proposalJson),
  });
  if (ruleset.country_code !== String(current.country_code)) {
    throw forbidden('country pack/ruleset must belong to the proposal country', 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH');
  }

  const codes = generatedMachineCodes(proposalMachineCodeTargets(proposalJson));
  let plan: Record<string, unknown>;
  try {
    plan = buildTaxKnowledgeProposalCanonicalDraftPlan({
      country_code: String(current.country_code),
      tax_source_id: String(current.tax_source_id),
      country_pack_id: ruleset.country_pack_id,
      country_pack_ruleset_id: ruleset.active_ruleset_id,
      proposal_json: proposalJson,
      validation,
      node_codes: codes.node_codes,
      rule_codes: codes.rule_codes,
    });
  } catch (error) {
    throwIfPublishPlanError(error);
    throw error;
  }

  const published = await supabaseAdmin.rpc(TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC, {
    p_tax_knowledge_proposal_id: proposalId,
    p_actor_user_id: ctx.user.id,
    p_plan: plan,
  });
  throwIfPublishRpcError(published.error);

  const result = published.data && typeof published.data === 'object' && !Array.isArray(published.data)
    ? (published.data as Record<string, unknown>)
    : {};
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_PUBLISHED_TO_CANONICAL_DRAFT, proposalId, {
    country_code: current.country_code,
    document_id: current.document_id,
    legal_text_draft_id: current.legal_text_draft_id,
    already_published: result.already_published === true,
    published_tax_rule_id: result.published_tax_rule_id ?? null,
    published_tax_rule_version_id: result.published_tax_rule_version_id ?? null,
    published_tax_legal_node_id: result.published_tax_legal_node_id ?? null,
  });

  return {
    country_code: String(current.country_code),
    document_id: String(current.document_id),
    draft_id: String(current.legal_text_draft_id),
    proposal_id: proposalId,
  };
}
