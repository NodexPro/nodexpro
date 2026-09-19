import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { createGenerateTaxKnowledgeProposal } from '../../src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.js';
import { validateTaxKnowledgeProposalV1 } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type { RequestContext } from '../../src/shared/context.js';
import type { GenerateDraftRow } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';

const DRAFT = 'סעיף 1. תושב ישראל נשוי זכאי.';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const VALUE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVENTED_ID = 'abababab-abab-4bab-8bab-abababababab';

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

function draftRow(): GenerateDraftRow {
  return {
    id: DRAFT_ID,
    country_code: 'IL',
    document_id: DOC_ID,
    tax_source_id: SOURCE_ID,
    structure_run_id: null,
    parent_draft_id: null,
    review_status: 'ready',
    kind_label: 'סעיף',
    title: 'סעיף 1',
    source_display_identifier: '1',
    normalized_machine_identifier: '1',
    printed_marker: null,
    draft_legal_text: DRAFT,
  };
}

function hebrewJson(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'node_3א_ב',
        source_display_identifier: '1',
        title: 'סעיף 1',
        parent: { kind: 'existing', key: null, tax_legal_node_id: INVENTED_ID },
      },
    ],
    rules: [
      {
        proposal_rule_key: 'rule_3א_ב_deemed_israel_source_income',
        title: 'Married resident',
        rule_kind: 'legal_rule',
        statement: 'A married Israeli resident is eligible.',
        applicability_status: 'determined',
        applies_if: { fact: 'marital_status', op: 'eq', type: 'enum', value: 'married' },
        does_not_apply_if: null,
        notes: null,
        effective_from: '2024-01-01',
        effective_to: null,
        legal_node_keys: ['node_3א_ב'],
        existing_tax_legal_node_ids: [],
        legal_value_keys: ['credit_point_value'],
        calculation_keys: [],
      },
    ],
    relationships: [],
    calculations: [],
    facts: [{ fact_key: 'marital_status', role: 'applicability_condition' }],
    legal_values: [{ value_key: 'credit_point_value' }],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [{ role: 'verbatim_from_draft', text: DRAFT, start: 99, end: 100 }],
      citations: [{ tax_source_id: SOURCE_ID, locator: 'סעיף 1' }],
    },
    uncertainties: [],
    ...overrides,
  };
}

function sampleContext(draft: GenerateDraftRow) {
  return {
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
        kind_label: 'סעיף',
        title: 'parent',
        source_display_identifier: '3א',
        normalized_machine_identifier: '3א',
        draft_legal_text: '',
      },
    ],
    existing_legal_nodes: [],
    canonical_allowlist: { tax_legal_node_ids: [], tax_source_ids: [draft.tax_source_id] },
    tax_fact_definitions: [{ fact_key: 'marital_status', country_code: 'IL', value_type: 'enum', enum_codes: ['married'] }],
    country_legal_value_keys: [{ value_key: 'credit_point_value' }],
    relationship_vocabulary: ['depends_on'],
    k3_predicate_contract: { ops: ['eq'] },
    k4_calculation_hook_contract: { expression_must_be_null: true },
    output_contract_keys: ['schema_version'],
    extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
    bounds: { matched_legal_nodes: 0, fact_definitions: 1, legal_value_keys: 1, ancestors: 1 },
  };
}

async function runGenerate(json: Record<string, unknown>) {
  const inserts: Record<string, unknown>[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    persistOwnerPresentations: async () => null,
    loadDraft: async () => draftRow(),
    loadContext: async (draft) => sampleContext(draft),
    completeStructuredJson: async () => ({
      json,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      latency_ms: 11,
      outcome: 'success',
      telemetry: {
        purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
        correlation_id: null,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        provider_id: null,
        routing_position: null,
        routing_source: 'env',
        prompt_contract_version: 'tax_knowledge_proposal_extract_v1',
        output_contract: 'tax_knowledge_proposal_v1',
        output_schema_version: 1,
        latency_ms: 11,
        outcome: 'success',
        attempt_count: 1,
        providers_attempted: 1,
        failover_occurred: false,
        failure_category: null,
        circuit_state: null,
        untrusted_source_text: true,
      },
    }),
    validateProposal: async (proposalJson, draft) =>
      validateTaxKnowledgeProposalV1({
        proposal_json: proposalJson,
        context: {
          country_code: draft.country_code,
          tax_source_id: draft.tax_source_id,
          legal_text_draft_id: draft.id,
          draft_legal_text: String(draft.draft_legal_text ?? ''),
        },
        catalog: {
          legal_nodes: [],
          legal_node_kinds: [],
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
        },
      }),
    insertProposal: async (row) => {
      inserts.push(row);
      return { id: PROPOSAL_ID, revision_no: 1 };
    },
    writeAudit: async () => undefined,
  });
  let error: unknown = null;
  let result = null;
  try {
    result = await generate(ctx, { legal_text_draft_id: DRAFT_ID });
  } catch (caught) {
    error = caught;
  }
  return { result, error, inserts };
}

test('TAX-642I generate stores normalized keys after TAX-639 success and does not write B2 on invalid meaning', async () => {
  const ok = await runGenerate(hebrewJson());
  assert.equal(ok.error, null, JSON.stringify((ok.error as AppError | null)?.details ?? ok.error));
  assert.equal(ok.inserts.length, 1);
  const stored = ok.inserts[0]?.proposal_json as Record<string, unknown>;
  const node = (stored.legal_nodes as Array<Record<string, unknown>>)[0];
  const rule = (stored.rules as Array<Record<string, unknown>>)[0];
  const quote = ((stored.evidence as Record<string, unknown>).quotes as Array<Record<string, unknown>>)[0];
  assert.equal(node.proposal_node_key, 'node_1');
  assert.equal(node.parent, null);
  assert.equal(rule.proposal_rule_key, 'rule_1');
  assert.deepEqual(rule.legal_node_keys, ['node_1']);
  assert.equal(quote.start, 0);
  assert.equal(quote.end, DRAFT.length);
  assert.equal(ok.result?.proposal_id, PROPOSAL_ID);

  const invalid = await runGenerate(hebrewJson({ extra: true }));
  assert.ok(invalid.error instanceof AppError);
  assert.equal(invalid.error.code, 'TAX_KNOWLEDGE_PROPOSAL_INVALID');
  assert.equal(invalid.inserts.length, 0);
});
