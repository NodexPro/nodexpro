import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { createGenerateTaxKnowledgeProposal } from '../../src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.js';
import { buildTaxKnowledgeProposalOwnerView } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.js';
import { taxKnowledgeProposalAllowedActions } from '../../src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.pure.js';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';
import type { RequestContext } from '../../src/shared/context.js';
import type { GenerateDraftRow } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';

const LAYER_B = 'שר האוצר יקבע את שווי השימוש ברכב;';
const LAYER_A = 'stale original OCR text';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const OLD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ctx: RequestContext = {
  user: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    authUserId: 'auth',
    email: 'owner@example.com',
    fullName: 'Owner',
    status: 'active',
    uiLanguage: 'he',
  },
  membership: null,
  organizationId: null,
};

function draftRow(): GenerateDraftRow {
  return {
    id: DRAFT_ID,
    country_code: 'IL',
    document_id: DOC_ID,
    tax_source_id: SOURCE_ID,
    structure_run_id: null,
    parent_draft_id: null,
    review_status: 'ready',
    kind_label: 'פסקה',
    title: null,
    source_display_identifier: '2(2)(ב)',
    normalized_machine_identifier: '2(2)(ב)',
    printed_marker: '(ב)',
    draft_legal_text: LAYER_B,
  };
}

function noRulesJson() {
  return {
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
  };
}

function rulesJson() {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'n1',
        source_display_identifier: '2(2)(ב)',
        title: '2(2)(ב)',
      },
    ],
    rules: [
      {
        proposal_rule_key: 'r1',
        title: 'Minister determines vehicle-use value',
        rule_kind: 'legal_rule',
        statement: 'The Minister of Finance determines the value of vehicle use.',
        applicability_status: 'cannot_determine',
        applies_if: null,
        does_not_apply_if: null,
        notes: null,
        effective_from: null,
        effective_to: null,
        legal_node_keys: ['n1'],
        existing_tax_legal_node_ids: [],
        legal_value_keys: [],
        calculation_keys: [],
      },
    ],
    relationships: [],
    calculations: [],
    facts: [],
    legal_values: [],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [{ role: 'verbatim_from_draft', text: LAYER_B, start: 0, end: LAYER_B.length }],
      citations: [{ tax_source_id: SOURCE_ID, locator: '2(2)(ב)' }],
    },
    uncertainties: [
      {
        code: 'insufficient_evidence',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'r1' },
        message: 'Pinned Owner evidence does not establish effective_from',
      },
      {
        code: 'cannot_determine',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'r1' },
        message: 'Client applicability requires additional facts.',
      },
    ],
  };
}

function gatewayResult(json: Record<string, unknown>) {
  return {
    json,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    latency_ms: 9,
    outcome: 'success' as const,
    telemetry: {
      purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
      correlation_id: null,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      provider_id: null,
      routing_position: null,
      routing_source: 'env' as const,
      prompt_contract_version: 'tax_knowledge_proposal_extract_v1',
      output_contract: 'tax_knowledge_proposal_v1',
      output_schema_version: 1,
      latency_ms: 9,
      outcome: 'success' as const,
      attempt_count: 1,
      providers_attempted: 1,
      failover_occurred: false,
      failure_category: null,
      circuit_state: null,
      untrusted_source_text: true,
    },
  };
}

test('TAX-651 re-analyze uses current Layer B, inserts rev+1, and does not mutate the old no_rules row', async () => {
  const inserts: Record<string, unknown>[] = [];
  const userMessages: string[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    persistOwnerPresentations: async () => null,
    loadKindCatalog: async () => [],
    loadLatestProposal: async () => ({ id: OLD_ID, revision_no: 1 }),
    loadDraft: async () => draftRow(),
    loadContext: async (draft) => ({
      prompt_contract_version: 'tax_knowledge_proposal_extract_v1',
      purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
      output_contract: 'tax_knowledge_proposal_v1',
      output_schema_version: 1,
      draft: {
        id: draft.id,
        country_code: draft.country_code,
        tax_source_id: draft.tax_source_id,
        kind_label: draft.kind_label,
        title: draft.title,
        source_display_identifier: draft.source_display_identifier,
        normalized_machine_identifier: draft.normalized_machine_identifier,
        printed_marker: draft.printed_marker,
        draft_legal_text: String(draft.draft_legal_text ?? ''),
      },
      ancestors: [],
      existing_legal_nodes: [],
      canonical_allowlist: { tax_legal_node_ids: [], tax_source_ids: [draft.tax_source_id] },
      tax_fact_definitions: [],
      country_legal_value_keys: [],
      relationship_vocabulary: ['depends_on'],
      k3_predicate_contract: { ops: ['eq'] },
      k4_calculation_hook_contract: { expression_must_be_null: true },
      output_contract_keys: ['schema_version'],
      extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
      bounds: { matched_legal_nodes: 0, fact_definitions: 0, legal_value_keys: 0, ancestors: 0 },
    }),
    completeStructuredJson: async (input) => {
      const user = input.messages.find((row) => row.role === 'user')?.content ?? '';
      userMessages.push(user);
      return gatewayResult(noRulesJson());
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
        draft_legal_text_length: LAYER_B.length,
        verbatim_quote_count: 0,
        paraphrase_quote_count: 0,
        citation_count: 0,
        authoritative_evidence: false,
        quotes: [],
      },
    }),
    insertProposal: async (row) => {
      inserts.push(row);
      return { id: NEW_ID, revision_no: 2 };
    },
    writeAudit: async () => undefined,
  });
  const out = await generate(ctx, { legal_text_draft_id: DRAFT_ID });
  assert.equal(out.proposal_id, NEW_ID);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.supersedes_proposal_id, OLD_ID);
  assert.equal(inserts[0]?.creation_origin, 'ai_proposal');
  assert.equal(inserts[0]?.status, 'proposed');
  assert.match(userMessages[0] ?? '', new RegExp(LAYER_B.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(userMessages[0] ?? '', /stale original OCR text/);
  assert.doesNotMatch(JSON.stringify(inserts[0]), /tax_rules|activate_tax_rule_version/);
});

test('TAX-651 owner view exposes Re-analyze on the existing generate command after a Proposal exists', () => {
  const view = buildTaxKnowledgeProposalOwnerView({
    selected: {
      id: OLD_ID,
      revision_no: 1,
      status: 'proposed',
      status_label: 'Proposed / מוצע',
      creation_origin: 'ai_proposal',
      legal_text_draft_id: DRAFT_ID,
    },
    proposal_json: noRulesJson(),
    validation: {
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
        draft_legal_text_length: 0,
        verbatim_quote_count: 0,
        paraphrase_quote_count: 0,
        citation_count: 0,
        authoritative_evidence: false,
        quotes: [],
      },
    },
    draft: { id: DRAFT_ID, review_status: 'ready' },
    generate_enabled: true,
  });
  assert.equal(view.create.action_key, 'generate_tax_knowledge_proposal');
  assert.equal(view.create.visible, true);
  assert.equal(view.create.enabled, true);
  assert.equal(view.create.presentation, 'reanalyze');
  assert.equal(view.by_locale.en.reanalyze_label, '✨ Re-analyze');
  assert.equal(
    taxKnowledgeProposalAllowedActions({
      hasSelectedDraft: true,
      selectedDraftReviewStatus: 'ready',
      selectedProposalStatus: 'proposed',
    }).generate_tax_knowledge_proposal,
    true,
  );
  assert.doesNotMatch(JSON.stringify(rulesJson()), /tax_legal_nodes/);
});
