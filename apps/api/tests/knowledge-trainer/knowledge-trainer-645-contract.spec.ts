import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-645 reuses generate_tax_knowledge_proposal and owner_view without a parallel path', () => {
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const ownerView = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const allowed = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.pure.ts',
  );
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');

  assert.match(commands, /case 'generate_tax_knowledge_proposal':/);
  assert.equal((commands.match(/case 'generate_tax_knowledge_proposal':/g) ?? []).length, 1);
  assert.match(generate, /parseGenerateTaxKnowledgeProposalDraftId/);
  assert.match(generate, /assertDraftReadyForAiExtraction/);
  assert.match(generate, /TAX_KNOWLEDGE_PROPOSAL_ALREADY_EXISTS/);
  assert.match(generate, /hasExistingProposal/);
  assert.match(generate, /completeStructuredJson/);
  assert.match(generate, /normalizeTaxKnowledgeProposalExtract/);
  assert.match(generate, /validateProposal/);
  assert.match(ownerView, /has_proposal/);
  assert.match(ownerView, /action_key: 'generate_tax_knowledge_proposal'/);
  assert.match(ownerView, /create_disabled_reason/);
  assert.match(read, /generate_enabled:/);
  assert.match(read, /taxKnowledgeProposalAllowedActions/);
  assert.match(allowed, /selectedDraftReviewStatus === 'ready'/);
  assert.match(allowed, /!input.selectedProposalStatus/);
  assert.doesNotMatch(generate, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(generate, /activate_tax_rule_version/);
  assert.doesNotMatch(ownerView, /app\.get\(/);
  assert.doesNotMatch(read, /app\.get\(/);
  assert.doesNotMatch(validator, /owner_view/);
  assert.doesNotMatch(validator, /has_proposal/);
});

test('TAX-645 Owner UI calls the existing command from backend create action only', () => {
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');

  assert.match(ui, /nx-legal-draft-source[\s\S]*Full source region[\s\S]*OwnerTaxKnowledgeProposalView/);
  assert.match(ui, /onCommand=\{onCommand\}/);
  assert.match(trainer, /proposals=\{document\.tax_knowledge_proposals\}/);
  assert.match(view, /view\.create\.action_key/);
  assert.match(view, /legal_text_draft_id: view\.create\.legal_text_draft_id/);
  assert.match(view, /inFlight\.current/);
  assert.match(view, /loc\.analyzing_label/);
  assert.match(view, /loc\.generation_failed/);
  assert.match(view, /loc\.create_disabled_reason/);
  assert.match(view, /view\.approve\.action_key/);
  assert.doesNotMatch(view, /selectedDraftReviewStatus/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(view, /apiJson/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /regenerate/);
  assert.doesNotMatch(trainer, /generate_tax_knowledge_proposal/);
  assert.match(owner, /LEGAL_TEXT_DRAFT_COMMANDS[\s\S]*generate_tax_knowledge_proposal/);
  assert.match(owner, /setPanel\(out\.refreshed\.aggregate\)/);
  assert.doesNotMatch(owner, /onSelectLegalTextDraft[\s\S]{0,200}generate_tax_knowledge_proposal/);
});
