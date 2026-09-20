import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerateTaxKnowledgeProposal } from '../../src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.js';
import {
  buildExtractUserMessage,
  type ControlledExtractionContext,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';
import type { RequestContext } from '../../src/shared/context.js';

const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const OWNER_B = 'OWNER_CORRECTED_LEGAL_TEXT_B';
const SOURCE_A = 'EXTRACTED_SOURCE_A_OCR_ERROR';

function ctx(): RequestContext {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      authUserId: 'auth',
      email: 'owner@example.com',
      fullName: 'Owner',
      status: 'active',
      uiLanguage: 'he',
    },
    membership: null,
    organizationId: null,
  };
}

function contextFromDraft(draftLegalText: string): ControlledExtractionContext {
  return {
    prompt_contract_version: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
    purpose: 'tax_knowledge_proposal_extraction',
    output_contract: 'tax_knowledge_proposal_v1',
    output_schema_version: 1,
    draft: {
      id: DRAFT_ID,
      country_code: 'IL',
      tax_source_id: '33333333-3333-4333-8333-333333333333',
      kind_label: 'סעיף קטן',
      title: '2(2)(ב)',
      source_display_identifier: '2(2)(ב)',
      normalized_machine_identifier: '2(2)(ב)',
      printed_marker: null,
      draft_legal_text: draftLegalText,
    },
    ancestors: [],
    existing_legal_nodes: [],
    canonical_allowlist: { tax_legal_node_ids: [], tax_source_ids: ['33333333-3333-4333-8333-333333333333'] },
    tax_fact_definitions: [],
    country_legal_value_keys: [],
    relationship_vocabulary: ['depends_on'],
    k3_predicate_contract: { ops: ['eq'] },
    k4_calculation_hook_contract: { expression_must_be_null: true },
    output_contract_keys: ['schema_version'],
    extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
    bounds: { matched_legal_nodes: 0, fact_definitions: 0, legal_value_keys: 0, ancestors: 0 },
  };
}

test('TAX-651 generate_tax_knowledge_proposal sends persisted B and keeps Proposal if translation fails', async () => {
  let userContent = '';
  let presentationsTried = false;
  const generate = createGenerateTaxKnowledgeProposal({
    loadDraft: async () => ({
      id: DRAFT_ID,
      country_code: 'IL',
      document_id: '22222222-2222-4222-8222-222222222222',
      tax_source_id: '33333333-3333-4333-8333-333333333333',
      structure_run_id: null,
      parent_draft_id: null,
      review_status: 'ready',
      kind_label: 'סעיף קטן',
      title: '2(2)(ב)',
      source_display_identifier: '2(2)(ב)',
      normalized_machine_identifier: '2(2)(ב)',
      printed_marker: null,
      draft_legal_text: OWNER_B,
    }),
    hasExistingProposal: async () => false,
    loadContext: async (draft) => contextFromDraft(String(draft.draft_legal_text ?? '')),
    completeStructuredJson: async ({ messages }) => {
      userContent = String(messages.find((row) => row.role === 'user')?.content ?? '');
      return {
        json: {
          schema_version: 1,
          contract: 'tax_knowledge_proposal_v1',
          extraction_outcome: 'no_rules',
          legal_nodes: [],
          rules: [],
          relationships: [],
          calculations: [],
          facts: [],
          legal_values: [],
          evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
          uncertainties: [],
        },
        provider: 'openai',
        model: 'test-model',
        latency_ms: 1,
        outcome: 'success' as const,
        telemetry: { attempt_count: 1 } as never,
      };
    },
    validateProposal: async () => ({
      valid_schema: true,
      publication_eligible: false,
      owner_approval_allowed: true,
      errors: [],
      warnings: [],
      blocking_uncertainties: [],
      resolved_fact_bindings: [],
      resolved_legal_values: [],
      resolved_existing_rule_refs: [],
      evidence_validation: {
        draft_legal_text_length: OWNER_B.length,
        verbatim_quote_count: 0,
        paraphrase_quote_count: 0,
        citation_count: 0,
        authoritative_evidence: false,
        quotes: [],
      },
    }),
    insertProposal: async () => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision_no: 1 }),
    loadKindCatalog: async () => [],
    persistOwnerPresentations: async () => {
      presentationsTried = true;
      throw new Error('translation failed independently');
    },
    writeAudit: async () => undefined,
    now: () => new Date('2026-09-20T00:00:00.000Z'),
  });

  const result = await generate(ctx(), { legal_text_draft_id: DRAFT_ID });
  assert.equal(result.proposal_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.match(userContent, /OWNER_CORRECTED_LEGAL_TEXT_B/);
  assert.doesNotMatch(userContent, new RegExp(SOURCE_A));
  assert.doesNotMatch(userContent, /original_source_text/);
  assert.equal(buildExtractUserMessage(contextFromDraft(OWNER_B)).includes(OWNER_B), true);
  assert.equal(presentationsTried, true);
});
