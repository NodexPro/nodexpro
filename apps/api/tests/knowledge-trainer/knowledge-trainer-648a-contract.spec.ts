import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-648A reuses review-status and corrected-proposal commands without canonical publish', () => {
  const ownerView = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts');
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(ownerView, /action_key: 'set_tax_knowledge_proposal_review_status'/);
  assert.match(ownerView, /status: 'owner_approved'/);
  assert.match(ownerView, /owner_approval_allowed === true/);
  assert.match(ownerView, /TAX_KNOWLEDGE_PROPOSAL_APPROVE_PRESENTATIONS/);
  assert.match(ownerView, /presentation: available \? 'available' : 'unavailable'/);
  assert.match(ownerView, /presentation: 'approved'/);
  assert.match(service, /owner_approved requires a valid tax_knowledge_proposal_v1 contract/);
  assert.doesNotMatch(service, /with no blocks_rule_publication uncertainty/);
  assert.match(ownerView, /action_key: 'create_corrected_tax_knowledge_proposal'/);
  assert.match(ownerView, /correctionRulesFromProposal/);
  assert.match(service, /rule_text_corrections/);
  assert.match(service, /applyTaxKnowledgeProposalRuleTextCorrections/);
  assert.match(service, /published_to_canonical_draft is not available/);
  assert.doesNotMatch(service, /from\('tax_rules'\)/);
  assert.doesNotMatch(service, /from\('tax_rule_versions'\)/);
  assert.doesNotMatch(service, /activate_tax_rule_version/);
  assert.doesNotMatch(ownerView, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(ownerView, /activate_tax_rule_version/);
  assert.equal(capabilityRequiredForOwnerCommand('set_tax_knowledge_proposal_review_status'), 'legal_knowledge.review');
  assert.equal(capabilityRequiredForOwnerCommand('create_corrected_tax_knowledge_proposal'), 'legal_knowledge.draft_edit');

  assert.match(view, /nx-legal-draft-ai-proposal-approve/);
  assert.match(view, />\s*✓\s*</);
  assert.match(view, /view\.approve\.action_key/);
  assert.match(view, /status: view\.approve\.status/);
  assert.match(view, /rule_text_corrections/);
  assert.match(view, /view\.correct\.action_key/);
  assert.doesNotMatch(view, /proposal_json/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
  assert.doesNotMatch(view, />Approve</);
  assert.doesNotMatch(view, />אישור</);
  assert.doesNotMatch(view, />Подтвердить</);
  assert.doesNotMatch(view, /Reject/);
  assert.match(css, /nx-legal-draft-ai-proposal-approve/);
  assert.match(css, /is-available/);
  assert.match(css, /is-approved/);
  assert.match(css, /is-unavailable/);
  assert.doesNotMatch(
    css.slice(css.indexOf('.nx-legal-draft-ai-proposal-approve {'), css.indexOf('.nx-legal-draft-ai-proposal-publish')),
    /#86efac/,
  );
  assert.match(view, /presentation !== 'hidden'/);
  assert.match(view, /is-\$\{view\.approve\.presentation\}/);
  assert.match(owner, /set_tax_knowledge_proposal_review_status/);
  assert.match(owner, /create_corrected_tax_knowledge_proposal/);
});
