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
const QUOTE = 'הכנסתו של אזרח ישראלי שהופקה או שנצמחה באזור, יראו אותה כהכנסה ( ב ) שהופקה או שנצמחה בישראל.';

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
      quotes: [{ end: 93, role: 'verbatim_from_draft', text: QUOTE, start: 0 }],
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
        detail: 'No tax fact definitions were provided, so the rule\'s conditions cannot be encoded without inventing missing fact keys.',
        message: 'Applicability predicates cannot be determined from this draft within the available controlled context.',
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

function validation() {
  return summarizeTaxKnowledgeProposalValidation({
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
        message: 'Applicability predicates cannot be determined from this draft within the available controlled context.',
        detail: 'No tax fact definitions were provided, so the rule\'s conditions cannot be encoded without inventing missing fact keys.',
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
}

test('TAX-644A empty owner view is he/ru/en and does not invent a proposal', () => {
  const view = emptyTaxKnowledgeProposalOwnerView();
  assert.equal(view.available, false);
  assert.equal(view.has_proposal, false);
  assert.equal(view.create.visible, false);
  assert.equal(view.create.enabled, false);
  assert.equal(view.approve.enabled, false);
  assert.equal(view.correct.visible, false);
  assert.equal(view.default_locale, 'he');
  assert.deepEqual(view.locale_options.map((row) => row.code), ['he', 'ru', 'en']);
  assert.equal(view.by_locale.he.empty_title, 'טרם נוצרה הצעת AI');
  assert.equal(view.by_locale.ru.empty_title, 'AI Proposal ещё не создан');
  assert.equal(view.by_locale.en.empty_title, 'No AI Proposal yet');
  assert.equal(buildTaxKnowledgeProposalOwnerView({ selected: null, proposal_json: null, validation: null }).available, false);
});

test('TAX-645 Create action comes from backend eligibility, not frontend review_status', () => {
  const notReviewed = buildTaxKnowledgeProposalOwnerView({
    selected: null,
    proposal_json: null,
    validation: null,
    draft: { id: DRAFT_ID, review_status: 'needs_review' },
    generate_enabled: false,
  });
  assert.equal(notReviewed.available, false);
  assert.equal(notReviewed.has_proposal, false);
  assert.equal(notReviewed.create.action_key, 'generate_tax_knowledge_proposal');
  assert.equal(notReviewed.create.visible, true);
  assert.equal(notReviewed.create.enabled, false);
  assert.equal(notReviewed.create.legal_text_draft_id, DRAFT_ID);
  assert.equal(notReviewed.by_locale.he.create_disabled_reason, 'יש לבדוק ולאשר את טיוטת החוק לפני יצירת הצעת AI');
  assert.equal(notReviewed.by_locale.ru.create_disabled_reason, 'Сначала проверьте и отметьте текст закона как Reviewed');
  assert.equal(notReviewed.by_locale.en.create_disabled_reason, 'Review the legal draft before creating an AI Proposal');
  assert.equal(notReviewed.by_locale.he.create_label, '✨ צור Proposal');
  assert.equal(notReviewed.by_locale.ru.create_label, '✨ Создать Proposal');
  assert.equal(notReviewed.by_locale.en.create_label, '✨ Create Proposal');

  const ready = buildTaxKnowledgeProposalOwnerView({
    selected: null,
    proposal_json: null,
    validation: null,
    draft: { id: DRAFT_ID, review_status: 'ready' },
    generate_enabled: true,
  });
  assert.equal(ready.has_proposal, false);
  assert.equal(ready.create.visible, true);
  assert.equal(ready.create.enabled, true);
  assert.equal(ready.create.legal_text_draft_id, DRAFT_ID);

  const existing = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: seif3AbProposal(),
    validation: validation(),
    draft: { id: DRAFT_ID, review_status: 'ready' },
    generate_enabled: false,
  });
  assert.equal(existing.available, true);
  assert.equal(existing.has_proposal, true);
  assert.equal(existing.create.visible, false);
  assert.equal(existing.create.enabled, false);
  assert.equal(existing.approve.visible, true);
  assert.equal(existing.approve.enabled, false);
  assert.equal(existing.approve.action_key, 'set_tax_knowledge_proposal_review_status');
  assert.equal(existing.approve.status, 'owner_approved');
  assert.equal(existing.correct.visible, true);
  assert.equal(existing.correct.enabled, true);
  assert.equal(existing.correct.action_key, 'create_corrected_tax_knowledge_proposal');
  assert.equal(existing.correct.rules[0]?.proposal_rule_key, 'rule_1');
  assert.doesNotMatch(JSON.stringify(existing.create), /review_status/);
});

