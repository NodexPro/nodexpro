import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, notFound } from '../../shared/errors.js';
import {
  AiGatewayError,
  completeStructuredJson,
  type AiGatewayCompleteStructuredJsonResult,
} from '../../shared/ai-gateway/index.js';
import { loadControlledExtractionContext } from './tax-knowledge-proposal-extract-context.service.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
} from './tax-knowledge-proposal-extract-v1.js';
import {
  assertDraftReadyForAiExtraction,
  buildCanonicalAllowlist,
  buildExtractSystemMessage,
  buildExtractUserMessage,
  buildGenerationMetadataJson,
  digestControlledExtractionInput,
  parseGenerateTaxKnowledgeProposalDraftId,
  sanitizeGenerateAuditPayload,
  type ControlledExtractionContext,
  type GenerateDraftRow,
} from './tax-knowledge-proposal-extract.pure.js';
import {
  normalizeTaxKnowledgeProposalExtract,
  type TaxKnowledgeProposalCanonicalAllowlist,
} from './tax-knowledge-proposal-extract-normalize.pure.js';
import {
  insertProposedTaxKnowledgeProposalRow,
  type TaxKnowledgeProposalCommandResult,
  validateProposalJsonForDraft,
} from './knowledge-trainer-tax-knowledge-proposal.service.js';
import { canOwnerApproveTaxKnowledgeProposal } from './tax-knowledge-proposal-v1.pure.js';
import type { TaxKnowledgeProposalV1ValidationResult } from './tax-knowledge-proposal-v1.types.js';
import { TAX_KNOWLEDGE_PROPOSAL_CONTRACT, TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION } from './tax-knowledge-proposal-v1.types.js';

const PROPOSAL_TABLE = 'legal_ingestion_tax_knowledge_proposals';

export type GenerateTaxKnowledgeProposalDeps = {
  loadDraft?: (draftId: string) => Promise<GenerateDraftRow>;
  loadContext?: (draft: GenerateDraftRow) => Promise<ControlledExtractionContext>;
  completeStructuredJson?: typeof completeStructuredJson;
  validateProposal?: typeof validateProposalJsonForDraft;
  insertProposal?: typeof insertProposedTaxKnowledgeProposalRow;
  writeAudit?: typeof writeAudit;
  now?: () => Date;
};

async function defaultLoadDraft(draftId: string): Promise<GenerateDraftRow> {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select(
      'id, country_code, document_id, tax_source_id, structure_run_id, parent_draft_id, review_status, kind_label, title, source_display_identifier, normalized_machine_identifier, printed_marker, draft_legal_text',
    )
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Legal text draft not found');
  return {
    id: String(data.id),
    country_code: String(data.country_code),
    document_id: String(data.document_id),
    tax_source_id: String(data.tax_source_id),
    structure_run_id: data.structure_run_id == null ? null : String(data.structure_run_id),
    parent_draft_id: data.parent_draft_id == null ? null : String(data.parent_draft_id),
    review_status: String(data.review_status),
    kind_label: data.kind_label == null ? null : String(data.kind_label),
    title: data.title == null ? null : String(data.title),
    source_display_identifier:
      data.source_display_identifier == null ? null : String(data.source_display_identifier),
    normalized_machine_identifier:
      data.normalized_machine_identifier == null ? null : String(data.normalized_machine_identifier),
    printed_marker: data.printed_marker == null ? null : String(data.printed_marker),
    draft_legal_text: data.draft_legal_text == null ? null : String(data.draft_legal_text),
  };
}

function allowlistFromContext(context: ControlledExtractionContext): TaxKnowledgeProposalCanonicalAllowlist {
  if (context.canonical_allowlist) return context.canonical_allowlist;
  return buildCanonicalAllowlist({
    existing_legal_nodes: context.existing_legal_nodes,
    tax_source_id: context.draft.tax_source_id,
  });
}

function throwIfProposalInvalid(result: TaxKnowledgeProposalV1ValidationResult): void {
  if (result.valid_schema) return;
  throw new AppError(400, 'proposal_json failed tax_knowledge_proposal_v1 validation', 'TAX_KNOWLEDGE_PROPOSAL_INVALID', {
    valid_schema: result.valid_schema,
    publication_eligible: result.publication_eligible,
    owner_approval_allowed: canOwnerApproveTaxKnowledgeProposal(result),
    errors: result.errors,
    warnings: result.warnings,
    blocking_uncertainties: result.blocking_uncertainties,
  });
}

