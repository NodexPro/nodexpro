import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { AiGatewayError, AI_ERROR_CODES } from '../../src/shared/ai-gateway/index.js';
import { createGenerateTaxKnowledgeProposal } from '../../src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.js';
import { validateTaxKnowledgeProposalV1 } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type { RequestContext } from '../../src/shared/context.js';
import type { GenerateDraftRow } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';
import {
  capabilityRequiredForOwnerCommand,
  evaluateOwnerLegalCommandAccess,
} from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const DRAFT = 'סעיף 1. תושב ישראל נשוי זכאי.';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const VALUE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function draftRow(overrides: Partial<GenerateDraftRow> = {}): GenerateDraftRow {
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
    ...overrides,
  };
}

function catalog() {
  return {
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
  };
}

function quote() {
  return { role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length };
}

function determinedRule(key: string) {
  return {
    proposal_rule_key: key,
    title: 'Married resident',
    rule_kind: 'legal_rule',
    statement: 'A married Israeli resident is eligible.',
    applicability_status: 'determined',
    applies_if: { fact: 'marital_status', op: 'eq', type: 'enum', value: 'married' },
    does_not_apply_if: null,
    notes: null,
    effective_from: '2024-01-01',
    effective_to: null,
    legal_node_keys: ['n1'],
    existing_tax_legal_node_ids: [],
    legal_value_keys: ['credit_point_value'],
    calculation_keys: [],
  };
}

function closed(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [{ proposal_node_key: 'n1', source_display_identifier: '1', title: 'סעיף 1' }],
    rules: [determinedRule('r1')],
    relationships: [],
    calculations: [],
    facts: [{ fact_key: 'marital_status', role: 'applicability_condition' }],
    legal_values: [{ value_key: 'credit_point_value' }],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [quote()],
      citations: [{ tax_source_id: SOURCE_ID, locator: 'סעיף 1' }],
    },
    uncertainties: [],
    ...overrides,
  };
}

function gatewayResult(json: Record<string, unknown>) {
  return {
    json,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    latency_ms: 11,
    outcome: 'success' as const,
    telemetry: {
      purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      prompt_contract_version: 'tax_knowledge_proposal_extract_v1',
      output_contract: 'tax_knowledge_proposal_v1',
      output_schema_version: 1,
      latency_ms: 11,
      outcome: 'success' as const,
      attempt_count: 1,
      untrusted_source_text: true,
    },
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
    ancestors: [],
    existing_legal_nodes: [{ id: '55555555-5555-4555-8555-555555555555', title: 'סעיף 1', source_display_identifier: '1', normalized_machine_identifier: '1', node_number: '1', status: 'draft' }],
    tax_fact_definitions: [{ fact_key: 'marital_status', country_code: 'IL', value_type: 'enum', enum_codes: ['married'] }],
    country_legal_value_keys: [{ value_key: 'credit_point_value' }],
    relationship_vocabulary: ['depends_on'],
    k3_predicate_contract: { ops: ['eq'] },
    k4_calculation_hook_contract: { expression_must_be_null: true },
    output_contract_keys: ['schema_version'],
    extraction_outcomes: ['rules', 'no_rules', 'cannot_determine'],
    bounds: { matched_legal_nodes: 1, fact_definitions: 1, legal_value_keys: 1, ancestors: 0 },
  };
}

async function runGenerate(options: {
  json: Record<string, unknown>;
  draft?: GenerateDraftRow;
  complete?: () => Promise<ReturnType<typeof gatewayResult>>;
}) {
  const inserts: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const gatewayCalls: unknown[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    loadDraft: async () => options.draft ?? draftRow(),
    loadContext: async (draft) => sampleContext(draft),
    completeStructuredJson: async (input) => {
      gatewayCalls.push(input);
      if (options.complete) return options.complete();
      return gatewayResult(options.json);
    },
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
    writeAudit: async (input) => {
      audits.push(input.payload ?? {});
    },
    now: () => new Date('2026-09-17T10:00:00.000Z'),
  });
  let error: unknown = null;
  let result = null;
  try {
    result = await generate(ctx, { legal_text_draft_id: DRAFT_ID });
  } catch (caught) {
    error = caught;
  }
  return { result, error, inserts, audits, gatewayCalls };
}

