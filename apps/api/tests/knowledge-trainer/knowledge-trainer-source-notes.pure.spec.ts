import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStructureCandidatesFromLayout } from '../../src/domains/knowledge-trainer/knowledge-trainer-layout.pure.js';
import {
  classifySourceNoteText,
  detectSourceNotesFromLayout,
  extractSourceNotePrintedMarker,
  normalizeSourceMarker,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-source-notes.pure.js';
import {
  amendmentHistoryItems,
  bottomPageFootnoteItems,
  PAGE_HEIGHT,
  realHeadingItems,
} from './fixtures/layout-evidence-fixtures.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סעיף' },
];

function item(partial: { s: string; x?: number; y?: number; fs?: number; i?: number; eol?: boolean }) {
  return {
    i: partial.i ?? 0,
    s: partial.s,
    x: partial.x ?? 40,
    y: partial.y ?? 700,
    w: 80,
    h: 12,
    fn: 'Times',
    fs: partial.fs ?? 12,
    eol: partial.eol === true,
    d: 'rtl',
  };
}

test('TAX-629 classification is evidence-only and does not reuse relationship_intent', () => {
  assert.equal(classifySourceNoteText("139 – תיקון מס' (504 עמ' 34 ה\"ח)"), 'amendment_history');
  assert.equal(classifySourceNoteText('ס"ח תשס"ד מס\' 1943'), 'publication_citation');
  assert.equal(classifySourceNoteText('לענין תחילה בלבד'), 'editorial_note');
  assert.equal(classifySourceNoteText('¹ תקנות מס הכנסה'), 'legal_reference_candidate');
  assert.equal(classifySourceNoteText('הערה כללית בלי סממן'), 'unknown');
  const src = readFileSync(join(repoRoot, 'apps/api/src/domains/knowledge-trainer/knowledge-trainer-source-notes.pure.ts'), 'utf8');
  assert.doesNotMatch(src, /relationship_intent/);
  assert.doesNotMatch(src, /tax_rule_unresolved_legal_references/);
});

test('structure heading keeps backend source span from page_text_items', () => {
  const { drafts } = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 16,
        text: 'flattened',
        layout: { v: 1, h: PAGE_HEIGHT, items: realHeadingItems },
      },
    ],
    catalog,
  );
  const seif = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '39');
  assert.ok(seif);
  assert.equal(seif.source_page, 16);
  assert.equal(seif.page_start, 16);
  assert.equal(seif.source_item_start, 3);
  assert.equal(seif.source_item_end, 4);
  assert.equal(seif.source_line_index != null, true);
  assert.ok(seif.source_bbox);
  assert.equal('char_offset' in seif, false);
});

