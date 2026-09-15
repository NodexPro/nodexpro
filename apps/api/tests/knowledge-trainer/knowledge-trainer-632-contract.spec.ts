import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureExclusiveSourceBody,
  firstDescendantBoundaryCandidate,
  nextNonDescendantBoundaryCandidate,
  notesOverlappingDraftSpan,
  type DraftPageEvidence,
  type DraftStructureCandidate,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/632_legal_ingestion_draft_subtree_source.sql';
const sql630Rel = 'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql';

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

test('TAX-632 is additive Trainer schema and does not rewrite 630', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  assert.equal(existsSync(join(repoRoot, sql630Rel)), true);
  const sql = readRepo(sqlRel);
  const sql630 = readRepo(sql630Rel);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /ADDITIVE ONLY/);
  assert.match(sql, /Does not drop, rewrite, or edit migration 630/);
  assert.doesNotMatch(sql630, /original_subtree_/);
  assert.match(sql630, /original_source_text text not null default ''/);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
});

test('original_source_text and original_subtree_text are separate fields', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /add column if not exists original_subtree_text text null/);
  assert.match(sql, /original_source_\* += immutable OWN-NODE source evidence/);
  assert.match(sql, /original_subtree_\* += immutable FULL SUBTREE source evidence/);
  assert.match(sql, /draft_legal_text += Owner-editable OWN-NODE legal text/);
  assert.match(sql, /Distinct from original_subtree_text/);
});

test('original_subtree fields are immutable after insert, including legacy NULL', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /original subtree evidence is immutable/);
  assert.match(sql, /new\.original_subtree_text is distinct from old\.original_subtree_text/);
  assert.match(sql, /new\.original_subtree_page_start is distinct from old\.original_subtree_page_start/);
  assert.match(sql, /new\.original_subtree_page_end is distinct from old\.original_subtree_page_end/);
  assert.match(sql, /new\.original_subtree_item_start is distinct from old\.original_subtree_item_start/);
  assert.match(sql, /new\.original_subtree_item_end is distinct from old\.original_subtree_item_end/);
  assert.match(sql, /new\.original_subtree_line_start is distinct from old\.original_subtree_line_start/);
  assert.match(sql, /new\.original_subtree_line_end is distinct from old\.original_subtree_line_end/);
  assert.match(sql, /including legacy NULL subtree fields/);
  assert.match(sql, /No silent recapture or backfill/);
});

test('legacy drafts remain valid with null subtree fields; no automatic backfill', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /NULL for legacy\/smoke drafts/);
  assert.match(sql, /original_subtree_text text null/);
  assert.match(sql, /NULL on legacy drafts \(no backfill\)/);
  assert.doesNotMatch(sql, /set original_subtree_text/i);
  assert.doesNotMatch(sql, /coalesce\(original_source_text/);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_legal_text_drafts/i);
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  function fnBody(name: string, next: string): string {
    const start = service.indexOf(`export async function ${name}`);
    const end = service.indexOf(`export async function ${next}`);
    return service.slice(start, end < 0 ? undefined : end);
  }
  assert.doesNotMatch(fnBody('updateLegalTextDraftText', 'updateLegalTextDraftIdentity'), /original_subtree_/);
  assert.doesNotMatch(fnBody('resetLegalTextDraftToSource', 'setLegalTextDraftReviewStatus'), /original_subtree_/);
});

test('draft_legal_text remains OWN-NODE editable text; subtree is not an editable copy', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /Owner-editable OWN-NODE legal text/);
  assert.match(sql, /Must not duplicate descendant editable text/);
  assert.match(sql, /Not editable\. Not a copy of child draft_legal_text/);
  assert.match(sql, /2\(2\)\.draft_legal_text must not duplicate/);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  assert.match(types, /draft_legal_text: string/);
  assert.doesNotMatch(types, /subtree_legal_text/);
});

test('leaf nodes may have identical own and subtree source regions', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /Leaf nodes may equal original_source_text/);
  assert.match(sql, /A leaf node may have identical own and subtree source regions/);
  assert.doesNotMatch(sql, /original_subtree_text is distinct from original_source_text/);
  const leaf = candidate('2-3', 0, { source_item_start: 0, source_item_end: 0 });
  const pages = [itemsPage(1, ['(3)', 'דיבידנד'])];
  const captured = captureExclusiveSourceBody(leaf, [leaf], pages);
  assert.equal(captured.text, captured.subtree_text);
  assert.match(captured.text, /דיבידנד/);
});

