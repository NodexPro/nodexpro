import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOwnerApproveTaxKnowledgeProposal,
  emptyTaxKnowledgeProposalValidationCatalog,
  validateTaxKnowledgeProposalV1,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type {
  TaxKnowledgeProposalValidationCatalog,
  TaxKnowledgeProposalValidationContext,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';

const DRAFT = 'סעיף 1. תושב ישראל נשוי זכאי.';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const DOB_ID = '12121212-1212-4121-8121-121212121212';
const VALUE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const NODE_ID = '55555555-5555-4555-8555-555555555555';
const RULE_ID = '66666666-6666-4666-8666-666666666666';
const US_VERSION_ID = '77777777-7777-4777-8777-777777777777';
const US_SOURCE_ID = '88888888-8888-4888-8888-888888888888';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const MISSING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function catalog(): TaxKnowledgeProposalValidationCatalog {
  return {
    legal_nodes: [{ id: NODE_ID, country_code: 'IL', tax_source_id: SOURCE_ID }],
    legal_node_kinds: [],
    tax_rules: [{ id: RULE_ID, country_code: 'IL' }],
    tax_rule_versions: [
      { id: VERSION_ID, country_code: 'IL', tax_rule_id: RULE_ID },
      { id: US_VERSION_ID, country_code: 'US', tax_rule_id: RULE_ID },
    ],
    tax_sources: [
      { id: SOURCE_ID, country_code: 'IL' },
      { id: US_SOURCE_ID, country_code: 'US' },
    ],
    facts: [
      {
        id: FACT_ID,
        fact_key: 'marital_status',
        country_code: 'IL',
        status: 'active',
        value_type: 'enum',
        enum_codes: ['single', 'married'],
      },
      {
        id: DOB_ID,
        fact_key: 'date_of_birth',
        country_code: null,
        status: 'active',
        value_type: 'date',
        enum_codes: [],
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

function quote() {
  return { role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length };
}

function determinedRule(key = 'r1', extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
}

function closed(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'n1',
        source_display_identifier: '1',
        title: 'סעיף 1',
      },
    ],
    rules: [determinedRule()],
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

function run(proposal: unknown, cat = catalog(), ctx = context()) {
  return validateTaxKnowledgeProposalV1({ proposal_json: proposal, context: ctx, catalog: cat });
}

function errorCodes(result: ReturnType<typeof run>): string[] {
  return result.errors.map((row) => row.code);
}

test('TAX-639 closed contract rejects unknown top-level fields', () => {
  const result = run({ ...closed(), extra: true });
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('unknown_field'));
});

test('TAX-639 zero rules is a valid no_rules extraction', () => {
  const result = run(
    closed({
      extraction_outcome: 'no_rules',
      legal_nodes: [],
      rules: [],
      facts: [],
      legal_values: [],
      evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
    }),
  );
  assert.equal(result.valid_schema, true);
  assert.equal(result.publication_eligible, false);
  assert.equal(result.owner_approval_allowed, true);
});

test('TAX-639 cannot_determine extraction requires zero rules and cannot_determine uncertainty', () => {
  const missing = run(closed({ extraction_outcome: 'cannot_determine', rules: [] }));
  assert.equal(missing.valid_schema, false);
  const ok = run(
    closed({
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
    }),
  );
  assert.equal(ok.valid_schema, true);
  assert.equal(ok.publication_eligible, false);
});

test('TAX-639 one valid determined rule with K3 predicate is publication eligible', () => {
  const result = run(closed());
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, true);
  assert.equal(result.owner_approval_allowed, true);
  assert.equal(result.resolved_fact_bindings[0]?.dictionary_status, 'bound_existing');
  assert.equal(result.resolved_legal_values[0]?.value_key, 'credit_point_value');
  assert.equal(result.evidence_validation.authoritative_evidence, true);
});

test('TAX-639 multiple local rules may be related to each other', () => {
  const result = run(
    closed({
      rules: [
        determinedRule('r1'),
        determinedRule('r2', {
          title: 'Exception',
          statement: 'Exception for a special case.',
          applies_if: { fact: 'date_of_birth', op: 'gte', type: 'date', value: '2000-01-01' },
        }),
      ],
      facts: [
        { fact_key: 'marital_status', role: 'applicability_condition' },
        { fact_key: 'date_of_birth', role: 'applicability_condition' },
      ],
      relationships: [
        {
          from: { kind: 'proposal_rule', key: 'r2' },
          to: { kind: 'proposal_rule', key: 'r1' },
          relationship_type: 'exception_to',
        },
      ],
    }),
  );
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, true);
});

test('TAX-639 invalid K3 predicate is rejected', () => {
  const result = run(closed({ rules: [determinedRule('r1', { applies_if: { fact: 'marital_status', op: 'bogus', value: 'married' } })] }));
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('invalid_predicate'));
});

