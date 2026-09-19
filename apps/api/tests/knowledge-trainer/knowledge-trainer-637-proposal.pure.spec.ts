import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedTaxKnowledgeProposalReviewStatuses,
  canSetTaxKnowledgeProposalReviewStatus,
  isProposalRevisionConflictError,
  nextProposalRevisionNo,
  pickLatestTaxKnowledgeProposal,
  pickSelectedTaxKnowledgeProposal,
  taxKnowledgeProposalAllowedActions,
  taxKnowledgeProposalStatusLabel,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.pure.js';

test('TAX-637 review transitions reject owner_approved edit, rejected reopen, and published change', () => {
  assert.deepEqual(allowedTaxKnowledgeProposalReviewStatuses('proposed'), [
    'needs_review',
    'owner_approved',
    'rejected',
  ]);
  assert.deepEqual(allowedTaxKnowledgeProposalReviewStatuses('needs_review'), ['owner_approved', 'rejected']);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('proposed', 'needs_review'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('proposed', 'owner_approved'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('proposed', 'rejected'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('needs_review', 'owner_approved'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('needs_review', 'rejected'), true);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('needs_review', 'proposed'), false);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('owner_approved', 'needs_review'), false);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('owner_approved', 'rejected'), false);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('rejected', 'proposed'), false);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('published_to_canonical_draft', 'proposed'), false);
  assert.equal(canSetTaxKnowledgeProposalReviewStatus('published_to_canonical_draft', 'owner_approved'), false);
});

test('TAX-637 latest revision is backend-selected by max revision_no', () => {
  const latest = pickLatestTaxKnowledgeProposal([
    { id: 'a', revision_no: 1 },
    { id: 'c', revision_no: 3 },
    { id: 'b', revision_no: 2 },
  ]);
  assert.equal(latest?.id, 'c');
  assert.equal(pickSelectedTaxKnowledgeProposal(
    [
      { id: 'a', revision_no: 1 },
      { id: 'c', revision_no: 3 },
    ],
    'a',
  )?.id, 'a');
  assert.equal(nextProposalRevisionNo(3), 4);
  assert.equal(nextProposalRevisionNo(null), 1);
});

test('TAX-637 allowed actions and labels are backend-owned', () => {
  assert.match(taxKnowledgeProposalStatusLabel('owner_approved'), /Owner approved/);
  const none = taxKnowledgeProposalAllowedActions({ hasSelectedDraft: false, selectedProposalStatus: null });
  assert.equal(none.create_tax_knowledge_proposal, false);
  assert.equal(none.generate_tax_knowledge_proposal, false);
  assert.equal(none.set_tax_knowledge_proposal_review_status, false);
  const proposed = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedDraftReviewStatus: 'draft',
    selectedProposalStatus: 'proposed',
  });
  assert.equal(proposed.create_tax_knowledge_proposal, true);
  assert.equal(proposed.generate_tax_knowledge_proposal, false);
  assert.equal(proposed.set_tax_knowledge_proposal_review_status, true);
  assert.equal(proposed.create_corrected_tax_knowledge_proposal, true);
  assert.equal(proposed.ensure_tax_knowledge_proposal_owner_presentations, true);
  const ready = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedDraftReviewStatus: 'ready',
    selectedProposalStatus: null,
  });
  assert.equal(ready.generate_tax_knowledge_proposal, true);
  const readyExisting = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedDraftReviewStatus: 'ready',
    selectedProposalStatus: 'proposed',
  });
  assert.equal(readyExisting.generate_tax_knowledge_proposal, false);
  const approved = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedProposalStatus: 'owner_approved',
  });
  assert.equal(approved.set_tax_knowledge_proposal_review_status, false);
  assert.equal(approved.create_corrected_tax_knowledge_proposal, true);
  assert.equal(isProposalRevisionConflictError({ code: '23505' }), true);
  assert.equal(
    isProposalRevisionConflictError({ message: 'revision_no must be monotonic per legal_text_draft_id' }),
    true,
  );
});
