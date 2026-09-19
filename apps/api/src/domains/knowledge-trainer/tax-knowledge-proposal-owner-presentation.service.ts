import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { completeStructuredJson } from '../../shared/ai-gateway/index.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { isSupabaseMissingColumnError } from '../../shared/supabase-errors.js';
import type { TaxKnowledgeProposalCommandResult } from './knowledge-trainer-tax-knowledge-proposal.service.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_JSON_SCHEMA,
  TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_OUTPUT_CONTRACT,
  TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PROMPT_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PURPOSE,
  TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION,
  buildOwnerPresentationJson,
  detectOwnerPresentationSourceLocale,
  digestOwnerPresentationSource,
  extractOwnerPresentationStatements,
  joinOwnerPresentationStatements,
  ownerPresentationCoversDigest,
  parseOwnerPresentationJson,
  parseOwnerPresentationTranslations,
  type TaxKnowledgeProposalOwnerPresentationJson,
} from './tax-knowledge-proposal-owner-presentation.pure.js';

const PROPOSAL_TABLE = 'legal_ingestion_tax_knowledge_proposals';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PersistOwnerPresentationDeps = {
  completeStructuredJson?: typeof completeStructuredJson;
};

function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function buildPresentationSystemMessage(): string {
  return [
    'You translate Owner presentation of an already-extracted Tax Knowledge rule statement.',
    `Prompt contract: ${TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PROMPT_VERSION}.`,
    'This is presentation-only. It is not canonical law and not a new Tax Knowledge Proposal.',
    'Do not invent legal meaning. Do not add, drop, or soften the extracted claim.',
    'Do not translate source evidence quotes. Do not mention a specific statute identifier unless it already appears in the statement.',
    'Return only the requested locale strings.',
  ].join('\n');
}

function buildPresentationUserMessage(input: {
  sourceLocale: string;
  statements: string[];
}): string {
  return JSON.stringify({
    source_locale: input.sourceLocale,
    statements: input.statements,
    translate_into: ['he', 'ru', 'en'],
    keep_source_locale_equivalent: true,
  });
}

export async function persistTaxKnowledgeProposalOwnerPresentations(
  input: {
    proposalId: string;
    proposalJson: Record<string, unknown>;
    existingPresentation?: unknown;
    actorUserId: string;
    correlationId?: string | null;
  },
  deps: PersistOwnerPresentationDeps = {},
): Promise<TaxKnowledgeProposalOwnerPresentationJson | null> {
  const statements = extractOwnerPresentationStatements(input.proposalJson);
  if (!statements.length) return null;
  const sourceExplanation = joinOwnerPresentationStatements(statements);
  const sourceDigest = digestOwnerPresentationSource(statements);
  const existing = parseOwnerPresentationJson(input.existingPresentation);
  if (ownerPresentationCoversDigest(existing, sourceDigest)) return existing;

  const complete = deps.completeStructuredJson ?? completeStructuredJson;
  const sourceLocale = detectOwnerPresentationSourceLocale(sourceExplanation);
  const result = await complete({
    purpose: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PURPOSE,
    messages: [
      { role: 'system', content: buildPresentationSystemMessage() },
      { role: 'user', content: buildPresentationUserMessage({ sourceLocale, statements }) },
    ],
    outputSchema: {
      name: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_JSON_SCHEMA.name,
      schema: { ...TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_JSON_SCHEMA.schema } as Record<string, unknown>,
    },
    promptContractVersion: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PROMPT_VERSION,
    outputContract: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_OUTPUT_CONTRACT,
    outputSchemaVersion: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION,
    includesUntrustedSourceText: true,
    correlationId: input.correlationId ?? null,
  });

  const stored = buildOwnerPresentationJson({
    sourceLocale,
    sourceDigest,
    sourceExplanation,
    translations: parseOwnerPresentationTranslations(result.json),
  });
  if (!stored) {
    throw badRequest('Owner presentation translations were incomplete');
  }

  const { error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .update({
      owner_presentation_json: stored,
      updated_by: input.actorUserId,
    })
    .eq('id', input.proposalId);
  if (error) {
    if (isSupabaseMissingColumnError(error)) {
      throw badRequest('Knowledge Trainer owner presentation schema is not applied. Migration 642 is required on DEV.');
    }
    throw error;
  }
  return stored;
}

export async function ensureTaxKnowledgeProposalOwnerPresentations(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeProposalCommandResult> {
  const proposalId = asUuid(
    payload.tax_knowledge_proposal_id ?? payload.proposal_id,
    'tax_knowledge_proposal_id',
  );
  const { data, error } = await supabaseAdmin
    .from(PROPOSAL_TABLE)
    .select('id, country_code, document_id, legal_text_draft_id, proposal_json, owner_presentation_json')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) {
    if (isSupabaseMissingColumnError(error)) {
      throw badRequest('Knowledge Trainer owner presentation schema is not applied. Migration 642 is required on DEV.');
    }
    throw error;
  }
  if (!data) throw notFound('Tax knowledge proposal not found');
  const proposalJson =
    data.proposal_json && typeof data.proposal_json === 'object' && !Array.isArray(data.proposal_json)
      ? (data.proposal_json as Record<string, unknown>)
      : {};

  await persistTaxKnowledgeProposalOwnerPresentations({
    proposalId,
    proposalJson,
    existingPresentation: data.owner_presentation_json,
    actorUserId: ctx.user.id,
    correlationId: ctx.correlationId ?? null,
  });

  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: PROPOSAL_TABLE,
    entityId: proposalId,
    action: AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_ENSURED,
    payload: {
      country_code: data.country_code,
      document_id: data.document_id,
      legal_text_draft_id: data.legal_text_draft_id,
    },
  });

  return {
    country_code: String(data.country_code),
    document_id: String(data.document_id),
    draft_id: String(data.legal_text_draft_id),
    proposal_id: proposalId,
  };
}
