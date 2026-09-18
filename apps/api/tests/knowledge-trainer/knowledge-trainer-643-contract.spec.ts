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

test('TAX-643 reuses selected-draft B2 aggregate and adds owner_view without new reads or TAX-639 changes', () => {
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');
  const ownerView = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );

  assert.match(read, /loadTaxKnowledgeProposalsForSelectedDraft/);
  assert.match(read, /buildTaxKnowledgeProposalOwnerView/);
  assert.match(read, /owner_view:/);
  assert.match(types, /owner_view: TaxKnowledgeProposalOwnerViewDto/);
  assert.match(ownerView, /What did AI understand from this law\?/);
  assert.match(ownerView, /No AI proposal yet \/ טרם נוצרה הצעת AI/);
  assert.doesNotMatch(ownerView, /validateTaxKnowledgeProposalV1\(/);
  assert.doesNotMatch(validator, /buildTaxKnowledgeProposalOwnerView/);
  assert.doesNotMatch(validator, /owner_view/);
  assert.doesNotMatch(read, /app\.get\(/);
  assert.doesNotMatch(read, /router\.get\(/);
  assert.doesNotMatch(generate, /buildTaxKnowledgeProposalOwnerView/);
  assert.doesNotMatch(ownerView, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(ownerView, /activate_tax_rule_version/);
});

test('TAX-643 Owner UI renders backend owner_view only and does not generate or publish', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');

  assert.match(trainer, /tax_knowledge_proposals/);
  assert.match(ui, /OwnerTaxKnowledgeProposalView/);
  assert.match(view, /owner_view/);
  assert.match(view, /view\.heading/);
  assert.match(view, /empty_title/);
  assert.match(view, /understanding_summary/);
  assert.match(view, /technical_title/);
  assert.doesNotMatch(view, /JSON\.stringify\(.*proposal_json/);
  assert.doesNotMatch(view, /proposal_json\./);
  assert.doesNotMatch(ui, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(trainer, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
  assert.doesNotMatch(view, /owner_approved/);
  assert.match(parser, /parseTaxKnowledgeProposalSlice/);
});
