import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTaxKnowledgeProposalRuleTextCorrections,
  parseTaxKnowledgeProposalRuleTextCorrections,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.pure.js';

function proposal() {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    rules: [
      {
        proposal_rule_key: 'rule_1',
        title: 'Old title',
        statement: 'Old statement',
        notes: 'Old notes',
        applies_if: { fact_key: 'resident', op: 'eq', value: true },
      },
    ],
  };
}

test('TAX-648A rule text corrections overlay human fields without touching predicates', () => {
  const parsed = parseTaxKnowledgeProposalRuleTextCorrections([
    { proposal_rule_key: 'rule_1', title: 'New title', statement: 'New statement', notes: 'New notes' },
  ]);
  assert.ok(parsed);
  const applied = applyTaxKnowledgeProposalRuleTextCorrections(proposal(), parsed);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const rule = (applied.proposal_json.rules as Array<Record<string, unknown>>)[0];
  assert.equal(rule.title, 'New title');
  assert.equal(rule.statement, 'New statement');
  assert.equal(rule.notes, 'New notes');
  assert.deepEqual(rule.applies_if, { fact_key: 'resident', op: 'eq', value: true });
});

test('TAX-648A rule text corrections reject unknown keys, missing rule keys, and extra predicate fields', () => {
  assert.equal(
    parseTaxKnowledgeProposalRuleTextCorrections([
      { proposal_rule_key: 'rule_1', applies_if: { fact_key: 'resident' } },
    ]),
    null,
  );
  assert.equal(parseTaxKnowledgeProposalRuleTextCorrections([]), null);
  assert.equal(parseTaxKnowledgeProposalRuleTextCorrections([{ title: 'x' }]), null);
  const missing = applyTaxKnowledgeProposalRuleTextCorrections(proposal(), [
    { proposal_rule_key: 'rule_missing', title: 'x' },
  ]);
  assert.equal(missing.ok, false);
});