test('structure_run and candidate deletion cannot delete subtree evidence', () => {
  const sql630 = readRepo(sql630Rel);
  const sql = readRepo(sqlRel);
  assert.match(
    sql630,
    /structure_run_id uuid null references public\.legal_ingestion_structure_runs\(id\) on delete set null/,
  );
  assert.match(
    sql630,
    /source_candidate_id uuid null references public\.legal_ingestion_candidates\(id\) on delete set null/,
  );
  assert.match(sql, /ON DELETE SET NULL provenance/);
  assert.match(sql, /cannot cascade-delete or overwrite subtree evidence/);
  assert.doesNotMatch(sql, /on delete cascade/i);
  assert.doesNotMatch(sql, /drop column original_source_text/i);
  assert.doesNotMatch(sql, /drop table public\.legal_ingestion_legal_text_drafts/i);
});

test('source notes are not copied into Draft storage; subtree span supports later overlap lookup', () => {
  const sql = readRepo(sqlRel);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_source_notes/);
  assert.doesNotMatch(sql, /create table if not exists public\.legal_ingestion_source_notes/);
  assert.match(sql, /Does not copy 629 source notes into this table/);
  assert.match(sql, /overlap keys for later TAX-629 note\/reference lookup/);
  assert.match(sql, /original_subtree_page_start/);
  assert.match(sql, /original_subtree_page_end/);
  assert.match(sql, /original_subtree_item_start/);
  assert.match(sql, /original_subtree_item_end/);
  const parent = candidate('2-2', 0, { source_item_start: 0 });
  const child = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 4 });
  const sibling = candidate('2-3', 2, { source_item_start: 8 });
  const pages = [itemsPage(1, ['(2)', 'ריווח', '(א)', 'עסק', 'חקלאות', 'x', 'y', 'z', '(3)', 'דיבידנד'])];
  const captured = captureExclusiveSourceBody(parent, [parent, child, sibling], pages);
  const notes = [
    { id: 'own', source_page: 1, source_item_start: 1, source_item_end: 1, inline_link_status: 'linked' },
    { id: 'child-note', source_page: 1, source_item_start: 4, source_item_end: 4, inline_link_status: 'unresolved' },
    { id: 'after', source_page: 1, source_item_start: 8, source_item_end: 8, inline_link_status: 'linked' },
  ];
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

test('TAX-632 stores no PDF/blob, grants no worker ownership, and does not write canonical law', () => {
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  assert.doesNotMatch(sql, /bytea|pdf_bytes|file_base64|storage_key/);
  assert.doesNotMatch(sql, /add column if not exists original_subtree_bbox/);
  assert.match(sql, /No original_subtree_bbox/);
  assert.match(sql, /Does not store PDF bytes/);
  assert.match(sql, /Worker\/detector must not write these columns/);
  assert.doesNotMatch(types, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_legal_text_drafts/,
  );
  assert.doesNotMatch(worker, /original_subtree_/);
  assert.doesNotMatch(persist, /original_subtree_/);
  assert.doesNotMatch(persist, /legal_ingestion_legal_text_drafts/);
});

test('TAX-631B own/subtree boundary engine is preserved for the next create wiring', () => {
  const parent = candidate('2-2', 0, { source_item_start: 0 });
  const alef = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 3 });
  const bet = candidate('2-2-b', 2, { parent_candidate_id: '2-2', source_item_start: 6 });
  const three = candidate('2-3', 3, { source_item_start: 9 });
  const ordered = [parent, alef, bet, three];
  assert.equal(firstDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-2-a');
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-3');
  const pages = [itemsPage(1, ['(2)', 'ריווח', 'מעבודה', '(א)', 'עסק', 'חקלאות', '(ב)', 'משלח', 'יד', '(3)', 'דיבידנד'])];
  const captured = captureExclusiveSourceBody(parent, ordered, pages);
  assert.match(captured.text, /ריווח/);
  assert.doesNotMatch(captured.text, /חקלאות/);
  assert.match(captured.subtree_text, /חקלאות/);
  assert.doesNotMatch(captured.subtree_text, /דיבידנד/);
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  assert.match(service, /original_source_text: captured\.text/);
  assert.match(service, /draft_legal_text: captured\.text/);
  assert.match(service, /original_subtree_text: captured\.subtree_text/);
  assert.doesNotMatch(service, /draft_legal_text: captured\.subtree_text/);
});
