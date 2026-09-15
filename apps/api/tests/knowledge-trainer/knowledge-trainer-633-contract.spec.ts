import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftCreateFrontier } from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const read = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
const commands = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
const draftService = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
const routes = () => readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
const models = () => readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');

test('TAX-633 aggregate keeps draft tree lightweight and selected draft detailed', () => {
  const src = read();
  assert.match(src, /LEGAL_TEXT_DRAFT_LIST_SELECT/);
  assert.match(src, /LEGAL_TEXT_DRAFT_DETAIL_SELECT/);
  assert.match(src, /selected_legal_text_draft/);
  assert.match(src, /legal_text_draft_create_frontier/);
  assert.match(src, /pickSelectedDraftId/);
  assert.match(src, /opts\?\.legal_text_draft_id/);
  const list = src.slice(src.indexOf('const LEGAL_TEXT_DRAFT_LIST_SELECT'), src.indexOf('const LEGAL_TEXT_DRAFT_DETAIL_SELECT'));
  assert.doesNotMatch(list, /original_source_text/);
  assert.doesNotMatch(list, /original_subtree_text/);
  assert.doesNotMatch(list, /draft_legal_text/);
  assert.match(src, /LEGAL_TEXT_DRAFT_DETAIL_SELECT = `\$\{LEGAL_TEXT_DRAFT_LIST_SELECT\}, original_source_text, original_subtree_text, draft_legal_text`/);
  assert.match(models(), /tax_knowledge_trainer_legal_text_draft_id/);
  assert.match(routes(), /tax_knowledge_trainer_legal_text_draft_id/);
  assert.match(commands(), /tax_knowledge_trainer_legal_text_draft_id: legalTextDraftId/);
});

test('TAX-633 parent-first frontier does not bulk-create drafts', () => {
  const parent = { id: 'parent-cand', parent_candidate_id: null, kind_label: 'פרק', source_display_identifier: 'פרק ראשון' };
  const child = { id: 'child-cand', parent_candidate_id: 'parent-cand', kind_label: 'סעיף', source_display_identifier: '2' };
  const sibling = { id: 'sib-cand', parent_candidate_id: 'parent-cand', kind_label: 'סעיף', source_display_identifier: '3' };
  const frontierBeforeParent = draftCreateFrontier([parent, child, sibling], []);
  assert.deepEqual(
    frontierBeforeParent.map((row) => row.candidate_id),
    ['parent-cand'],
  );
  const frontierAfterParent = draftCreateFrontier(
    [parent, child, sibling],
    [{ id: 'parent-draft', source_candidate_id: 'parent-cand' }],
  );
  assert.deepEqual(
    frontierAfterParent.map((row) => row.candidate_id).sort(),
    ['child-cand', 'sib-cand'],
  );
  assert.equal(frontierAfterParent.every((row) => row.parent_draft_required === false), true);
  const service = draftService();
  const createFn = service.slice(
    service.indexOf('export async function createLegalTextDraftFromCandidate'),
    service.indexOf('export async function updateLegalTextDraftText'),
  );
  assert.doesNotMatch(createFn, /for \(const/);
  assert.doesNotMatch(service, /bulkCreate|create_all_legal_text_drafts|createAllDrafts/);
});

test('TAX-633 PDF open is explicit GET file; trainer read never downloads Storage bytes', () => {
  assert.doesNotMatch(read(), /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(read(), /\.download\(/);
  assert.match(read(), /createOwnerLegalMaterialSignedUrl/);
  assert.match(commands(), /openLegalTrainingDocumentFile/);
  assert.match(readRepo('apps/api/src/routes/owner-knowledge-trainer.routes.ts'), /\/legal-training\/documents\/:id\/file/);
});

test('TAX-633 does not write canonical law, rebuild structure, or add a migration', () => {
  assert.doesNotMatch(draftService(), /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(draftService(), /from\('tax_rules'\)/);
  assert.doesNotMatch(draftService(), /from\('tax_rule_relationships'\)/);
  assert.doesNotMatch(commands(), /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(draftService(), /persistStructureCandidatesForJob/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/633_owner_legal_draft_review.sql')), false);
});