export function createGenerateTaxKnowledgeProposal(deps: GenerateTaxKnowledgeProposalDeps = {}) {
  const loadDraft = deps.loadDraft ?? defaultLoadDraft;
  const loadContext = deps.loadContext ?? loadControlledExtractionContext;
  const complete = deps.completeStructuredJson ?? completeStructuredJson;
  const validateProposal = deps.validateProposal ?? validateProposalJsonForDraft;
  const insertProposal = deps.insertProposal ?? insertProposedTaxKnowledgeProposalRow;
  const auditWrite = deps.writeAudit ?? writeAudit;
  const now = deps.now ?? (() => new Date());

  return async function generateTaxKnowledgeProposal(
    ctx: RequestContext,
    payload: Record<string, unknown>,
  ): Promise<TaxKnowledgeProposalCommandResult> {
    const draftId = parseGenerateTaxKnowledgeProposalDraftId(payload);
    const draft = await loadDraft(draftId);
    assertDraftReadyForAiExtraction(draft);
    const context = await loadContext(draft);
    const inputContextDigest = digestControlledExtractionInput(context);

    let result: AiGatewayCompleteStructuredJsonResult;
    try {
      result = await complete({
        purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
        messages: [
          { role: 'system', content: buildExtractSystemMessage() },
          { role: 'user', content: buildExtractUserMessage(context) },
        ],
        outputSchema: {
          name: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.name,
          schema: { ...TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema } as Record<string, unknown>,
        },
        promptContractVersion: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
        outputContract: TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
        outputSchemaVersion: TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
        includesUntrustedSourceText: true,
        correlationId: ctx.correlationId ?? null,
      });
    } catch (error) {
      const outcome =
        error instanceof AiGatewayError ? error.outcome : 'provider_unavailable';
      await auditWrite({
        organizationId: null,
        actorUserId: ctx.user.id,
        entityType: PROPOSAL_TABLE,
        entityId: draftId,
        action: AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_GENERATED,
        payload: sanitizeGenerateAuditPayload({
          legal_text_draft_id: draftId,
          outcome,
          input_context_digest: inputContextDigest,
          attempt_count: error instanceof AiGatewayError ? Number(error.details?.attempt_count ?? null) : null,
        }),
      });
      throw error;
    }

    const normalizedJson = normalizeTaxKnowledgeProposalExtract(result.json, {
      draftLegalText: String(draft.draft_legal_text ?? ''),
      allowlist: allowlistFromContext(context),
    });
    const validation = await validateProposal(normalizedJson as Record<string, unknown>, {
      id: draft.id,
      country_code: draft.country_code,
      tax_source_id: draft.tax_source_id,
      draft_legal_text: draft.draft_legal_text,
    });
    if (!validation.valid_schema) {
      await auditWrite({
        organizationId: null,
        actorUserId: ctx.user.id,
        entityType: PROPOSAL_TABLE,
        entityId: draftId,
        action: AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_GENERATED,
        payload: sanitizeGenerateAuditPayload({
          legal_text_draft_id: draftId,
          provider: result.provider,
          model: result.model,
          latency_ms: result.latency_ms,
          outcome: 'tax_639_invalid',
          input_context_digest: inputContextDigest,
          attempt_count: result.telemetry.attempt_count,
        }),
      });
      throwIfProposalInvalid(validation);
    }

    const created = await insertProposal({
      country_code: draft.country_code,
      document_id: draft.document_id,
      tax_source_id: draft.tax_source_id,
      legal_text_draft_id: draft.id,
      structure_run_id: draft.structure_run_id,
      creation_origin: 'ai_proposal',
      status: 'proposed',
      supersedes_proposal_id: null,
      proposal_json: normalizedJson,
      generation_metadata_json: buildGenerationMetadataJson({
        provider: result.provider,
        model: result.model,
        generatedAt: now().toISOString(),
        inputContextDigest,
      }),
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    });

    await auditWrite({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: PROPOSAL_TABLE,
      entityId: created.id,
      action: AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_GENERATED,
      payload: sanitizeGenerateAuditPayload({
        legal_text_draft_id: draftId,
        proposal_id: created.id,
        provider: result.provider,
        model: result.model,
        latency_ms: result.latency_ms,
        outcome: 'success',
        input_context_digest: inputContextDigest,
        attempt_count: result.telemetry.attempt_count,
      }),
    });

    return {
      country_code: draft.country_code,
      document_id: draft.document_id,
      draft_id: draftId,
      proposal_id: created.id,
    };
  };
}

export const generateTaxKnowledgeProposal = createGenerateTaxKnowledgeProposal();