test('TAX-639 unconstrained requires null applies_if; cannot_determine requires blocking uncertainty', () => {
  const unconstrained = run(
    closed({
      rules: [determinedRule('r1', { applicability_status: 'unconstrained', applies_if: null })],
    }),
  );
  assert.equal(unconstrained.valid_schema, true, JSON.stringify(unconstrained.errors));
  assert.ok(unconstrained.warnings.some((row) => row.code === 'unconstrained_requires_owner_review'));

  const cannot = run(
    closed({
      rules: [determinedRule('r1', { applicability_status: 'cannot_determine', applies_if: null, statement: null, effective_from: null })],
    }),
  );
  assert.equal(cannot.valid_schema, false);
  const cannotOk = run(
    closed({
      rules: [determinedRule('r1', { applicability_status: 'cannot_determine', applies_if: null, does_not_apply_if: null, statement: null, effective_from: null })],
      uncertainties: [
        {
          code: 'cannot_determine',
          severity: 'blocks_rule_publication',
          subject: { kind: 'rule', key: 'r1' },
          message: 'Cannot determine applicability',
        },
      ],
    }),
  );
  assert.equal(cannotOk.valid_schema, true, JSON.stringify(cannotOk.errors));
  assert.equal(cannotOk.publication_eligible, false);
  assert.equal(canOwnerApproveTaxKnowledgeProposal(cannotOk), true);
});

test('TAX-639 unknown fact key must not enter a predicate', () => {
  const result = run(
    closed({
      rules: [determinedRule('r1', { applies_if: { fact: 'unknown_widget', op: 'eq', value: true } })],
      facts: [{ fact_key: 'unknown_widget', role: 'applicability_condition' }],
    }),
  );
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('unknown_fact_key') || errorCodes(result).includes('undeclared_fact'));
});

test('TAX-639 missing fact definition may be declared with blocking uncertainty and not used in K3', () => {
  const result = run(
    closed({
      facts: [
        { fact_key: 'marital_status', role: 'applicability_condition' },
        { fact_key: 'unknown_widget', role: 'required_missing' },
      ],
      uncertainties: [
        {
          code: 'missing_fact_definition',
          severity: 'blocks_rule_publication',
          subject: { kind: 'fact', key: 'unknown_widget' },
          message: 'No dictionary identity yet',
        },
      ],
    }),
  );
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.owner_approval_allowed, true);
  assert.equal(result.publication_eligible, false);
  assert.equal(result.resolved_fact_bindings.find((row) => row.fact_key === 'unknown_widget')?.dictionary_status, 'missing_definition');
});

test('TAX-639 incompatible fact type is rejected', () => {
  const result = run(
    closed({
      rules: [determinedRule('r1', { applies_if: { fact: 'date_of_birth', op: 'eq', type: 'number', value: 18 } })],
      facts: [{ fact_key: 'date_of_birth', role: 'applicability_condition' }],
    }),
  );
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('incompatible_fact_type'));
});

test('TAX-639 unresolved relationship is valid; invalid endpoint is not', () => {
  const unresolved = run(
    closed({
      relationships: [
        {
          from: { kind: 'proposal_rule', key: 'r1' },
          to: { kind: 'unresolved' },
          relationship_type: 'depends_on',
          unresolved: {
            cited_instrument_kind: 'section',
            locator_text: 'סעיף 2',
          },
        },
      ],
      uncertainties: [
        {
          code: 'unresolved_reference',
          severity: 'blocks_activation_only',
          subject: { kind: 'relationship', key: 'r1' },
          message: 'Target provision is not loaded',
        },
      ],
    }),
  );
  assert.equal(unresolved.valid_schema, true, JSON.stringify(unresolved.errors));
  assert.equal(unresolved.owner_approval_allowed, true);

  const invalid = run(
    closed({
      relationships: [
        {
          from: { kind: 'proposal_rule', key: 'missing' },
          to: { kind: 'proposal_rule', key: 'r1' },
          relationship_type: 'depends_on',
        },
      ],
    }),
  );
  assert.equal(invalid.valid_schema, false);
  assert.ok(errorCodes(invalid).includes('unknown_local_key') || errorCodes(invalid).includes('local_key_required'));
});

