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

test('TAX-643/644A reuses selected-draft B2 aggregate owner_view without new reads or TAX-639 changes', () => {
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
  assert.match(ownerView, /מה ה-AI הבין מהחוק\?/);
  assert.match(ownerView, /Что AI понял из закона\?/);
  assert.match(ownerView, /default_locale: 'he'/);
  assert.match(ownerView, /by_locale/);
  assert.doesNotMatch(ownerView, /הכנסה של אזרח ישראלי שהופקה או שנצמחה באזור נחשבת/);
  assert.doesNotMatch(ownerView, /Доход гражданина Израиля, произведённый или возникший в Районе/);
  assert.doesNotMatch(ownerView, /validateTaxKnowledgeProposalV1\(/);
  assert.doesNotMatch(validator, /buildTaxKnowledgeProposalOwnerView/);
  assert.doesNotMatch(validator, /owner_view/);
  assert.doesNotMatch(read, /app\.get\(/);
  assert.doesNotMatch(read, /router\.get\(/);
  assert.doesNotMatch(generate, /buildTaxKnowledgeProposalOwnerView/);
  assert.doesNotMatch(ownerView, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(ownerView, /activate_tax_rule_version/);
});

test('TAX-644A Owner UI renders by_locale locally and does not generate or publish', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');

  assert.match(trainer, /tax_knowledge_proposals/);
  assert.match(ui, /nx-legal-draft-source[\s\S]*Full source region[\s\S]*OwnerTaxKnowledgeProposalView/);
  assert.doesNotMatch(ui, /<\/div>\s*\r?\n\s*<OwnerTaxKnowledgeProposalView/);
  assert.match(view, /by_locale/);
  assert.match(view, /locale_options/);
  assert.match(view, /setLocale/);
  assert.match(view, /details_label/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(view, /JSON\.stringify\(.*proposal_json/);
  assert.doesNotMatch(view, /proposal_json\./);
  assert.match(view, /generate_tax_knowledge_proposal/);
  assert.match(view, /onCommand/);
  assert.match(view, /view\.approve\.action_key/);
  assert.match(view, /view\.approve\.status/);
  assert.doesNotMatch(view, /selectedDraftReviewStatus/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
  assert.doesNotMatch(view, />Approve</);
  assert.doesNotMatch(view, />אישור</);
  assert.doesNotMatch(view, />Подтвердить</);
  assert.match(parser, /parseTaxKnowledgeProposalSlice/);
});

test('TAX-644B presentation is stored outside proposal_json and returned in the existing aggregate', () => {
  const migration = readRepo(
    'supabase/migrations/642_legal_ingestion_tax_knowledge_proposal_owner_presentation.sql',
  );
  const presentation = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-presentation.pure.ts',
  );
  const service = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-presentation.service.ts',
  );
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');

  assert.match(migration, /owner_presentation_json/);
  assert.doesNotMatch(migration, /proposal_json is/);
  assert.match(presentation, /tax_knowledge_proposal_owner_presentation_v1/);
  assert.match(service, /persistTaxKnowledgeProposalOwnerPresentations/);
  assert.match(service, /owner_presentation_json/);
  assert.doesNotMatch(service, /proposal_json:/);
  assert.match(read, /owner_presentation_json/);
  assert.match(read, /buildTaxKnowledgeProposalOwnerView/);
  assert.match(generate, /persistOwnerPresentations/);
  assert.doesNotMatch(generate, /generate_tax_knowledge_proposal accepts/);
  assert.doesNotMatch(validator, /owner_presentation_json/);
  assert.doesNotMatch(validator, /owner_view/);
});
