import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { createGenerateTaxKnowledgeProposal } from '../../src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.js';
import { normalizeTaxKnowledgeProposalExtract } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-normalize.pure.js';
import { validateTaxKnowledgeProposalV1 } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';
import type { RequestContext } from '../../src/shared/context.js';
import type {
  TaxKnowledgeProposalValidationCatalog,
  TaxKnowledgeProposalValidationContext,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';

const DRAFT = 'השתכרות או ריווח מעסק או משלח-יד;';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const VALUE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const KIND_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVENTED_KIND = 'abababab-abab-4bab-8bab-abababababab';

const HEADINGLESS_IDENTITY = {
  title: null,
  source_display_identifier: '2(2)(א)',
  normalized_machine_identifier: '2(2)(א)',
  printed_marker: '(א)',
  kind_label: 'פסקה',
};

const ctx: RequestContext = {
  user: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    authUserId: 'auth',
    email: 'owner@example.com',
    fullName: 'Owner',
    status: 'active',
    uiLanguage: 'he',
  },
  membership: null,
  organizationId: null,
};

function catalog(): TaxKnowledgeProposalValidationCatalog {
  return {
    legal_nodes: [],
    legal_node_kinds: [{ id: KIND_ID, country_code: 'IL' }],
    tax_rules: [],
    tax_rule_versions: [],
    tax_sources: [{ id: SOURCE_ID, country_code: 'IL' }],
    facts: [
      {
        id: FACT_ID,
        fact_key: 'marital_status',
        country_code: 'IL',
        status: 'active',
        value_type: 'enum',
        enum_codes: ['single', 'married'],
      },
    ],
    legal_values: [{ id: VALUE_ID, value_key: 'credit_point_value', country_code: 'IL', status: 'active' }],
  };
}

function context(): TaxKnowledgeProposalValidationContext {
  return {
    country_code: 'IL',
    tax_source_id: SOURCE_ID,
    legal_text_draft_id: DRAFT_ID,
    draft_legal_text: DRAFT,
  };
}

function headinglessExtract(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'parent_heading',
        source_display_identifier: '2(2)',
        title: 'הגדרות',
      },
      {
        proposal_node_key: 'child_headingless',
        source_display_identifier: '2(2)(א)',
        title: null,
        tax_legal_node_kind_id: INVENTED_KIND,
        parent: { kind: 'proposal_node', key: 'parent_heading', tax_legal_node_id: null },
      },
    ],
    rules: [
      {
        proposal_rule_key: 'operative_rule',
        title: 'Business income',
        rule_kind: 'legal_rule',
        statement: 'Business or vocation income is included.',
        applicability_status: 'unconstrained',
        applies_if: null,
        does_not_apply_if: null,
        notes: null,
        effective_from: null,
        effective_to: null,
        legal_node_keys: ['child_headingless'],
        existing_tax_legal_node_ids: [],
        legal_value_keys: ['credit_point_value'],
        calculation_keys: [],
      },
    ],
    relationships: [],
    calculations: [],
    facts: [],
    legal_values: [{ value_key: 'credit_point_value' }],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [{ role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length }],
      citations: [{ tax_source_id: SOURCE_ID, locator: '2(2)(א)' }],
    },
    uncertainties: [
      {
        code: 'insufficient_evidence',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'operative_rule' },
        message: 'Pinned Owner evidence does not establish effective_from',
        detail: null,
      },
    ],
    ...overrides,
  };
}

function normalizeHeadingless(raw: unknown = headinglessExtract()) {
  return normalizeTaxKnowledgeProposalExtract(raw, {
    draftLegalText: DRAFT,
    allowlist: { tax_legal_node_ids: [], tax_source_ids: [SOURCE_ID] },
    draftIdentity: HEADINGLESS_IDENTITY,
    kindCatalog: [{ id: KIND_ID, label: 'פסקה' }],
  });
}

