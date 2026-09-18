import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAX_KNOWLEDGE_PROPOSAL_CANNOT_DETERMINE_MESSAGE,
  UNBOUND_VERBATIM_SPAN,
  bindVerbatimEvidenceSpan,
  findExactTextOccurrences,
  normalizeTaxKnowledgeProposalExtract,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-normalize.pure.js';
import {
  buildCanonicalAllowlist,
  legalNodeMatchQueriesForExtraction,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';
import {
  emptyTaxKnowledgeProposalValidationCatalog,
  validateTaxKnowledgeProposalV1,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type {
  TaxKnowledgeProposalValidationCatalog,
  TaxKnowledgeProposalValidationContext,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';

const DRAFT = 'סעיף 1. תושב ישראל נשוי זכאי.';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const VALUE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const NODE_ID = '55555555-5555-4555-8555-555555555555';
const ANCESTOR_NODE_ID = '56565656-5656-4565-8565-565656565656';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const INVENTED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function catalog(): TaxKnowledgeProposalValidationCatalog {
  return {
    legal_nodes: [
      { id: NODE_ID, country_code: 'IL', tax_source_id: SOURCE_ID },
      { id: ANCESTOR_NODE_ID, country_code: 'IL', tax_source_id: SOURCE_ID },
    ],
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

function context(): TaxKnowledgeProposalValidationContext {
  return {
    country_code: 'IL',
    tax_source_id: SOURCE_ID,
    legal_text_draft_id: DRAFT_ID,
    draft_legal_text: DRAFT,
  };
}

function allowlist(ids: string[] = []) {
  return { tax_legal_node_ids: ids, tax_source_ids: [SOURCE_ID] };
}

function determinedHebrewProposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'node_3א_ב',
        source_display_identifier: '1',
        title: 'סעיף 1',
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
        existing_tax_legal_node_ids: [INVENTED_ID],
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
      quotes: [{ role: 'verbatim_from_draft', text: DRAFT, start: 12, end: 13 }],
      citations: [{ tax_source_id: SOURCE_ID, locator: 'סעיף 1' }],
    },
    uncertainties: [],
    ...overrides,
  };
}

function normalize(raw: unknown, ids: string[] = []) {
  return normalizeTaxKnowledgeProposalExtract(raw, {
    draftLegalText: DRAFT,
    allowlist: allowlist(ids),
  });
}

function run639(proposal: unknown) {
  return validateTaxKnowledgeProposalV1({
    proposal_json: proposal,
    context: context(),
    catalog: catalog(),
  });
}

test('TAX-642I Hebrew and invalid AI local keys become node_1/rule_1/calc_1', () => {
  const out = normalize(
    determinedHebrewProposal({
      rules: [
        {
          ...(determinedHebrewProposal().rules as Array<Record<string, unknown>>)[0],
          calculation_keys: ['calc_3א'],
        },
      ],
      calculations: [
        {
          proposal_calc_key: 'calc_3א',
          required: false,
          title: 'Hook',
          pin_rule_keys: ['rule_3א_ב_deemed_israel_source_income'],
          input_fact_keys: [],
          legal_value_keys: [],
          output_type: 'money',
          expression: null,
        },
      ],
    }),
  ) as Record<string, unknown>;
  const nodes = out.legal_nodes as Array<Record<string, unknown>>;
  const rules = out.rules as Array<Record<string, unknown>>;
  const calcs = out.calculations as Array<Record<string, unknown>>;
  assert.equal(nodes[0]?.proposal_node_key, 'node_1');
  assert.equal(rules[0]?.proposal_rule_key, 'rule_1');
  assert.equal(calcs[0]?.proposal_calc_key, 'calc_1');
  assert.deepEqual(rules[0]?.legal_node_keys, ['node_1']);
  assert.deepEqual(rules[0]?.calculation_keys, ['calc_1']);
  assert.deepEqual(calcs[0]?.pin_rule_keys, ['rule_1']);
});

test('TAX-642I remaps relationship and uncertainty local-key references', () => {
  const raw = determinedHebrewProposal({
    rules: [
      {
        ...(determinedHebrewProposal().rules as Array<Record<string, unknown>>)[0],
        proposal_rule_key: 'rule_3א_ב_deemed_israel_source_income',
      },
      {
        ...(determinedHebrewProposal().rules as Array<Record<string, unknown>>)[0],
        proposal_rule_key: 'rule_other',
        title: 'Related',
        legal_node_keys: ['node_3א_ב'],
        calculation_keys: [],
      },
    ],
    relationships: [
      {
        from: { kind: 'proposal_rule', key: 'rule_other', tax_rule_version_id: null },
        to: { kind: 'proposal_rule', key: 'rule_3א_ב_deemed_israel_source_income', tax_rule_version_id: INVENTED_ID },
        relationship_type: 'depends_on',
      },
    ],
    uncertainties: [
      {
        code: 'missing_fact_definition',
        severity: 'blocks_activation_only',
        subject: { kind: 'rule', key: 'rule_3א_ב_deemed_israel_source_income' },
        message: 'Fact missing',
        detail: null,
      },
    ],
  });
  const out = normalize(raw) as Record<string, unknown>;
  const rel = (out.relationships as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  const from = rel.from as Record<string, unknown>;
  const to = rel.to as Record<string, unknown>;
  assert.equal(from.key, 'rule_2');
  assert.equal(to.key, 'rule_1');
  assert.equal(to.tax_rule_version_id, null);
  const uncertainty = (out.uncertainties as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  assert.equal(uncertainty.code, 'missing_fact_definition');
  assert.equal((uncertainty.subject as Record<string, unknown>).key, 'rule_1');
});

test('TAX-642I invented canonical UUID cannot survive normalization', () => {
  const raw = determinedHebrewProposal({
    legal_nodes: [
      {
        proposal_node_key: 'node_3א_ב',
        source_display_identifier: '1',
        title: 'סעיף 1',
        existing_tax_legal_node_id: INVENTED_ID,
        parent: { kind: 'existing', key: null, tax_legal_node_id: INVENTED_ID },
      },
    ],
  });
  const out = normalize(raw, [NODE_ID]) as Record<string, unknown>;
  const node = (out.legal_nodes as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  assert.equal(node.existing_tax_legal_node_id, null);
  assert.equal(node.parent, null);
  const rule = (out.rules as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  assert.deepEqual(rule.existing_tax_legal_node_ids, []);
});

test('TAX-642I allowlisted canonical UUID survives; invented parent falls back to proposal_node', () => {
  const raw = determinedHebrewProposal({
    legal_nodes: [
      {
        proposal_node_key: 'parent_3א',
        source_display_identifier: '3א',
        title: 'parent',
        existing_tax_legal_node_id: ANCESTOR_NODE_ID,
      },
      {
        proposal_node_key: 'node_3א_ב',
        source_display_identifier: '1',
        title: 'סעיף 1',
        existing_tax_legal_node_id: NODE_ID,
        parent: { kind: 'existing', key: 'parent_3א', tax_legal_node_id: INVENTED_ID },
      },
    ],
  });
  const out = normalize(raw, [NODE_ID, ANCESTOR_NODE_ID]) as Record<string, unknown>;
  const nodes = out.legal_nodes as Array<Record<string, unknown>>;
  assert.equal(nodes[0]?.proposal_node_key, 'node_1');
  assert.equal(nodes[0]?.existing_tax_legal_node_id, ANCESTOR_NODE_ID);
  assert.equal(nodes[1]?.existing_tax_legal_node_id, NODE_ID);
  assert.deepEqual(nodes[1]?.parent, { kind: 'proposal_node', key: 'node_1', tax_legal_node_id: null });
});

test('TAX-642I allowlisted existing parent UUID is retained', () => {
  const raw = determinedHebrewProposal({
    legal_nodes: [
      {
        proposal_node_key: 'node_3א_ב',
        source_display_identifier: '1',
        title: 'סעיף 1',
        parent: { kind: 'existing', key: null, tax_legal_node_id: ANCESTOR_NODE_ID },
      },
    ],
  });
  const out = normalize(raw, [ANCESTOR_NODE_ID]) as Record<string, unknown>;
  const node = (out.legal_nodes as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  assert.deepEqual(node.parent, { kind: 'existing', key: null, tax_legal_node_id: ANCESTOR_NODE_ID });
});

test('TAX-642I ancestor identifiers are included in controlled-context match queries', () => {
  const queries = legalNodeMatchQueriesForExtraction(
    { normalized_machine_identifier: '3א(ב)', source_display_identifier: '3א(ב)' },
    [{ normalized_machine_identifier: '3א', source_display_identifier: '3א' }],
  );
  assert.deepEqual(
    queries.map((row) => ({ from: row.matched_from, id: row.normalized_machine_identifier })),
    [
      { from: 'draft', id: '3א(ב)' },
      { from: 'ancestor', id: '3א' },
    ],
  );
  const listed = buildCanonicalAllowlist({
    existing_legal_nodes: [{ id: NODE_ID }, { id: ANCESTOR_NODE_ID }, { id: NODE_ID }],
    tax_source_id: SOURCE_ID,
  });
  assert.deepEqual(listed.tax_legal_node_ids, [NODE_ID, ANCESTOR_NODE_ID]);
  assert.deepEqual(listed.tax_source_ids, [SOURCE_ID]);
});

test('TAX-642I exact unique quote binds JS slice offsets; wrong AI offsets are ignored', () => {
  const bound = bindVerbatimEvidenceSpan(DRAFT, DRAFT);
  assert.deepEqual(bound, { start: 0, end: DRAFT.length });
  assert.equal(DRAFT.slice(bound?.start ?? -1, bound?.end ?? -1), DRAFT);
  const out = normalize(determinedHebrewProposal()) as Record<string, unknown>;
  const quote = ((out.evidence as Record<string, unknown>).quotes as Array<Record<string, unknown>>)[0];
  assert.equal(quote.start, 0);
  assert.equal(quote.end, DRAFT.length);
  assert.notEqual(quote.start, 12);
});

test('TAX-642I repeated or missing quote cannot create fake provenance', () => {
  const repeated = 'abcabc';
  assert.deepEqual(findExactTextOccurrences(repeated, 'abc'), [0, 3]);
  assert.equal(bindVerbatimEvidenceSpan(repeated, 'abc'), null);
  const missing = normalizeTaxKnowledgeProposalExtract(
    determinedHebrewProposal({
      evidence: {
        source_role: 'reviewed_owner_draft',
        quotes: [{ role: 'verbatim_from_draft', text: 'not in draft', start: 0, end: 4 }],
        citations: [{ tax_source_id: SOURCE_ID, locator: 'סעיף 1' }],
      },
    }),
    { draftLegalText: DRAFT, allowlist: allowlist() },
  ) as Record<string, unknown>;
  const quote = ((missing.evidence as Record<string, unknown>).quotes as Array<Record<string, unknown>>)[0];
  assert.equal(quote.start, UNBOUND_VERBATIM_SPAN.start);
  assert.equal(quote.end, UNBOUND_VERBATIM_SPAN.end);
  const rejected = run639(missing);
  assert.equal(rejected.valid_schema, false);
  assert.ok(rejected.errors.some((row) => row.code === 'fake_evidence_span'));
});

test('TAX-642I cannot_determine gets blocking uncertainty; genuine extra uncertainty is kept', () => {
  const raw = determinedHebrewProposal({
    rules: [
      {
        proposal_rule_key: 'rule_3א_ב_deemed_israel_source_income',
        title: 'Unknown applicability',
        rule_kind: 'legal_rule',
        statement: null,
        applicability_status: 'cannot_determine',
        applies_if: null,
        does_not_apply_if: null,
        notes: null,
        effective_from: null,
        effective_to: null,
        legal_node_keys: ['node_3א_ב'],
        existing_tax_legal_node_ids: [],
        legal_value_keys: [],
        calculation_keys: [],
      },
    ],
    calculations: [],
    relationships: [],
    facts: [],
    legal_values: [],
    uncertainties: [
      {
        code: 'missing_fact_definition',
        severity: 'blocks_activation_only',
        subject: { kind: 'rule', key: 'rule_3א_ב_deemed_israel_source_income' },
        message: 'Fact missing',
        detail: null,
      },
    ],
  });
  const out = normalize(raw) as Record<string, unknown>;
  const rows = out.uncertainties as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.code, 'missing_fact_definition');
  assert.equal((rows[0]?.subject as Record<string, unknown>).key, 'rule_1');
  assert.equal(rows[1]?.code, 'cannot_determine');
  assert.equal(rows[1]?.severity, 'blocks_rule_publication');
  assert.deepEqual(rows[1]?.subject, { kind: 'rule', key: 'rule_1' });
  assert.equal(rows[1]?.message, TAX_KNOWLEDGE_PROPOSAL_CANNOT_DETERMINE_MESSAGE);
});

test('TAX-642I normalized valid proposal passes TAX-639; malformed legal meaning still fails', () => {
  const valid = run639(normalize(determinedHebrewProposal()));
  assert.equal(valid.valid_schema, true, JSON.stringify(valid.errors));
  const malformed = normalize({ ...determinedHebrewProposal(), extra: true });
  const failed = run639(malformed);
  assert.equal(failed.valid_schema, false);
  assert.ok(failed.errors.some((row) => row.code === 'unknown_field'));
  const emptyCatalog = validateTaxKnowledgeProposalV1({
    proposal_json: normalize(
      determinedHebrewProposal({
        extraction_outcome: 'no_rules',
        legal_nodes: [],
        rules: [],
        relationships: [],
        calculations: [],
        facts: [],
        legal_values: [],
        evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
      }),
    ),
    context: context(),
    catalog: emptyTaxKnowledgeProposalValidationCatalog(),
  });
  assert.equal(emptyCatalog.valid_schema, true);
});
