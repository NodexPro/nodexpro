import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaxKnowledgeProposalOwnerView,
  emptyTaxKnowledgeProposalOwnerView,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.js';
import { summarizeTaxKnowledgeProposalValidation } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import type { TaxKnowledgeProposalV1ValidationResult } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';

const DRAFT_ID = 'a50e79de-f5f4-44ae-ab32-149e2baae5dd';
const PROPOSAL_ID = '4541cc2b-fef6-449c-ac25-477a5cd33dfc';

function seif3AbProposal() {
  return {
    facts: [],
    rules: [
      {
        notes:
          "The draft states a legal deeming rule, but no tax fact definitions are available to encode predicates for 'Israeli citizen', 'income', or 'Area' without inventing missing fact keys.",
        title:
          'Income of an Israeli citizen produced or accrued in the Area is treated as income produced or accrued in Israel',
        rule_kind: 'legal_rule',
        statement:
          'The income of an Israeli citizen that was produced or accrued in the Area is treated as income produced or accrued in Israel.',
        applies_if: null,
        owner_note: null,
        usage_hint: null,
        effective_to: null,
        effective_from: null,
        legal_node_keys: ['node_1'],
        calculation_keys: [],
        legal_value_keys: [],
        does_not_apply_if: null,
        proposal_rule_key: 'rule_1',
        applicability_status: 'cannot_determine',
        existing_tax_rule_id: null,
        existing_tax_legal_node_ids: [],
      },
    ],
    contract: 'tax_knowledge_proposal_v1',
    evidence: {
      quotes: [
        {
          end: 93,
          role: 'verbatim_from_draft',
          text: 'הכנסתו של אזרח ישראלי שהופקה או שנצמחה באזור, יראו אותה כהכנסה ( ב ) שהופקה או שנצמחה בישראל.',
          start: 0,
        },
      ],
      citations: [{ locator: '3א(ב)', tax_source_id: 'afae0b6c-3a0d-444e-bd38-b44c25e23e52' }],
      source_role: 'reviewed_owner_draft',
      legal_locator: {
        source_display_identifier: '3א(ב)',
        normalized_machine_identifier: '3א(ב)',
      },
    },
    legal_nodes: [],
    calculations: [],
    legal_values: [],
    relationships: [],
    uncertainties: [
      {
        code: 'cannot_determine',
        detail:
          'No tax fact definitions were provided, so the rule\'s conditions cannot be encoded without inventing missing fact keys.',
        message:
          'Applicability predicates cannot be determined from this draft within the available controlled context.',
        subject: { key: 'rule_1', kind: 'rule' },
        severity: 'blocks_rule_publication',
      },
    ],
    schema_version: 1,
    extraction_outcome: 'rules',
  };
}

function selectedMeta() {
  return {
    id: PROPOSAL_ID,
    revision_no: 1,
    status: 'proposed',
    status_label: 'Proposed / מוצע',
    creation_origin: 'ai_proposal',
    legal_text_draft_id: DRAFT_ID,
  };
}

test('TAX-643 empty owner view is bilingual and does not invent a proposal', () => {
  const view = emptyTaxKnowledgeProposalOwnerView();
  assert.equal(view.available, false);
  assert.equal(view.heading, 'AI Proposal / הצעת AI');
  assert.equal(view.empty_title, 'No AI proposal yet / טרם נוצרה הצעת AI');
  assert.match(view.empty_detail, /does not generate/i);
  assert.equal(view.understanding_summary, '');
  assert.equal(buildTaxKnowledgeProposalOwnerView({ selected: null, proposal_json: null, validation: null }).available, false);
});

test('TAX-643 owner view explains 3א(ב) deeming rule and missing Fact Dictionary without raw JSON', () => {
  const validation = summarizeTaxKnowledgeProposalValidation({
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
        message:
          'Applicability predicates cannot be determined from this draft within the available controlled context.',
        detail:
          'No tax fact definitions were provided, so the rule\'s conditions cannot be encoded without inventing missing fact keys.',
      },
    ],
    resolved_fact_bindings: [],
    resolved_legal_values: [],
    resolved_existing_rule_refs: [],
    evidence_validation: {
      draft_legal_text_length: 93,
      verbatim_quote_count: 1,
      paraphrase_quote_count: 0,
      citation_count: 1,
      authoritative_evidence: true,
      quotes: [{ index: 0, role: 'verbatim_from_draft', matched: true, message: null }],
    },
  } satisfies TaxKnowledgeProposalV1ValidationResult);

  const view = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: seif3AbProposal(),
    validation,
  });

  assert.equal(view.available, true);
  assert.equal(view.status_label, 'Proposed / מוצע');
  assert.equal(view.revision_label, 'Revision 1');
  assert.equal(view.rules[0]?.title.includes('Israeli citizen'), true);
  assert.match(view.rules[0]?.statement ?? '', /treated as income produced or accrued in Israel/);
  assert.equal(view.rules[0]?.applicability_status_label, 'Cannot determine / לא ניתן לקבוע');
  assert.equal(view.rules[0]?.applies_if, null);
  assert.equal(view.facts.length, 0);
  assert.match(view.understanding_summary, /AI extracted a legal rule/);
  assert.match(view.understanding_summary, /treated as income produced or accrued in Israel/);
  assert.match(view.understanding_summary, /Applicability cannot yet be determined/);
  assert.match(view.understanding_summary, /No tax fact definitions were provided/);
  assert.match(view.publication_eligible_label, /^No /);
  assert.match(view.owner_approval_allowed_label, /^No /);
  assert.equal(view.evidence_locator, '3א(ב)');
  assert.equal(view.evidence_quotes[0]?.detail?.includes('אזרח ישראלי'), true);
  assert.equal(view.uncertainties.length, 1);
  assert.match(view.uncertainties[0]?.detail ?? '', /Fact Dictionary|tax fact definitions/i);
  assert.equal(view.technical_rows.some((row) => row.value === PROPOSAL_ID), true);
});