test('TAX-651 headingless Layer B identity and kind_label map without inventing parent title or kind UUID', () => {
  const out = normalizeHeadingless() as Record<string, unknown>;
  const nodes = out.legal_nodes as Array<Record<string, unknown>>;
  const parent = nodes[0];
  const child = nodes[1];
  assert.equal(parent?.title, 'הגדרות');
  assert.equal(parent?.source_display_identifier, '2(2)');
  assert.equal(parent?.tax_legal_node_kind_id, null);
  assert.equal(child?.title, '2(2)(א)');
  assert.equal(child?.source_display_identifier, '2(2)(א)');
  assert.equal(child?.printed_marker, '(א)');
  assert.equal(child?.kind_label, 'פסקה');
  assert.equal(child?.tax_legal_node_kind_id, KIND_ID);
  assert.notEqual(child?.title, 'הגדרות');
});

test('TAX-651 normalizer does not invent insufficient_evidence for a null effective_from', () => {
  const raw = headinglessExtract({ uncertainties: [] });
  const out = normalizeHeadingless(raw) as Record<string, unknown>;
  const rows = out.uncertainties as Array<Record<string, unknown>>;
  assert.equal(rows.some((row) => row.code === 'insufficient_evidence'), false);
  const rejected = validateTaxKnowledgeProposalV1({
    proposal_json: out,
    context: context(),
    catalog: catalog(),
  });
  assert.equal(rejected.valid_schema, false);
  assert.ok(rejected.errors.some((row) => row.path === 'rules[0].effective_from' && row.code === 'required'));
});

test('TAX-651 real headingless rule with model-emitted blocking date uncertainty persists as valid B2, not Publishable', () => {
  const out = normalizeHeadingless();
  const result = validateTaxKnowledgeProposalV1({
    proposal_json: out,
    context: context(),
    catalog: catalog(),
  });
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, false);
  assert.equal(result.owner_approval_allowed, false);
});

test('TAX-651 generate stamps headingless identity/kind and stores B2 when the model emitted blocking insufficient_evidence', async () => {
  const inserts: Record<string, unknown>[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    persistOwnerPresentations: async () => null,
    hasExistingProposal: async () => false,
    loadDraft: async () => ({
      id: DRAFT_ID,
      country_code: 'IL',
      document_id: DOC_ID,
      tax_source_id: SOURCE_ID,
      structure_run_id: null,
      parent_draft_id: null,
      review_status: 'ready',
      kind_label: 'פסקה',
      title: null,
      source_display_identifier: '2(2)(א)',
      normalized_machine_identifier: '2(2)(א)',
      printed_marker: '(א)',
      draft_legal_text: DRAFT,
    }),
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
      ancestors: [
        {
          id: '5dbf2391-5dec-471b-a835-16aa087228a4',
          kind_label: 'סעיף קטן',
          title: 'הגדרות',
          source_display_identifier: '2(2)',
          normalized_machine_identifier: '2(2)',
          draft_legal_text: '',
        },
      ],
      existing_legal_nodes: [],
      canonical_allowlist: { tax_legal_node_ids: [], tax_source_ids: [draft.tax_source_id] },
      tax_fact_definitions: [],
      country_legal_value_keys: [{ value_key: 'credit_point_value' }],
      relationship_vocabulary: ['depends_on'],
      k3_predicate_contract: { ops: ['eq'] },
      k4_calculation_hook_contract: { expression_must_be_null: true },
      output_contract_keys: ['schema_version'],
      extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
      bounds: { matched_legal_nodes: 0, fact_definitions: 0, legal_value_keys: 1, ancestors: 1 },
    }),
    completeStructuredJson: async () => ({
      json: headinglessExtract(),
      provider: 'openai',
      model: 'gpt-5.4',
      latency_ms: 11,
      outcome: 'success' as const,
      telemetry: {
        purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
        correlation_id: null,
        provider: 'openai',
        model: 'gpt-5.4',
        provider_id: null,
        routing_position: null,
        routing_source: 'env' as const,
        prompt_contract_version: 'tax_knowledge_proposal_extract_v1',
        output_contract: 'tax_knowledge_proposal_v1',
        output_schema_version: 1,
        latency_ms: 11,
        outcome: 'success' as const,
        attempt_count: 1,
        providers_attempted: 1,
        failover_occurred: false,
        failure_category: null,
        circuit_state: null,
        untrusted_source_text: true,
      },
    }),
    validateProposal: async (json, draft) =>
      validateTaxKnowledgeProposalV1({
        proposal_json: json,
        context: {
          country_code: draft.country_code,
          tax_source_id: draft.tax_source_id,
          legal_text_draft_id: draft.id,
          draft_legal_text: String(draft.draft_legal_text ?? ''),
        },
        catalog: catalog(),
      }),
    insertProposal: async (row) => {
      inserts.push(row);
      return { id: PROPOSAL_ID, revision_no: 1 };
    },
    loadKindCatalog: async () => [{ id: KIND_ID, label: 'פסקה' }],
    writeAudit: async () => undefined,
  });

  const result = await generate(ctx, { legal_text_draft_id: DRAFT_ID });
  assert.equal(result.proposal_id, PROPOSAL_ID);
  assert.equal(inserts.length, 1);
  const stored = inserts[0]?.proposal_json as Record<string, unknown>;
  const child = (stored.legal_nodes as Array<Record<string, unknown>>)[1];
  const parent = (stored.legal_nodes as Array<Record<string, unknown>>)[0];
  const rule = (stored.rules as Array<Record<string, unknown>>)[0];
  assert.equal(parent?.title, 'הגדרות');
  assert.equal(child?.title, '2(2)(א)');
  assert.equal(child?.tax_legal_node_kind_id, KIND_ID);
  assert.equal(rule?.effective_from, null);
  const rows = stored.uncertainties as Array<Record<string, unknown>>;
  assert.equal(rows[0]?.code, 'insufficient_evidence');
  assert.equal(rows[0]?.severity, 'blocks_rule_publication');
});

