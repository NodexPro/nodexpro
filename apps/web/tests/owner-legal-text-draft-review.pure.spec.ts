import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { nestLegalTextDrafts, nestLegalTextReviewNodes } from '../src/pages/owner-legal-text-draft-review.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('nestLegalTextDrafts uses backend parent_draft_id only', () => {
  const tree = nestLegalTextDrafts([
    { id: 'chelek', parent_draft_id: null, display_identifier: "חלק ב'" },
    { id: 'perek', parent_draft_id: 'chelek', display_identifier: 'פרק ראשון' },
    { id: 'seif2', parent_draft_id: 'perek', display_identifier: '2' },
    { id: 'a', parent_draft_id: 'seif2', display_identifier: '2(1)' },
    { id: 'b', parent_draft_id: 'seif2', display_identifier: '2(2)' },
    { id: 'ba', parent_draft_id: 'b', display_identifier: '2(2)(א)' },
    { id: 'bb', parent_draft_id: 'b', display_identifier: '2(2)(ב)' },
    { id: 'c', parent_draft_id: 'seif2', display_identifier: '2(3)' },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.display_identifier, "חלק ב'");
  const seif2 = tree[0]?.children[0]?.children[0];
  assert.equal(seif2?.display_identifier, '2');
  assert.deepEqual(
    seif2?.children.map((row) => row.display_identifier),
    ['2(1)', '2(2)', '2(3)'],
  );
  assert.deepEqual(
    seif2?.children[1]?.children.map((row) => row.display_identifier),
    ['2(2)(א)', '2(2)(ב)'],
  );
});

test('TAX-633 Owner Draft UI is aggregate-only, command-only, and bidi-safe', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const panel = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(ui, /Original source — read only/);
  assert.match(ui, /nx-legal-draft-readonly/);
  assert.match(ui, /Full source region/);
  assert.match(ui, /Editable legal text/);
  assert.match(ui, /nx-legal-draft-textarea/);
  assert.match(ui, /update_legal_text_draft_text/);
  assert.match(ui, /update_legal_text_draft_identity/);
  assert.match(ui, /reparent_legal_text_draft/);
  assert.match(ui, /set_legal_text_draft_boundary/);
  assert.match(ui, /reset_legal_text_draft_to_source/);
  assert.match(ui, /set_legal_text_draft_review_status/);
  assert.match(ui, /create_legal_text_draft_from_candidate/);
  assert.match(ui, /legal_identifier: legalIdentifier/);
  assert.match(ui, /Reset text from original/);
  assert.match(ui, /Open original PDF/);
  assert.match(ui, /legalTrainingDocumentFile/);
  assert.match(ui, /Source references/);
  assert.match(ui, /unresolved/);
  assert.match(ui, /Reviewed \/ נבדק means the Owner checked this Draft against source/);
  assert.match(ui, /LegalIdentifierText/);
  assert.match(ui, /Source boundary needs review/);
  assert.doesNotMatch(ui, /parseLegalIdentifier/);
  assert.doesNotMatch(ui, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(ui, /from\('legal_ingestion/);
  assert.doesNotMatch(ui, /original_file_access/);
  assert.doesNotMatch(ui, /Create all|bulk create|create_all_legal_text_drafts/i);
  assert.doesNotMatch(ui, /accept_legal_structure_candidate|activate_tax_legal_node|tax_legal_nodes/);
  assert.match(ui, /pdfOpen && pdfUrl/);

  assert.match(trainer, /OwnerLegalTextDraftReview/);
  assert.match(trainer, /workspace === 'draft'/);
  assert.match(trainer, /workspace !== 'structure'/);
  assert.match(trainer, /create_legal_text_draft_from_candidate/);
  assert.doesNotMatch(trainer, /legalTrainingDocumentFile/);
  assert.match(panel, /tax_knowledge_trainer_legal_text_draft_id/);
  assert.match(css, /nx-legal-draft-review-grid/);
  assert.match(css, /nx-btn-taxes-compact/);
});

test('nestLegalTextReviewNodes uses backend parent_id only', () => {
  const tree = nestLegalTextReviewNodes([
    { id: 'chelek', parent_id: null },
    { id: 'perek', parent_id: 'chelek' },
    { id: 'seif2', parent_id: 'perek' },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.children[0]?.children[0]?.id, 'seif2');
});

test('TAX-634 Owner Draft workspace is a human legal-review screen', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const library = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');

  assert.match(ui, /Law tree/);
  assert.match(ui, /Where am I in the law\?/);
  assert.match(ui, /What did the original source say\?/);
  assert.match(ui, /What text will I keep or correct\?/);
  assert.match(ui, /Have I reviewed this node\?/);
  assert.match(ui, /Owner version/);
  assert.match(ui, /Editable legal text/);
  assert.match(ui, /Reset text from original/);
  assert.match(ui, /Mark reviewed \/ נבדק/);
  assert.match(ui, /Needs review \/ דורש בדיקה/);
  assert.match(ui, /prepare_legal_text_drafts_for_structure/);
  assert.match(ui, /Technical details \/ Advanced source correction/);
  assert.match(ui, /nx-legal-draft-readonly/);
  assert.match(ui, /review_status: 'ready'/);
  assert.doesNotMatch(ui, /<option value="ready">ready<\/option>/);
  assert.doesNotMatch(ui, /for \(const .* of .*(frontier|reviewTree|drafts)/);
  assert.doesNotMatch(ui, /while \(.*not_prepared/);
  assert.match(library, /Show legal library \(canonical \/ test inventory\)/);
  assert.match(library, /draftWorkspaceOpen/);
  assert.match(trainer, /legal_text_review_tree/);
  assert.match(trainer, /useState<'draft' \| 'structure'>\('draft'\)/);
});

