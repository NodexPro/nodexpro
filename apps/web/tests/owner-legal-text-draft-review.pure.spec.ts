import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { nestLegalTextDrafts } from '../src/pages/owner-legal-text-draft-review.pure.ts';

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
  assert.match(ui, /Draft legal text/);
  assert.match(ui, /nx-legal-draft-textarea/);
  assert.match(ui, /update_legal_text_draft_text/);
  assert.match(ui, /update_legal_text_draft_identity/);
  assert.match(ui, /reparent_legal_text_draft/);
  assert.match(ui, /set_legal_text_draft_boundary/);
  assert.match(ui, /reset_legal_text_draft_to_source/);
  assert.match(ui, /set_legal_text_draft_review_status/);
  assert.match(ui, /create_legal_text_draft_from_candidate/);
  assert.match(ui, /legal_identifier: legalIdentifier/);
  assert.match(ui, /Reset text to original source/);
  assert.match(ui, /Open original PDF/);
  assert.match(ui, /legalTrainingDocumentFile/);
  assert.match(ui, /Source references/);
  assert.match(ui, /unresolved/);
  assert.match(ui, /READY means this Owner Draft was reviewed/);
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