test('TAX-651 generate still blocks B2 when the model omits the required date uncertainty', async () => {
  const inserts: Record<string, unknown>[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    persistOwnerPresentations: async () => null,
    hasExistingProposal: async () => false,
    loadDraft: async () => ({
      id: DRAFT_ID,
      country_code: 'IL',
      document_id: DOC_ID,
      tax_source_id: SOURCE_ID,
      structure_run_id: null,
      parent_draft_id: null,
      review_status: 'ready',
      kind_label: 'פסקה',
      title: null,
      source_display_identifier: '2(2)(א)',
      normalized_machine_identifier: '2(2)(א)',
      printed_marker: '(א)',
      draft_legal_text: DRAFT,
    }),
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
      country_legal_value_keys: [{ value_key: 'credit_point_value' }],
      relationship_vocabulary: ['depends_on'],
      k3_predicate_contract: { ops: ['eq'] },
      k4_calculation_hook_contract: { expression_must_be_null: true },
      output_contract_keys: ['schema_version'],
      extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
      bounds: { matched_legal_nodes: 0, fact_definitions: 0, legal_value_keys: 1, ancestors: 0 },
    }),
    completeStructuredJson: async () => ({
      json: headinglessExtract({ uncertainties: [] }),
      provider: 'openai',
      model: 'gpt-5.4',
      latency_ms: 11,
      outcome: 'success' as const,
      telemetry: { attempt_count: 1 } as never,
    }),
    validateProposal: async (json, draft) =>
      validateTaxKnowledgeProposalV1({
        proposal_json: json,
        context: {
          country_code: draft.country_code,
          tax_source_id: draft.tax_source_id,
          legal_text_draft_id: draft.id,
          draft_legal_text: String(draft.draft_legal_text ?? ''),
        },
        catalog: catalog(),
      }),
    insertProposal: async (row) => {
      inserts.push(row);
      return { id: PROPOSAL_ID, revision_no: 1 };
    },
    loadKindCatalog: async () => [{ id: KIND_ID, label: 'פסקה' }],
    writeAudit: async () => undefined,
  });

  await assert.rejects(
    () => generate(ctx, { legal_text_draft_id: DRAFT_ID }),
    (error: unknown) => error instanceof AppError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_INVALID',
  );
  assert.equal(inserts.length, 0);
});