test('TAX-639 unknown legal value is blocking; forbidden statutory literal is an error', () => {
  const unknown = run(
    closed({
      legal_values: [{ value_key: 'not_a_real_key' }],
    }),
  );
  assert.equal(unknown.valid_schema, false);
  assert.ok(errorCodes(unknown).includes('unknown_legal_value'));

  const honest = run(
    closed({
      legal_values: [{ value_key: 'not_a_real_key' }],
      uncertainties: [
        {
          code: 'insufficient_evidence',
          severity: 'blocks_rule_publication',
          subject: { kind: 'legal_value', key: 'not_a_real_key' },
          message: 'Cannot bind Country Pack key',
        },
      ],
    }),
  );
  assert.equal(honest.valid_schema, true, JSON.stringify(honest.errors));
  assert.equal(honest.owner_approval_allowed, true);
  assert.equal(honest.publication_eligible, false);

  const literal = run({
    ...closed(),
    legal_values: [{ value_key: 'credit_point_value', amount: 235 }],
  });
  assert.equal(literal.valid_schema, false);
  assert.ok(errorCodes(literal).includes('forbidden_statutory_literal') || errorCodes(literal).includes('unknown_field'));
});

test('TAX-639 valid verbatim evidence span matches the Owner Draft; fake span and paraphrase-only fail', () => {
  const valid = run(closed());
  assert.equal(valid.evidence_validation.quotes[0]?.matched, true);

  const fake = run(
    closed({
      evidence: {
        source_role: 'reviewed_owner_draft',
        quotes: [{ role: 'verbatim_from_draft', text: 'not the draft', start: 0, end: 4 }],
        citations: [],
      },
    }),
  );
  assert.equal(fake.valid_schema, false);
  assert.ok(errorCodes(fake).includes('fake_evidence_span'));

  const paraphrase = run(
    closed({
      evidence: {
        source_role: 'reviewed_owner_draft',
        quotes: [{ role: 'ai_paraphrase', text: 'AI summary of the section', start: 0, end: 1 }],
        citations: [],
      },
    }),
  );
  assert.equal(paraphrase.valid_schema, false);
  assert.ok(errorCodes(paraphrase).includes('authoritative_evidence_required'));
});

test('TAX-639 null effective_from is schema-valid only with blocking insufficient_evidence; Publish stays blocked', () => {
  const missing = run(closed({ rules: [determinedRule('r1', { effective_from: null })] }));
  assert.equal(missing.valid_schema, false);
  assert.ok(missing.errors.some((row) => row.path === 'rules[0].effective_from' && row.code === 'required'));

  const reviewOnly = run(
    closed({
      rules: [determinedRule('r1', { effective_from: null })],
      uncertainties: [
        {
          code: 'insufficient_evidence',
          severity: 'review_only',
          subject: { kind: 'rule', key: 'r1' },
          message: 'Draft does not prove commencement',
        },
      ],
    }),
  );
  assert.equal(reviewOnly.valid_schema, false);
  assert.ok(reviewOnly.errors.some((row) => row.path === 'rules[0].effective_from' && row.code === 'required'));

  const wrongSubject = run(
    closed({
      rules: [determinedRule('r1', { effective_from: null })],
      uncertainties: [
        {
          code: 'insufficient_evidence',
          severity: 'blocks_rule_publication',
          subject: { kind: 'legal_value', key: 'credit_point_value' },
          message: 'Draft does not prove commencement',
        },
      ],
    }),
  );
  assert.equal(wrongSubject.valid_schema, false);

  const honest = run(
    closed({
      rules: [determinedRule('r1', { effective_from: null })],
      uncertainties: [
        {
          code: 'insufficient_evidence',
          severity: 'blocks_rule_publication',
          subject: { kind: 'rule', key: 'r1' },
          message: 'Pinned Owner evidence does not establish effective_from',
        },
      ],
    }),
  );
  assert.equal(honest.valid_schema, true, JSON.stringify(honest.errors));
  assert.equal(honest.publication_eligible, false);
  assert.equal(honest.owner_approval_allowed, true);
  assert.equal(canOwnerApproveTaxKnowledgeProposal(honest), true);
});

test('TAX-639 blocking uncertainty prevents publication, not owner approval', () => {
  const result = run(
    closed({
      uncertainties: [
        {
          code: 'ambiguous_interpretation',
          severity: 'blocks_rule_publication',
          subject: { kind: 'rule', key: 'r1' },
          message: 'Two readings remain',
        },
      ],
    }),
  );
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, false);
  assert.equal(result.owner_approval_allowed, true);
  assert.equal(canOwnerApproveTaxKnowledgeProposal(result), true);
  assert.equal(result.blocking_uncertainties.length, 1);
});

