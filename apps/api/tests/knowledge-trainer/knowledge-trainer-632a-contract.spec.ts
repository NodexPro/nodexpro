import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidateStartCursor,
  captureExclusiveSourceBody,
  headingIdsRequiredForCapture,
  nextNonDescendantBoundaryCandidate,
  notesOverlappingDraftSpan,
  type DraftPageEvidence,
  type DraftStructureCandidate,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function candidate(
  id: string,
  sort: number,
  extra: Partial<DraftStructureCandidate> = {},
): DraftStructureCandidate {
  return {
    id,
    sort_order: sort,
    parent_candidate_id: null,
    source_page: 1,
    source_item_start: 0,
    source_item_end: 0,
    source_line_index: 0,
    page_start: 1,
    page_end: 1,
    ...extra,
  };
}

function itemsPage(pageNo: number, texts: string[]): DraftPageEvidence {
  return {
    page_no: pageNo,
    status: 'extracted',
    page_text: texts.join(' '),
    page_text_items: {
      v: 1,
      h: 800,
      items: texts.map((s, i) => ({ i, s, x: 0, y: 700 - i, w: 10, h: 10, fn: '', fs: 10, eol: false, d: '' })),
    },
  };
}

const service = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
const readSrc = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
const types = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
const persist = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
const worker = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
const commands = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');

function fnBody(src: string, name: string, next: string): string {
  const start = src.indexOf(`export async function ${name}`);
  const end = src.indexOf(`export async function ${next}`);
  return src.slice(start, end < 0 ? undefined : end);
}

test('new Draft stores own source and subtree source separately; draft initializes from own only', () => {
  const src = service();
  assert.match(src, /original_source_text: captured\.text/);
  assert.match(src, /draft_legal_text: captured\.text/);
  assert.match(src, /original_subtree_text: captured\.subtree_text/);
  assert.match(src, /original_subtree_page_start: captured\.page_start/);
  assert.match(src, /original_subtree_page_end: captured\.subtree_page_end/);
  assert.match(src, /original_subtree_item_start: captured\.item_start/);
  assert.match(src, /original_subtree_item_end: captured\.subtree_item_end/);
  assert.doesNotMatch(src, /draft_legal_text: captured\.subtree_text/);
  assert.match(types(), /original_subtree_text: string \| null/);
  assert.match(readSrc(), /subtree_source_notes/);
  assert.match(
    readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.ts'),
    /headingIdsRequiredForCapture\(current, ordered\)/,
  );
});

test('parent editable Draft does not duplicate child text; subtree includes descendants and ends at next non-descendant', () => {
  const two = candidate('2-2', 0, { source_item_start: 0 });
  const alef = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 3 });
  const bet = candidate('2-2-b', 2, { parent_candidate_id: '2-2', source_item_start: 6 });
  const three = candidate('2-3', 3, { source_item_start: 9 });
  const ordered = [two, alef, bet, three];
  const pages = [itemsPage(1, ['(2)', 'ריווח', 'מעבודה', '(א)', 'עסק', 'חקלאות', '(ב)', 'משלח', 'יד', '(3)', 'דיבידנד'])];
  const captured = captureExclusiveSourceBody(two, ordered, pages);
  assert.match(captured.text, /ריווח/);
  assert.doesNotMatch(captured.text, /חקלאות/);
  assert.doesNotMatch(captured.text, /משלח/);
  assert.match(captured.subtree_text, /חקלאות/);
  assert.match(captured.subtree_text, /משלח/);
  assert.doesNotMatch(captured.subtree_text, /דיבידנד/);
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-3');
  assert.notEqual(captured.text, captured.subtree_text);
});

test('heading recovery for create is scoped to the capture chain, not all 1839 candidates', () => {
  const root = candidate('root', 0, { source_page: null, source_item_start: null, kind_label: 'חלק', source_display_identifier: "ב'" });
  const current = candidate('seif-2', 1, {
    parent_candidate_id: 'root',
    source_page: null,
    source_item_start: null,
    kind_label: 'סעיף',
    source_display_identifier: '2',
    title: 'מקורות הכנסה',
  });
  const child = candidate('2-1', 2, { parent_candidate_id: 'seif-2', source_item_start: 4 });
  const nnd = candidate('seif-2a', 3, { parent_candidate_id: 'root', source_item_start: 8 });
  const extras = Array.from({ length: 400 }, (_, index) =>
    candidate(`extra-${index}`, 4 + index, {
      parent_candidate_id: 'root',
      source_page: null,
      source_item_start: null,
      page_start: 1,
      page_end: 80,
      kind_label: 'סעיף',
      source_display_identifier: String(index + 3),
    }),
  );
  const ordered = [root, current, child, nnd, ...extras];
  const needed = headingIdsRequiredForCapture(current, ordered);
  assert.equal(needed.has('root'), true);
  assert.equal(needed.has('seif-2'), true);
  assert.equal(needed.has('2-1'), true);
  assert.equal(needed.has('seif-2a'), true);
  assert.equal(needed.has('extra-0'), false);
  assert.ok(needed.size < 8);
  const captured = captureExclusiveSourceBody(current, ordered, [
    itemsPage(1, ['חלק', "ב'", 'סעיף', '2', 'מקורות', 'הכנסה', '(1)', 'עסק', 'סעיף', '2א']),
  ]);
  assert.notEqual(captured.item_start, 0);
  assert.equal(captured.heading_status, 'recovered');
});