test('TAX-648A approve is enabled only from TAX-639 owner_approval_allowed and review transitions', () => {
  const blocked = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: seif3AbProposal(),
    validation: validation(),
  });
  assert.equal(blocked.approve.enabled, false);
  assert.equal(blocked.details.owner_approval_allowed, 'no');

  const eligible = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: seif3AbProposal(),
    validation: summarizeTaxKnowledgeProposalValidation({
      valid_schema: true,
      publication_eligible: true,
      owner_approval_allowed: true,
      errors: [],
      warnings: [],
      blocking_uncertainties: [],
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
    }),
  });
  assert.equal(eligible.approve.visible, true);
  assert.equal(eligible.approve.enabled, true);
  assert.equal(eligible.approve.tax_knowledge_proposal_id, PROPOSAL_ID);
  assert.equal(eligible.approve.status, 'owner_approved');
  assert.equal(eligible.by_locale.he.approve_aria_label, 'אישור הצעת AI');
  assert.equal(eligible.by_locale.ru.approve_aria_label, 'Подтвердить предложение AI');
  assert.equal(eligible.by_locale.en.approve_aria_label, 'Approve AI Proposal');

  const alreadyApproved = buildTaxKnowledgeProposalOwnerView({
    selected: { ...selectedMeta(), status: 'owner_approved', status_label: 'Owner approved / אושר על ידי Owner' },
    proposal_json: seif3AbProposal(),
    validation: summarizeTaxKnowledgeProposalValidation({
      valid_schema: true,
      publication_eligible: true,
      owner_approval_allowed: true,
      errors: [],
      warnings: [],
      blocking_uncertainties: [],
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
    }),
  });
  assert.equal(alreadyApproved.approve.visible, true);
  assert.equal(alreadyApproved.approve.enabled, false);
});

test('TAX-644B owner view shows the actual extracted meaning and stored he/ru/en presentation', () => {
  const proposal = seif3AbProposal();
  const sourceStatement =
    'The income of an Israeli citizen that was produced or accrued in the Area is treated as income produced or accrued in Israel.';
  const fallback = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: proposal,
    validation: validation(),
  });
  assert.equal(fallback.by_locale.en.explanation, sourceStatement);
  assert.equal(fallback.by_locale.he.explanation, sourceStatement);
  assert.doesNotMatch(fallback.by_locale.en.explanation, /legal rule from this provision/);

  const heMeaning = 'הכנסה של אזרח ישראלי שהופקה או שנצמחה באזור נחשבת כהכנסה שהופקה או שנצמחה בישראל.';
  const ruMeaning =
    'Доход гражданина Израиля, произведённый или возникший в Районе, рассматривается как доход, произведённый или возникший в Израиле.';
  const view = buildTaxKnowledgeProposalOwnerView({
    selected: selectedMeta(),
    proposal_json: proposal,
    validation: validation(),
    owner_presentation_json: {
      schema_version: 1,
      source_locale: 'en',
      source_digest: 'test',
      by_locale: {
        he: { explanation: heMeaning },
        ru: { explanation: ruMeaning },
        en: { explanation: sourceStatement },
      },
    },
  });

  assert.equal(view.available, true);
  assert.equal(view.default_locale, 'he');
  assert.equal(view.source.identifier, '3א(ב)');
  assert.equal(view.source.quote, QUOTE);
  assert.equal(view.by_locale.he.question, 'מה ה-AI הבין מהחוק?');
  assert.equal(view.by_locale.ru.question, 'Что AI понял из закона?');
  assert.equal(view.by_locale.en.question, 'What did AI understand from this law?');
  assert.equal(view.by_locale.he.explanation, heMeaning);
  assert.equal(view.by_locale.ru.explanation, ruMeaning);
  assert.equal(view.by_locale.en.explanation, sourceStatement);
  assert.equal(view.source.quote.includes('הכנסתו של אזרח ישראלי'), true);
  assert.equal(view.by_locale.he.applicability, 'לא ניתן לקבוע תחולה.');
  assert.equal(view.by_locale.en.applicability, 'Applicability cannot yet be determined.');
  assert.match(view.by_locale.he.uncertainty ?? '', /Fact Dictionary/);
  assert.equal(view.by_locale.he.warning_tone, 'blocking');
  assert.equal(view.details.facts.length, 0);
  assert.equal(view.details.legal_values.length, 0);
  assert.equal(view.details.relationships.length, 0);
  assert.equal(view.details.calculations.length, 0);
  assert.equal(view.details.technical_rows.some((row) => row.value === PROPOSAL_ID), true);
  assert.equal(view.details.rules[0]?.statement, sourceStatement);
});
