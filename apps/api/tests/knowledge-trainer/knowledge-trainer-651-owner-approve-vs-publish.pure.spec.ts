import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TaxKnowledgeProposalPublishPlanError,
  earliestPublishableRuleEffectiveFrom,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-canonical-draft-plan.pure.js';
import {
  canSetTaxKnowledgeProposalReviewStatus,
  taxKnowledgeProposalAllowedActions,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.pure.js';
import { buildTaxKnowledgeProposalOwnerView } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.js';
import {
  canOwnerApproveTaxKnowledgeProposal,
  summarizeTaxKnowledgeProposalValidation,
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
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const PROPOSAL_ID = '4541cc2b-fef6-449c-ac25-477a5cd33dfc';

function catalog(): TaxKnowledgeProposalValidationCatalog {
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

function context(): TaxKnowledgeProposalValidationContext {
  return {
    country_code: 'IL',
    tax_source_id: SOURCE_ID,
    legal_text_draft_id: DRAFT_ID,
    draft_legal_text: DRAFT,
  };
}

function unresolvedEffectiveFromProposal() {
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
    rules: [
      {
        proposal_rule_key: 'r1',
        title: 'Married resident',
        rule_kind: 'legal_rule',
        statement: 'A married Israeli resident is eligible.',
        applicability_status: 'determined',
        applies_if: { fact: 'marital_status', op: 'eq', type: 'enum', value: 'married' },
        does_not_apply_if: null,
        notes: null,
        effective_from: null,
        effective_to: null,
        legal_node_keys: ['n1'],
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
      quotes: [{ role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length }],
      citations: [{ tax_source_id: SOURCE_ID, locator: 'סעיף 1' }],
    },
    uncertainties: [
      {
        code: 'insufficient_evidence',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'r1' },
        message: 'Pinned Owner evidence does not establish effective_from',
      },
    ],
  };
}

test('TAX-651 unresolved effective_from can be Owner-approved but cannot be Published', () => {
  const proposal = unresolvedEffectiveFromProposal();
  const result = validateTaxKnowledgeProposalV1({
    proposal_json: proposal,
    context: context(),
    catalog: catalog(),
  });
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
  assert.equal(result.publication_eligible, false);
  assert.equal(result.owner_approval_allowed, true);
  assert.equal(canOwnerApproveTaxKnowledgeProposal(result), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('proposed', 'owner_approved'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('needs_review', 'owner_approved'), true);
  assert.equal(
    result.blocking_uncertainties.some(
      (row) => row.code === 'insufficient_evidence' && row.severity === 'blocks_rule_publication',
    ),
    true,
  );

  const approvedBlocked = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedProposalStatus: 'owner_approved',
    publicationEligible: result.publication_eligible,
  });
  assert.equal(approvedBlocked.set_tax_knowledge_proposal_review_status, false);
  assert.equal(approvedBlocked.publish_tax_knowledge_proposal_to_canonical_draft, false);
  assert.equal(
    taxKnowledgeProposalAllowedActions({
      hasSelectedDraft: true,
      selectedProposalStatus: 'owner_approved',
      publicationEligible: true,
    }).publish_tax_knowledge_proposal_to_canonical_draft,
    true,
  );

  const view = buildTaxKnowledgeProposalOwnerView({
    selected: {
      id: PROPOSAL_ID,
      revision_no: 1,
      status: 'proposed',
      status_label: 'Proposed / מוצע',
      creation_origin: 'ai_proposal',
      legal_text_draft_id: DRAFT_ID,
    },
    proposal_json: proposal,
    validation: summarizeTaxKnowledgeProposalValidation(result),
  });
  assert.equal(view.approve.action_key, 'set_tax_knowledge_proposal_review_status');
  assert.equal(view.approve.enabled, true);
  assert.equal(view.approve.presentation, 'available');
  assert.equal(view.details.owner_approval_allowed, 'yes');
  assert.equal(view.details.publication_eligible, 'no');

  const alreadyApproved = buildTaxKnowledgeProposalOwnerView({
    selected: {
      id: PROPOSAL_ID,
      revision_no: 1,
      status: 'owner_approved',
      status_label: 'Owner approved / אושר על ידי Owner',
      creation_origin: 'ai_proposal',
      legal_text_draft_id: DRAFT_ID,
    },
    proposal_json: proposal,
    validation: summarizeTaxKnowledgeProposalValidation(result),
  });
  assert.equal(alreadyApproved.approve.enabled, false);
  assert.equal(alreadyApproved.approve.presentation, 'approved');

  assert.throws(
    () => earliestPublishableRuleEffectiveFrom(proposal),
    (error: unknown) =>
      error instanceof TaxKnowledgeProposalPublishPlanError &&
      error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' &&
      /sourced effective_from/.test(error.message),
  );
});