test('leaf own/subtree may be identical; null spans recover heading; ambiguous and item-0 stay uncertain', () => {
  const leaf = candidate('2-3', 0, { source_item_start: 0 });
  const leafCapture = captureExclusiveSourceBody(leaf, [leaf], [itemsPage(1, ['(3)', 'דיבידנד'])]);
  assert.equal(leafCapture.text, leafCapture.subtree_text);

  const recovered = candidate('seif-2', 0, {
    source_page: null,
    source_item_start: null,
    page_start: 16,
    kind_label: 'סעיף',
    source_display_identifier: '2',
    title: 'מקורות הכנסה',
  });
  const pages = [
    itemsPage(16, ['פנקסים', 'קבילים', 'סעיף', '2', 'מקורות', 'הכנסה']),
  ];
  const recoveredBody = captureExclusiveSourceBody(recovered, [recovered], pages);
  assert.equal(candidateStartCursor(recovered), null);
  assert.notEqual(recoveredBody.item_start, 0);
  assert.equal(recoveredBody.heading_status, 'recovered');

  const ambiguous = candidate('2-1', 0, {
    source_page: null,
    source_item_start: null,
    page_start: 17,
    printed_marker: '(1)',
    source_display_identifier: '2(1)',
    title: null,
  });
  const ambiguousBody = captureExclusiveSourceBody(
    ambiguous,
    [ambiguous],
    [itemsPage(17, ['(1)', 'עסק', '(1)', 'משכורת'])],
  );
  assert.equal(ambiguousBody.heading_status, 'ambiguous');
  assert.equal(ambiguousBody.boundary_status, 'uncertain');
  assert.equal(ambiguousBody.item_start, null);
});

test('update, identity, boundary, and reset never rewrite original_source_* or original_subtree_*', () => {
  const src = service();
  assert.doesNotMatch(fnBody(src, 'updateLegalTextDraftText', 'updateLegalTextDraftIdentity'), /original_source_|original_subtree_/);
  assert.doesNotMatch(fnBody(src, 'updateLegalTextDraftIdentity', 'reparentLegalTextDraft'), /original_source_|original_subtree_/);
  assert.doesNotMatch(fnBody(src, 'reparentLegalTextDraft', 'setLegalTextDraftBoundary'), /original_source_|original_subtree_/);
  assert.doesNotMatch(fnBody(src, 'setLegalTextDraftBoundary', 'resetLegalTextDraftToSource'), /original_source_|original_subtree_/);
  const resetFn = fnBody(src, 'resetLegalTextDraftToSource', 'setLegalTextDraftReviewStatus');
  assert.match(resetFn, /draft_legal_text: text/);
  assert.match(resetFn, /original_source_text/);
  assert.doesNotMatch(resetFn, /original_source_text:/);
  assert.doesNotMatch(resetFn, /original_subtree_/);
});

test('TAX-629 notes are queried by own and subtree span, not copied; no PDF/worker/canonical write', () => {
  const src = service();
  const read = readSrc();
  assert.match(read, /subtree_source_notes/);
  assert.match(read, /notesOverlappingDraftSpan/);
  assert.doesNotMatch(src, /from\('legal_ingestion_source_notes'\)\s*\.insert/);
  assert.doesNotMatch(src, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(src, /storage\.from\(/);
  assert.doesNotMatch(src, /getBytes\(/);
  assert.doesNotMatch(commands(), /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(src, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(commands(), /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(worker(), /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(persist(), /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(src, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(src, /executeTaxKnowledgeCommand/);
  assert.doesNotMatch(
    types(),
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_legal_text_drafts/,
  );
  const notes = [
    { id: 'own', source_page: 1, source_item_start: 1, source_item_end: 1, inline_link_status: 'linked' },
    { id: 'child-note', source_page: 1, source_item_start: 4, source_item_end: 4, inline_link_status: 'unresolved' },
  ];
  const parent = candidate('2-2', 0, { source_item_start: 0 });
  const child = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 4 });
  const sibling = candidate('2-3', 2, { source_item_start: 8 });
  const captured = captureExclusiveSourceBody(
    parent,
    [parent, child, sibling],
    [itemsPage(1, ['(2)', 'ריווח', '(א)', 'עסק', 'חקלאות', 'x', 'y', 'z', '(3)', 'דיבידנד'])],
  );
  const ownHits = notesOverlappingDraftSpan(notes, {
    page_start: captured.page_start,
    page_end: captured.page_end,
    item_start: captured.item_start,
    item_end: captured.item_end,
  });
  const subtreeHits = notesOverlappingDraftSpan(notes, {
    page_start: captured.page_start,
    page_end: captured.subtree_page_end,
    item_start: captured.item_start,
    item_end: captured.subtree_item_end,
  });
  assert.deepEqual(ownHits.map((row) => row.id), ['own']);
  assert.deepEqual(subtreeHits.map((row) => row.id), ['own', 'child-note']);
});
