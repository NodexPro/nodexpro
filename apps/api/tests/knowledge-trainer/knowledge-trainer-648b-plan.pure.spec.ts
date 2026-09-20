import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLegalMachineCode } from '../../src/domains/tax-knowledge/tax-knowledge-library.pure.js';
import { taxRulePayloadChecksum } from '../../src/domains/tax-knowledge/tax-knowledge-checksum.pure.js';
import { emptyTaxKnowledgeProposalValidationResult } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type { TaxKnowledgeProposalV1ValidationResult } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';
import {
  TaxKnowledgeProposalPublishPlanError,
  buildTaxKnowledgeProposalCanonicalDraftPlan,
  earliestPublishableRuleEffectiveFrom,
  isPublishableProposalRule,
  proposalMachineCodeTargets,
  topologicalProposalLegalNodes,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-canonical-draft-plan.pure.js';

const PACK = '11111111-1111-4111-8111-111111111111';
const RULESET = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const KIND = '44444444-4444-4444-8444-444444444444';
const VALUE = '55555555-5555-4555-8555-555555555555';
const FACT = '66666666-6666-4666-8666-666666666666';

function validation(overrides: Partial<TaxKnowledgeProposalV1ValidationResult> = {}): TaxKnowledgeProposalV1ValidationResult {
  return {
    ...emptyTaxKnowledgeProposalValidationResult(),
    valid_schema: true,
    publication_eligible: true,
    owner_approval_allowed: true,
    ...overrides,
  };
}

function node(key: string, extra: Record<string, unknown> = {}) {
  return {
    proposal_node_key: key,
    title: `Title ${key}`,
    tax_legal_node_kind_id: KIND,
    source_display_identifier: key === 'child' ? '1(א)' : '1',
    ...extra,
  };
}

function rule(key: string, extra: Record<string, unknown> = {}) {
  return {
    proposal_rule_key: key,
    title: `Rule ${key}`,
    statement: `Statement ${key}`,
    applicability_status: 'determined',
    applies_if: { fact: 'marital_status', op: 'eq', type: 'enum', value: 'married' },
    does_not_apply_if: null,
    notes: null,
    effective_from: '2024-01-01',
    legal_node_keys: ['parent'],
    legal_value_keys: ['credit_point_value'],
    ...extra,
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    legal_nodes: [node('parent'), node('child', { parent: { kind: 'proposal_node', key: 'parent' } })],
    rules: [rule('r1'), rule('r2', { legal_node_keys: ['child'], effective_from: '2025-01-01' })],
    relationships: [
      {
        from: { kind: 'proposal_rule', key: 'r1' },
        to: { kind: 'proposal_rule', key: 'r2' },
        relationship_type: 'depends_on',
      },
    ],
    evidence: { citations: [{ tax_source_id: SOURCE, locator: 'סעיף 1' }] },
    ...overrides,
  };
}

function boundValidation(): TaxKnowledgeProposalV1ValidationResult {
  return validation({
    resolved_fact_bindings: [
      {
        fact_key: 'marital_status',
        role: 'applicability_condition',
        dictionary_status: 'bound_existing',
        tax_fact_definition_id: FACT,
        country_code: 'IL',
        value_type: 'enum',
        k3_type: 'enum',
      },
    ],
    resolved_legal_values: [{ value_key: 'credit_point_value', legal_value_id: VALUE, country_code: 'IL' }],
  });
}

test('TAX-648B topologically orders parent before child and generates backend codes/checksums', () => {
  const unordered = [node('child', { parent: { kind: 'proposal_node', key: 'parent' } }), node('parent')];
  const ordered = topologicalProposalLegalNodes(unordered);
  assert.deepEqual(
    ordered.map((row) => row.proposal_node_key),
    ['child', 'parent'].reverse().includes('parent') ? ['parent', 'child'] : ['parent', 'child'],
  );
  assert.equal(ordered[0].proposal_node_key, 'parent');
  assert.equal(ordered[1].proposal_node_key, 'child');
  assert.equal(isPublishableProposalRule(rule('r1')), true);
  assert.equal(isPublishableProposalRule(rule('r1', { applicability_status: 'cannot_determine' })), false);
  assert.equal(earliestPublishableRuleEffectiveFrom(proposal()), '2024-01-01');

  const targets = proposalMachineCodeTargets(proposal());
  const nodeCode = generateLegalMachineCode('node', targets.nodes[0].title, 'abc123');
  const ruleCode = generateLegalMachineCode('rule', targets.rules[0].title, 'def456');
  assert.match(nodeCode, /^node_/);
  assert.match(ruleCode, /^rule_/);

  const plan = buildTaxKnowledgeProposalCanonicalDraftPlan({
    country_code: 'IL',
    tax_source_id: SOURCE,
    country_pack_id: PACK,
    country_pack_ruleset_id: RULESET,
    proposal_json: proposal(),
    validation: boundValidation(),
    node_codes: { parent: nodeCode, child: generateLegalMachineCode('node', 'Title child', 'aa11bb') },
    rule_codes: { r1: ruleCode, r2: generateLegalMachineCode('rule', 'Rule r2', 'cc22dd') },
  });
  const nodes = plan.nodes as Array<Record<string, unknown>>;
  const rules = plan.rules as Array<Record<string, unknown>>;
  assert.equal(nodes[0].local_key, 'parent');
  assert.equal(nodes[1].local_key, 'child');
  assert.equal(nodes[1].parent_local_key, 'parent');
  assert.equal(nodes[0].source_display_identifier, '1');
  assert.equal(nodes[1].source_display_identifier, '1(א)');
  assert.ok(nodes[1].normalized_machine_identifier);
  assert.equal(rules.length, 2);
  const payload = (rules[0].version as { payload_json: Record<string, unknown>; payload_checksum: string }).payload_json;
  const checksum = (rules[0].version as { payload_checksum: string }).payload_checksum;
  assert.equal(checksum, taxRulePayloadChecksum(payload));
  assert.equal(plan.country_pack_id, PACK);
  assert.equal(plan.country_pack_ruleset_id, RULESET);
  assert.equal('calculations' in plan, false);
});

test('TAX-648B plan fails closed for missing Fact/Legal Value and country leaks', () => {
  const missingFact = () =>
    buildTaxKnowledgeProposalCanonicalDraftPlan({
      country_code: 'IL',
      tax_source_id: SOURCE,
      country_pack_id: PACK,
      country_pack_ruleset_id: RULESET,
      proposal_json: proposal(),
      validation: validation({
        resolved_fact_bindings: [
          {
            fact_key: 'marital_status',
            role: 'applicability_condition',
            dictionary_status: 'missing_definition',
            tax_fact_definition_id: null,
            country_code: 'IL',
            value_type: null,
            k3_type: null,
          },
        ],
        resolved_legal_values: [{ value_key: 'credit_point_value', legal_value_id: VALUE, country_code: 'IL' }],
      }),
      node_codes: { parent: 'node_parent', child: 'node_child' },
      rule_codes: { r1: 'rule_r1', r2: 'rule_r2' },
    });
  assert.throws(missingFact, (error: unknown) => error instanceof TaxKnowledgeProposalPublishPlanError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_MISSING_FACT');

  const missingValue = () =>
    buildTaxKnowledgeProposalCanonicalDraftPlan({
      country_code: 'IL',
      tax_source_id: SOURCE,
      country_pack_id: PACK,
      country_pack_ruleset_id: RULESET,
      proposal_json: proposal(),
      validation: validation({
        resolved_fact_bindings: boundValidation().resolved_fact_bindings,
        resolved_legal_values: [],
      }),
      node_codes: { parent: 'node_parent', child: 'node_child' },
      rule_codes: { r1: 'rule_r1', r2: 'rule_r2' },
    });
  assert.throws(missingValue, (error: unknown) => error instanceof TaxKnowledgeProposalPublishPlanError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_MISSING_LEGAL_VALUE');

  const leak = () =>
    buildTaxKnowledgeProposalCanonicalDraftPlan({
      country_code: 'IL',
      tax_source_id: SOURCE,
      country_pack_id: PACK,
      country_pack_ruleset_id: RULESET,
      proposal_json: proposal(),
      validation: validation({
        resolved_fact_bindings: boundValidation().resolved_fact_bindings,
        resolved_legal_values: [{ value_key: 'credit_point_value', legal_value_id: VALUE, country_code: 'US' }],
      }),
      node_codes: { parent: 'node_parent', child: 'node_child' },
      rule_codes: { r1: 'rule_r1', r2: 'rule_r2' },
    });
  assert.throws(leak, (error: unknown) => error instanceof TaxKnowledgeProposalPublishPlanError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH');
});

test('TAX-651 Canonical Publish refuses an unsourced effective_from and does not invent today', () => {
  assert.throws(
    () => earliestPublishableRuleEffectiveFrom(proposal({ rules: [rule('r1', { effective_from: null })] })),
    (error: unknown) =>
      error instanceof TaxKnowledgeProposalPublishPlanError &&
      error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' &&
      /sourced effective_from/.test(error.message),
  );
  assert.throws(
    () =>
      buildTaxKnowledgeProposalCanonicalDraftPlan({
        country_code: 'IL',
        tax_source_id: SOURCE,
        country_pack_id: PACK,
        country_pack_ruleset_id: RULESET,
        proposal_json: proposal({ rules: [rule('r1', { effective_from: null })] }),
        validation: boundValidation(),
        node_codes: { parent: 'node_parent', child: 'node_child' },
        rule_codes: { r1: 'rule_r1' },
      }),
    (error: unknown) =>
      error instanceof TaxKnowledgeProposalPublishPlanError &&
      error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' &&
      /sourced effective_from/.test(error.message),
  );
});

test('TAX-651 publish plan keeps Owner תקנות pin on the existing unresolved path', () => {
  const plan = buildTaxKnowledgeProposalCanonicalDraftPlan({
    country_code: 'IL',
    tax_source_id: SOURCE,
    country_pack_id: PACK,
    country_pack_ruleset_id: RULESET,
    proposal_json: proposal({
      relationships: [
        {
          from: { kind: 'proposal_rule', key: 'r1' },
          to: { kind: 'unresolved' },
          relationship_type: 'depends_on',
          unresolved: {
            cited_instrument_kind: 'regulation',
            cited_law_name: 'תקנות מס הכנסה (שווי השימוש ברכב)',
            locator_text: 'ראו תקנות מ"ה שווי השימוש ברכב',
          },
        },
      ],
    }),
    validation: boundValidation(),
    node_codes: { parent: 'node_parent', child: 'node_child' },
    rule_codes: { r1: 'rule_r1', r2: 'rule_r2' },
  });
  const unresolved = plan.unresolved as Array<Record<string, unknown>>;
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0]?.relationship_intent, 'depends_on');
  assert.equal(unresolved[0]?.from_local_key, 'r1');
  assert.equal(unresolved[0]?.cited_instrument_kind, 'regulation');
  assert.equal(unresolved[0]?.cited_law_name, 'תקנות מס הכנסה (שווי השימוש ברכב)');
  assert.equal(unresolved[0]?.cited_title, 'תקנות מס הכנסה (שווי השימוש ברכב)');
  assert.equal(unresolved[0]?.locator_text, 'ראו תקנות מ"ה שווי השימוש ברכב');
});