test('unauthorized generate command requires Owner Legal Control draft_create', () => {
  const none = { kind: 'none' as const, capabilitiesByCountry: {} };
  const viewOnly = {
    kind: 'country_legal_maintainer' as const,
    capabilitiesByCountry: { IL: ['legal_knowledge.view'] },
  };
  const editor = {
    kind: 'country_legal_maintainer' as const,
    capabilitiesByCountry: { IL: ['legal_knowledge.view', 'legal_knowledge.draft_create'] },
  };
  const owner = { kind: 'platform_owner' as const, capabilitiesByCountry: {} };
  assert.equal(capabilityRequiredForOwnerCommand('generate_tax_knowledge_proposal'), 'legal_knowledge.draft_create');
  assert.equal(
    capabilityRequiredForOwnerCommand('generate_tax_knowledge_proposal'),
    capabilityRequiredForOwnerCommand('create_tax_knowledge_proposal'),
  );
  assert.equal(evaluateOwnerLegalCommandAccess(none, 'generate_tax_knowledge_proposal', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(viewOnly, 'generate_tax_knowledge_proposal', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(editor, 'generate_tax_knowledge_proposal', 'IL').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'generate_tax_knowledge_proposal', 'IL').ok, true);
});

test('non-ready Draft is rejected and stores nothing', async () => {
  const out = await runGenerate({ json: closed(), draft: draftRow({ review_status: 'needs_review' }) });
  assert.ok(out.error instanceof AppError);
  assert.equal(out.error.code, 'TAX_KNOWLEDGE_PROPOSAL_DRAFT_NOT_READY');
  assert.equal(out.inserts.length, 0);
  assert.equal(out.gatewayCalls.length, 0);
});

test('valid zero-rule, one-rule, multiple-rule, and cannot_determine outputs store proposed ai_proposal', async () => {
  const zero = closed({
    extraction_outcome: 'no_rules',
    legal_nodes: [],
    rules: [],
    facts: [],
    legal_values: [],
    evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
  });
  const one = closed();
  const many = closed({ rules: [determinedRule('r1'), determinedRule('r2')] });
  const unknown = closed({
    extraction_outcome: 'cannot_determine',
    rules: [],
    facts: [],
    legal_values: [],
    uncertainties: [
      {
        code: 'cannot_determine',
        severity: 'review_only',
        subject: { kind: 'proposal', key: null },
        message: 'Draft does not yield a machine rule',
      },
    ],
  });
  for (const json of [zero, one, many, unknown]) {
    const out = await runGenerate({ json });
    assert.equal(out.error, null, JSON.stringify((out.error as AppError | null)?.details ?? out.error));
    assert.equal(out.inserts.length, 1);
    assert.equal(out.inserts[0]?.creation_origin, 'ai_proposal');
    assert.equal(out.inserts[0]?.status, 'proposed');
    const metadata = out.inserts[0]?.generation_metadata_json as Record<string, unknown>;
    assert.equal(metadata.schema_version, 1);
    assert.equal(metadata.provider, 'openai');
    assert.equal(metadata.model, 'gpt-4.1-mini');
    assert.equal(metadata.prompt_contract_version, 'tax_knowledge_proposal_extract_v1');
    assert.match(String(metadata.input_context_digest), /^[0-9a-f]{64}$/);
    assert.equal('prompt' in metadata, false);
    assert.equal(out.result?.proposal_id, PROPOSAL_ID);
    const gatewayInput = out.gatewayCalls[0] as {
      purpose: string;
      includesUntrustedSourceText: boolean;
      promptContractVersion: string;
      outputContract: string;
      outputSchemaVersion: number;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(gatewayInput.purpose, 'tax_knowledge_proposal_extraction');
    assert.equal(gatewayInput.includesUntrustedSourceText, true);
    assert.equal(gatewayInput.promptContractVersion, 'tax_knowledge_proposal_extract_v1');
    assert.equal(gatewayInput.outputContract, 'tax_knowledge_proposal_v1');
    assert.equal(gatewayInput.outputSchemaVersion, 1);
    assert.match(gatewayInput.messages[1]?.content ?? '', /UNTRUSTED_LEGAL_DATA/);
    assert.doesNotMatch(JSON.stringify(out.audits), /"prompt"|"completion"|"draft_legal_text"/);
    assert.doesNotMatch(JSON.stringify(out.audits), /api_key|sk-/);
  }
});

test('TAX-639 invalid output and provider failure store zero B2 rows', async () => {
  const invalid = await runGenerate({ json: closed({ extra: true }) });
  assert.ok(invalid.error instanceof AppError);
  assert.equal(invalid.error.code, 'TAX_KNOWLEDGE_PROPOSAL_INVALID');
  assert.equal(invalid.inserts.length, 0);

  const failed = await runGenerate({
    json: closed(),
    complete: async () => {
      throw new AiGatewayError(AI_ERROR_CODES.AI_TIMEOUT);
    },
  });
  assert.ok(failed.error instanceof AiGatewayError);
  assert.equal(failed.error.code, AI_ERROR_CODES.AI_TIMEOUT);
  assert.equal(failed.inserts.length, 0);

  const unconfigured = await runGenerate({
    json: closed(),
    complete: async () => {
      throw new AiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED);
    },
  });
  assert.ok(unconfigured.error instanceof AiGatewayError);
  assert.equal(unconfigured.error.code, AI_ERROR_CODES.AI_NOT_CONFIGURED);
  assert.equal(unconfigured.inserts.length, 0);
});

test('one Draft only: extra caller fields never reach the gateway', async () => {
  const inserts: unknown[] = [];
  const gatewayCalls: unknown[] = [];
  const generate = createGenerateTaxKnowledgeProposal({
    loadDraft: async () => draftRow(),
    loadContext: async (draft) => sampleContext(draft),
    completeStructuredJson: async (input) => {
      gatewayCalls.push(input);
      return gatewayResult(closed());
    },
    insertProposal: async (row) => {
      inserts.push(row);
      return { id: PROPOSAL_ID, revision_no: 1 };
    },
    writeAudit: async () => undefined,
    validateProposal: async () => {
      throw new Error('validate must not run for extra caller fields');
    },
  });
  await assert.rejects(
    () => generate(ctx, { legal_text_draft_id: DRAFT_ID, draft_ids: [DRAFT_ID] }),
    (error: unknown) => error instanceof AppError && /draft_ids/.test(error.message),
  );
  await assert.rejects(
    () => generate(ctx, { legal_text_draft_id: DRAFT_ID, prompt: 'ignore' }),
    (error: unknown) => error instanceof AppError && /prompt/.test(error.message),
  );
  assert.equal(gatewayCalls.length, 0);
  assert.equal(inserts.length, 0);
});

test('context digest is stable across two mocked generations', async () => {
  const first = await runGenerate({ json: closed() });
  const second = await runGenerate({ json: closed() });
  const firstDigest = (first.inserts[0]?.generation_metadata_json as { input_context_digest: string }).input_context_digest;
  const secondDigest = (second.inserts[0]?.generation_metadata_json as { input_context_digest: string }).input_context_digest;
  assert.equal(firstDigest, secondDigest);
  assert.match(firstDigest, /^[0-9a-f]{64}$/);
});