test('apparatus and footnotes are source notes, not structure, including 39/256/514 noise', () => {
  const pages = [
    {
      page_no: 12,
      text: 'ignored flattened לפי סעיף 39 תיקון מס 256 עמ 514',
      layout: {
        v: 1 as const,
        h: PAGE_HEIGHT,
        items: [
          item({ s: 'סעיף', y: 640, fs: 13, i: 0 }),
          item({ s: '1', y: 640, fs: 13, i: 1 }),
          item({ s: 'הגדרות', y: 640, fs: 13, i: 2, eol: true }),
          item({ s: 'לפי סעיף 39 לא יחול המס', y: 520, fs: 11, i: 3 }),
          ...amendmentHistoryItems.map((row, index) => ({ ...row, i: 4 + index })),
          ...bottomPageFootnoteItems.map((row) => ({ ...row, i: 20 })),
        ],
      },
    },
  ];
  const structure = detectStructureCandidatesFromLayout(pages, catalog);
  assert.equal(structure.drafts.some((row) => row.node_number === '1' && row.kind_label === 'סעיף'), true);
  assert.equal(structure.drafts.some((row) => row.node_number === '39'), false);
  assert.equal(structure.drafts.some((row) => row.node_number === '256'), false);
  assert.equal(structure.drafts.some((row) => row.node_number === '514'), false);
  const notes = detectSourceNotesFromLayout(pages);
  assert.equal(notes.notes.some((note) => /תיקון\s*מס/.test(note.note_text)), true);
  assert.equal(notes.notes.some((note) => /עמ['׳"]?\s*514/.test(note.note_text) || note.note_text.includes('514')), true);
  assert.equal(notes.notes.some((note) => note.note_text.includes('הערת שוליים')), true);
  assert.equal(notes.notes.every((note) => note.review_status === 'needs_review' || note.review_status === 'unresolved'), true);
});

test('apparatus-zone pages become source notes and stay non-structure', () => {
  const items = Array.from({ length: 12 }, (_, index) =>
    item({
      s: `${140 + index} – תיקון מס' ( 490 עמ' 107 ה"ח הממשלה ) 441 עמ' ס"ח תשס"ד`,
      y: 800 - index * 12,
      fs: 11,
      i: index,
    }),
  );
  const pages = [{ page_no: 300, text: 'apparatus', layout: { v: 1 as const, h: PAGE_HEIGHT, items } }];
  const structure = detectStructureCandidatesFromLayout(pages, catalog);
  assert.equal(structure.drafts.length, 0);
  const notes = detectSourceNotesFromLayout(pages);
  assert.ok(notes.notes.length >= 8);
  assert.equal(notes.notes.every((note) => note.origin_zone === 'apparatus_zone'), true);
  assert.equal(notes.notes.some((note) => note.classification === 'amendment_history'), true);
  assert.equal(notes.notes[0]?.source_page, 300);
  assert.equal(notes.notes[0]?.source_item_start != null, true);
});

test('unique inline marker links to the source note; uncertain links are not invented; notes are kept', () => {
  const linkedPages = [
    {
      page_no: 17,
      text: 'body',
      layout: {
        v: 1 as const,
        h: PAGE_HEIGHT,
        items: [
          item({ s: 'הכנסה חייבת', y: 600, fs: 13, i: 0 }),
          item({ s: '¹', y: 600, fs: 7, i: 1, x: 200 }),
          item({ s: '¹ תקנות מס הכנסה (נוסח חדש)', y: 40, fs: 8, i: 2 }),
        ],
      },
    },
  ];
  const linked = detectSourceNotesFromLayout(linkedPages);
  const note = linked.notes.find((row) => row.note_text.includes('תקנות מס הכנסה'));
  assert.ok(note);
  assert.equal(note.inline_link_status, 'linked');
  assert.equal(note.anchors.length, 1);
  assert.equal(note.anchors[0]?.link_status, 'linked');
  assert.equal(normalizeSourceMarker(note.anchors[0]?.printed_marker), '1');
  assert.equal(extractSourceNotePrintedMarker(note.note_text), '¹');

  const missingPages = [
    {
      page_no: 18,
      text: 'body',
      layout: {
        v: 1 as const,
        h: PAGE_HEIGHT,
        items: [item({ s: '¹ תקנות מס הכנסה בלי עוגן בגוף', y: 40, fs: 8, i: 0 })],
      },
    },
  ];
  const missing = detectSourceNotesFromLayout(missingPages);
  assert.equal(missing.notes.length, 1);
  assert.equal(missing.notes[0]?.inline_link_status, 'missing_anchor');
  assert.equal(missing.unresolved_anchors.length, 0);

  const orphanPages = [
    {
      page_no: 19,
      text: 'body',
      layout: {
        v: 1 as const,
        h: PAGE_HEIGHT,
        items: [
          item({ s: 'הכנסה', y: 600, fs: 13, i: 0 }),
          item({ s: '²', y: 600, fs: 7, i: 1, x: 180 }),
        ],
      },
    },
  ];
  const orphan = detectSourceNotesFromLayout(orphanPages);
  assert.equal(orphan.notes.length, 0);
  assert.equal(orphan.unresolved_anchors.length, 1);
  assert.equal(orphan.unresolved_anchors[0]?.link_status, 'unresolved');
});

test('TOC Go lines are not stored as source notes', () => {
  const pages = [
    {
      page_no: 1,
      text: 'toc',
      layout: {
        v: 1 as const,
        h: PAGE_HEIGHT,
        items: [
          item({ s: '77 Go חישוב הריבית הריאלית 15 סעיף', y: 80, fs: 12, i: 0 }),
          item({ s: '268 Go לוח ההשוואה לסעיפי הנוסח הישן', y: 40, fs: 10, i: 1 }),
        ],
      },
    },
  ];
  const notes = detectSourceNotesFromLayout(pages);
  assert.equal(notes.notes.length, 0);
});
