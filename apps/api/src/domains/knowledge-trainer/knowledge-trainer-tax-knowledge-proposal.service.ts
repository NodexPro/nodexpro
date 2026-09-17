import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_TRUSTED_PROVENANCE_FIELDS,
  canSetTaxKnowledgeProposalReviewStatus,
  isProposalRevisionConflictError,
  isTaxKnowledgeProposalCreationOrigin,
  isTaxKnowledgeProposalStatus,
  nextProposalRevisionNo,
  proposalJsonIsObject,
} from './knowledge-trainer-tax-knowledge-proposal.pure.js';

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

async function loadDraft(draftId: string) {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select('id, country_code, document_id, tax_source_id, structure_run_id')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Legal text draft not found');
  return data;
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
  if (!isTaxKnowledgeProposalCreationOrigin(payload.creation_origin)) {
    throw badRequest('creation_origin must be ai_proposal or owner_corrected');
  }
  const proposalJson = parseProposalJson(payload.proposal_json);
  const supersedesId = asOptionalUuid(payload.supersedes_proposal_id, 'supersedes_proposal_id');
  const draft = await loadDraft(draftId);
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
  const proposalJson = parseProposalJson(payload.proposal_json);
  const source = await loadProposal(sourceId);
  const sourceDraftId = String(source.legal_text_draft_id);
  const requestedDraftId = asOptionalUuid(payload.legal_text_draft_id, 'legal_text_draft_id');
  if (requestedDraftId && requestedDraftId !== sourceDraftId) {
    throw badRequest('corrected proposal must stay on the same Owner Draft');
  }
  const draft = await loadDraft(sourceDraftId);

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