test('TAX-639 invalid canonical ID and cross-country references are rejected', () => {
  const invented = run(closed({ rules: [determinedRule('r1', { existing_tax_rule_id: MISSING_ID })] }));
  assert.equal(invented.valid_schema, false);
  assert.ok(errorCodes(invented).includes('invalid_canonical_id'));

  const uuidKey = run(closed({ rules: [determinedRule(MISSING_ID)] }));
  assert.equal(uuidKey.valid_schema, false);
  assert.ok(errorCodes(uuidKey).includes('invented_canonical_id'));

  const cross = run(
    closed({
      relationships: [
        {
          from: { kind: 'proposal_rule', key: 'r1' },
          to: { kind: 'existing_rule_version', tax_rule_version_id: US_VERSION_ID },
          relationship_type: 'depends_on',
        },
      ],
    }),
  );
  assert.equal(cross.valid_schema, false);
  assert.ok(errorCodes(cross).includes('cross_country_reference'));

  const crossCitation = run(
    closed({
      evidence: {
        source_role: 'reviewed_owner_draft',
        quotes: [quote()],
        citations: [{ tax_source_id: US_SOURCE_ID }],
      },
    }),
  );
  assert.equal(crossCitation.valid_schema, false);
  assert.ok(errorCodes(crossCitation).includes('cross_country_reference'));
});

test('TAX-639 required calculation hook cannot emit a K4 expression or statutory const', () => {
  const honest = run(
    closed({
      calculations: [
        {
          proposal_calc_key: 'c1',
          required: true,
          title: 'Credit amount',
          pin_rule_keys: ['r1'],
          input_fact_keys: ['marital_status'],
          legal_value_keys: ['credit_point_value'],
          output_type: 'money',
          expression: null,
        },
      ],
      facts: [
        { fact_key: 'marital_status', role: 'applicability_condition' },
      ],
      uncertainties: [
        {
          code: 'insufficient_evidence',
          severity: 'review_only',
          subject: { kind: 'calculation', key: 'c1' },
          detail: 'calculation_not_supplied',
          message: 'Hook only; K4 definition is not authored here',
        },
      ],
    }),
  );
  assert.equal(honest.valid_schema, true, JSON.stringify(honest.errors));

  const fake = run(
    closed({
      calculations: [
        {
          proposal_calc_key: 'c1',
          required: true,
          title: 'Credit amount',
          pin_rule_keys: ['r1'],
          input_fact_keys: [],
          legal_value_keys: [],
          output_type: 'money',
          expression: { op: 'const', type: 'money', value: '235' },
        },
      ],
    }),
  );
  assert.equal(fake.valid_schema, false);
  assert.ok(errorCodes(fake).includes('k4_expression_forbidden'));
});

test('TAX-639 node_code and rule_code are forbidden identity fields', () => {
  const result = run({
    ...closed(),
    legal_nodes: [{ proposal_node_key: 'n1', source_display_identifier: '1', title: 'סעיף 1', node_code: 'node_x' }],
  });
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('forbidden_identity_code'));
});

test('TAX-639 evaluation_as_of is reserved', () => {
  const result = run(
    closed({
      facts: [
        { fact_key: 'marital_status', role: 'applicability_condition' },
        { fact_key: 'evaluation_as_of', role: 'informational' },
      ],
    }),
  );
  assert.equal(result.valid_schema, false);
  assert.ok(errorCodes(result).includes('reserved_fact'));
});

test('TAX-639 empty catalog still validates a zero-rule proposal', () => {
  const result = run(
    closed({
      extraction_outcome: 'no_rules',
      legal_nodes: [],
      rules: [],
      facts: [],
      legal_values: [],
      evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
    }),
    emptyTaxKnowledgeProposalValidationCatalog(),
  );
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
});

test('TAX-639 extraction_outcome=rules cannot keep leftover rules when switched off', () => {
  const result = run(closed({ extraction_outcome: 'no_rules' }));
  assert.equal(result.valid_schema, false);
});

test('TAX-651 delegated-authority valuation remains a valid rule when client applicability is unresolved', () => {
  const statement =
    'The Minister of Finance, with the approval of the Knesset Finance Committee, determines the value of the use of a vehicle or radio telephone made available to an employee.';
  const result = run(
    closed({
      rules: [
        determinedRule('r1', {
          title: 'Valuation of employee vehicle or radio-telephone use',
          statement,
          applicability_status: 'cannot_determine',
          applies_if: null,
          does_not_apply_if: null,
          legal_value_keys: [],
        }),
      ],
      facts: [],
      legal_values: [],
      uncertainties: [
        {
          code: 'cannot_determine',
          severity: 'blocks_rule_publication',
          subject: { kind: 'rule', key: 'r1' },
          message: 'Client applicability requires additional facts or subordinate legislation.',
        },
      ],
    }),
  );
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, false);
});
