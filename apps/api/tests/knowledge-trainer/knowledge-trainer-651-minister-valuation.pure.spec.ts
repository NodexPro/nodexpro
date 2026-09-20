import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractSystemMessage } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract.pure.js';
import { buildTaxKnowledgeProposalOwnerView } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.js';
import { summarizeTaxKnowledgeProposalValidation } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';

const STATEMENT =
  'The Minister of Finance, with the approval of the Knesset Finance Committee, determines the value of the use of a vehicle or radio telephone made available to an employee.';

function ministerProposal() {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [],
    rules: [
      {
        proposal_rule_key: 'rule_1',
        title: 'Minister determines value of employee vehicle or radio-telephone use',
        rule_kind: 'legal_rule',
        statement: STATEMENT,
        applicability_status: 'cannot_determine',
        applies_if: null,
        does_not_apply_if: null,
        notes:
          'This is a delegated-authority valuation rule. Client-specific application may require facts or Income Tax Regulations.',
        legal_node_keys: [],
        calculation_keys: [],
        legal_value_keys: [],
        existing_tax_rule_id: null,
        existing_tax_legal_node_ids: [],
      },
    ],
    relationships: [],
    calculations: [],
    facts: [],
    legal_values: [],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [
        {
          role: 'verbatim_from_draft',
          text: 'שר האוצר, באישור ועדת הכספים של הכנסת, יקבע את שווי השימוש ברכב או ברדיו-טלפון',
          start: 0,
          end: 10,
        },
      ],
      citations: [{ locator: '2(2)(ב)' }],
    },
    uncertainties: [
      {
        code: 'cannot_determine',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'rule_1' },
        message: 'Client applicability requires additional facts or subordinate legislation.',
      },
    ],
  };
}

test('TAX-651 extract contract treats delegated authority as a legal rule, not no_rules', () => {
  const system = buildExtractSystemMessage();
  assert.match(system, /delegated authority/);
  assert.match(system, /valuation rule/);
  assert.match(system, /Missing client facts[\s\S]*do NOT justify no_rules/i);
  assert.match(system, /no_rules only when the draft is genuinely non-operative/);
});

test('TAX-651 2(2)(ב)-pattern owner view shows the legal rule, not “no legal rule”', () => {
  const view = buildTaxKnowledgeProposalOwnerView({
    selected: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      revision_no: 1,
      status: 'proposed',
      status_label: 'Proposed / מוצע',
      creation_origin: 'ai_proposal',
      legal_text_draft_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    proposal_json: ministerProposal(),
    validation: summarizeTaxKnowledgeProposalValidation({
      valid_schema: true,
      publication_eligible: false,
      owner_approval_allowed: false,
      errors: [],
      warnings: [],
      blocking_uncertainties: [
        {
          code: 'cannot_determine',
          severity: 'blocks_rule_publication',
          subject: { kind: 'rule', key: 'rule_1' },
          message: 'Client applicability requires additional facts or subordinate legislation.',
          detail: null,
        },
      ],
      resolved_fact_bindings: [],
      resolved_legal_values: [],
      resolved_existing_rule_refs: [],
      evidence_validation: {
        draft_legal_text_length: 80,
        verbatim_quote_count: 1,
        paraphrase_quote_count: 0,
        citation_count: 1,
        authoritative_evidence: true,
        quotes: [{ index: 0, role: 'verbatim_from_draft', matched: true, message: null }],
      },
    }),
  });
  assert.equal(view.available, true);
  assert.equal(view.details.extraction_outcome, 'rules');
  assert.match(view.by_locale.en.explanation, /Minister of Finance/);
  assert.doesNotMatch(view.by_locale.en.explanation, /did not extract a legal rule/);
  assert.doesNotMatch(view.by_locale.he.explanation, /לא חילץ כלל משפטי/);
  assert.match(view.by_locale.en.applicability, /Client applicability/);
  assert.doesNotMatch(view.by_locale.en.applicability, /no legal rule was extracted/);
  assert.equal(view.details.rules[0]?.statement, STATEMENT);
  assert.equal(view.external_reference.visible, true);
  assert.equal(view.external_reference.enabled, true);
  assert.equal(view.external_reference.action_key, 'record_tax_knowledge_proposal_external_reference');
});

test('TAX-651 no_rules empty proposal is not described as a client-applicability failure', () => {
  const view = buildTaxKnowledgeProposalOwnerView({
    selected: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      revision_no: 1,
      status: 'proposed',
      status_label: 'Proposed / מוצע',
      creation_origin: 'ai_proposal',
      legal_text_draft_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    proposal_json: {
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
    validation: summarizeTaxKnowledgeProposalValidation({
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
        draft_legal_text_length: 12,
        verbatim_quote_count: 0,
        paraphrase_quote_count: 0,
        citation_count: 0,
        authoritative_evidence: false,
        quotes: [],
      },
    }),
  });
  assert.match(view.by_locale.en.explanation, /did not extract a legal rule/);
  assert.match(view.by_locale.en.applicability, /not a client-applicability decision/);
  assert.equal(view.external_reference.enabled, false);
});
