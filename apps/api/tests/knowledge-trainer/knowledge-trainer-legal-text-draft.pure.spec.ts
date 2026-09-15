import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegalIdentifier } from '../../src/domains/tax-knowledge/legal-identifier.pure.js';
import {
  candidateStartCursor,
  captureExclusiveSourceBody,
  captureOwnerDefinedSourceBody,
  compareLayoutCursors,
  createDraftRequiresParentFirst,
  displayDraftLabel,
  draftIdentityKey,
  draftWouldCycle,
  findDraftIdentityConflict,
  firstDescendantBoundaryCandidate,
  hierarchyRankCompatible,
  nextNonDescendantBoundaryCandidate,
  notesOverlappingDraftSpan,
  parentFirstMissingCandidates,
  reparentScopeError,
  validateDraftReady,
  buildLegalTextReviewNodes,
  legalTextReviewStateFromDraft,
  legalTextReviewStateLabel,
  type DraftPageEvidence,
  type DraftStructureCandidate,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סעיף' },
  { id: '4', label: 'סעיף קטן' },
  { id: '5', label: 'פסקה' },
];

function itemsPage(
  pageNo: number,
  texts: string[],
  extra: { status?: string; yForIndex?: (index: number) => number } = {},
): DraftPageEvidence {
  return {
    page_no: pageNo,
    status: extra.status ?? 'extracted',
    page_text: texts.join(' '),
    page_text_items: {
      v: 1,
      h: 800,
      items: texts.map((s, i) => ({
        i,
        s,
        x: i * 12,
        y: extra.yForIndex ? extra.yForIndex(i) : 700 - i,
        w: 10,
        h: 10,
        fn: '',
        fs: 10,
        eol: false,
        d: '',
      })),
    },
  };
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

test('exclusive body stops at the next heading and does not copy children into the parent', () => {
  const seif2 = candidate('seif-2', 0, { source_item_start: 0, source_item_end: 2 });
  const child1 = candidate('2-1', 1, { parent_candidate_id: 'seif-2', source_item_start: 4, source_item_end: 4 });
  const child2 = candidate('2-2', 2, { parent_candidate_id: 'seif-2', source_item_start: 8, source_item_end: 8 });
  const pages = [
    itemsPage(1, ['סעיף', '2', 'מקורות', 'הכנסה', '(1)', 'משכורת', 'או', 'שכר', '(2)', 'עסק']),
  ];
  const ordered = [seif2, child1, child2];
  const parentBody = captureExclusiveSourceBody(seif2, ordered, pages);
  const firstChild = captureExclusiveSourceBody(child1, ordered, pages);
  const secondChild = captureExclusiveSourceBody(child2, ordered, pages);
  assert.equal(parentBody.boundary_status, 'certain');
  assert.match(parentBody.text, /מקורות/);
  assert.doesNotMatch(parentBody.text, /משכורת/);
  assert.doesNotMatch(parentBody.text, /עסק/);
  assert.match(firstChild.text, /משכורת/);
  assert.doesNotMatch(firstChild.text, /עסק/);
  assert.match(secondChild.text, /עסק/);
  assert.doesNotMatch(secondChild.text, /משכורת/);
});

test('missing source spans are uncertain and never fabricate OCR text', () => {
  const heading = candidate('a', 0, {
    source_page: null,
    source_item_start: null,
    source_item_end: null,
    page_start: null,
    page_end: null,
  });
  const captured = captureExclusiveSourceBody(heading, [heading], []);
  assert.equal(captured.boundary_status, 'uncertain');
  assert.equal(captured.text, '');
});

test('3(ט1) and 3(ט)(1) remain distinct identities under the same parent', () => {
  const tet1 = parseLegalIdentifier('3(ט1)');
  const tetThen1 = parseLegalIdentifier('3(ט)(1)');
  assert.ok(tet1 && tetThen1);
  assert.notEqual(tet1.normalized_machine_identifier, tetThen1.normalized_machine_identifier);
  const left = {
    id: 'a',
    parent_draft_id: 'parent',
    kind_label: 'סעיף קטן',
    normalized_machine_identifier: tet1.normalized_machine_identifier,
  };
  const right = {
    id: 'b',
    parent_draft_id: 'parent',
    kind_label: 'סעיף קטן',
    normalized_machine_identifier: tetThen1.normalized_machine_identifier,
  };
  assert.equal(findDraftIdentityConflict(left, [right]), null);
});

test('(1) under different parents is allowed; same parent duplicate is rejected', () => {
  const one = parseLegalIdentifier('2(1)')!;
  const a = {
    id: 'child-a',
    parent_draft_id: 'parent-2',
    kind_label: 'פסקה',
    normalized_machine_identifier: one.normalized_machine_identifier,
  };
  const otherParent = {
    id: 'child-b',
    parent_draft_id: 'parent-4a',
    kind_label: 'פסקה',
    normalized_machine_identifier: one.normalized_machine_identifier,
  };
  const sameParent = {
    id: 'child-c',
    parent_draft_id: 'parent-2',
    kind_label: 'פסקה',
    normalized_machine_identifier: one.normalized_machine_identifier,
  };
  assert.equal(findDraftIdentityConflict(a, [otherParent]), null);
  assert.equal(findDraftIdentityConflict(a, [sameParent])?.id, 'child-c');
  assert.notEqual(draftIdentityKey(a), draftIdentityKey(otherParent));
});

test('reparent rejects cycles and cross-document parents', () => {
  const rows = [
    { id: 'root', parent_draft_id: null, document_id: 'doc-a', country_code: 'IL', kind_label: 'סעיף' },
    { id: 'child', parent_draft_id: 'root', document_id: 'doc-a', country_code: 'IL', kind_label: 'סעיף קטן' },
    { id: 'other-doc', parent_draft_id: null, document_id: 'doc-b', country_code: 'IL', kind_label: 'סעיף' },
  ];
  assert.equal(draftWouldCycle('root', 'child', rows), true);
  assert.equal(draftWouldCycle('child', 'root', rows), false);
  assert.equal(draftWouldCycle('child', 'child', rows), true);
  assert.match(reparentScopeError({ id: 'child', document_id: 'doc-a', country_code: 'IL' }, rows[2]) ?? '', /same document/);
});

test('hierarchy compatibility uses catalog rank; 4א(א)(1) may sit under 4א(א)', () => {
  assert.equal(hierarchyRankCompatible('פסקה', 'סעיף קטן', catalog), true);
  assert.equal(hierarchyRankCompatible('סעיף', 'פסקה', catalog), false);
  assert.equal(hierarchyRankCompatible('סעיף קטן', null, catalog), false);
});

test('uncertain boundary cannot become ready; owner-defined empty source may', () => {
  const base = {
    source_display_identifier: '2(1)',
    kind_label: 'פסקה',
    parent_draft_id: 'seif-2',
    draft_legal_text: 'משכורת',
    original_source_text: 'משכורת',
    identityConflict: false,
    hierarchyCompatible: true,
  };
  assert.equal(validateDraftReady({ ...base, text_boundary_status: 'uncertain' }).ok, false);
  assert.equal(validateDraftReady({ ...base, text_boundary_status: 'certain' }).ok, true);
  assert.equal(
    validateDraftReady({
      ...base,
      draft_legal_text: '',
      original_source_text: '',
      text_boundary_status: 'uncertain',
    }).ok,
    false,
  );
  assert.equal(
    validateDraftReady({
      ...base,
      draft_legal_text: '',
      original_source_text: '',
      text_boundary_status: 'owner_defined',
    }).ok,
    true,
  );
});

test('source notes overlap a draft span without being copied', () => {
  const notes = [
    { id: 'n1', source_page: 1, source_item_start: 5, source_item_end: 5, inline_link_status: 'linked' },
    { id: 'n2', source_page: 2, source_item_start: 1, source_item_end: 1, inline_link_status: 'unresolved' },
  ];
  const hit = notesOverlappingDraftSpan(notes, { page_start: 1, page_end: 1, item_start: 0, item_end: 10 });
  assert.deepEqual(hit.map((row) => row.id), ['n1']);
});

test('parent draft must exist before a child is created', () => {
  assert.equal(createDraftRequiresParentFirst('parent-cand', null), true);
  assert.equal(createDraftRequiresParentFirst('parent-cand', 'parent-draft'), false);
  assert.equal(createDraftRequiresParentFirst(null, null), false);
});

test('owner-defined capture uses persisted items only', () => {
  const pages = [itemsPage(1, ['סעיף', '2', 'מקורות', '(1)', 'משכורת'])];
  const text = captureOwnerDefinedSourceBody(
    { page_start: 1, page_end: 1, item_start: 3, item_end: 4 },
    pages,
  );
  assert.match(text, /משכורת/);
  assert.doesNotMatch(text, /מקורות/);
});

test('display label is backend-owned and does not expose nested JSON', () => {
  assert.equal(displayDraftLabel({ kind_label: 'סעיף', source_display_identifier: '4א(א)(1)', title: 'ניכוי' }), 'סעיף 4א(א)(1) ניכוי');
});

test('null TAX-629 source spans never imply item 0', () => {
  const heading = candidate('seif-2', 0, {
    source_page: null,
    source_item_start: null,
    source_item_end: null,
    page_start: 16,
    page_end: 16,
    kind_label: 'סעיף',
    source_display_identifier: '2',
    title: 'מקורות הכנסה',
  });
  assert.equal(candidateStartCursor(heading), null);
  const captured = captureExclusiveSourceBody(heading, [heading], []);
  assert.equal(captured.item_start, null);
  assert.notEqual(captured.item_start, 0);
  assert.equal(captured.boundary_status, 'uncertain');
});

test('split printed marker ( 1 ) recovers with the line title, not a bare 1', () => {
  const child = candidate('2-1', 0, {
    source_page: null,
    source_item_start: null,
    page_start: 17,
    page_end: 17,
    kind_label: 'פסקה',
    source_display_identifier: '2(1)',
    printed_marker: '(1)',
    title: 'השתכרות או ריווח',
  });
  const pages = [
    itemsPage(17, ['השתכרות או ריווח', ' ', '(', '1', ')', 'מעסק'], {
      yForIndex: () => 400,
    }),
  ];
  const captured = captureExclusiveSourceBody(child, [child], pages);
  assert.equal(captured.heading_status, 'recovered');
  assert.equal(captured.item_start, 0);
  assert.match(captured.text, /השתכרות/);
  assert.doesNotMatch(captured.text, /^1 /);
});

test('heading cursor recovers from page_text_items, not page item 0', () => {
  const seif2 = candidate('seif-2', 0, {
    source_page: null,
    source_item_start: null,
    source_item_end: null,
    page_start: 16,
    page_end: 16,
    kind_label: 'סעיף',
    source_display_identifier: '2',
    title: 'מקורות הכנסה',
  });
  const child = candidate('2-1', 1, {
    parent_candidate_id: 'seif-2',
    source_page: null,
    source_item_start: null,
    page_start: 16,
    page_end: 16,
    kind_label: 'פסקה',
    source_display_identifier: '2(1)',
    printed_marker: '(1)',
    title: 'משכורת',
  });
  const pages = [
    itemsPage(16, ['פנקסים', 'קבילים', 'מילון', 'סעיף', '2', 'מקורות', 'הכנסה', '(1)', 'משכורת'], {
      yForIndex: (i) => (i < 3 ? 700 : i < 7 ? 400 : 200),
    }),
  ];
  const captured = captureExclusiveSourceBody(seif2, [seif2, child], pages);
  assert.equal(captured.heading_status, 'recovered');
  assert.equal(captured.item_start, 3);
  assert.notEqual(captured.item_start, 0);
  assert.match(captured.text, /מקורות/);
  assert.doesNotMatch(captured.text, /פנקסים/);
  assert.doesNotMatch(captured.text, /משכורת/);
  const childBody = captureExclusiveSourceBody(child, [seif2, child], pages);
  assert.equal(childBody.item_start, 7);
  assert.match(childBody.text, /משכורת/);
});

test('ambiguous heading occurrence stays uncertain and is never guessed', () => {
  const child = candidate('2-1', 0, {
    source_page: null,
    source_item_start: null,
    page_start: 17,
    page_end: 17,
    kind_label: 'פסקה',
    source_display_identifier: '2(1)',
    printed_marker: '(1)',
    title: null,
  });
  const pages = [itemsPage(17, ['(1)', 'עסק', '(1)', 'משכורת'], { yForIndex: (i) => (i < 2 ? 500 : 200) })];
  const captured = captureExclusiveSourceBody(child, [child], pages);
  assert.equal(captured.heading_status, 'ambiguous');
  assert.equal(captured.boundary_status, 'uncertain');
  assert.equal(captured.item_start, null);
  assert.equal(captured.text, '');
});

test('next direct descendant is not the parent exclusive boundary', () => {
  const parent = candidate('2-2', 0, { source_item_start: 0 });
  const child = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 4 });
  const grandchild = candidate('2-2-a-1', 2, { parent_candidate_id: '2-2-a', source_item_start: 6 });
  const sibling = candidate('2-3', 3, { source_item_start: 8 });
  const ordered = [parent, child, grandchild, sibling];
  assert.equal(firstDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-2-a');
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-3');
  assert.notEqual(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-2-a');
});

test('next grandchild is not the ancestor exclusive boundary', () => {
  const parent = candidate('seif-2', 0, { source_item_start: 0 });
  const child = candidate('2-2', 1, { parent_candidate_id: 'seif-2', source_item_start: 2 });
  const grandchild = candidate('2-2-a', 2, { parent_candidate_id: '2-2', source_item_start: 4 });
  const sibling = candidate('2-3', 3, { parent_candidate_id: 'seif-2', source_item_start: 8 });
  const ordered = [parent, child, grandchild, sibling];
  assert.notEqual(nextNonDescendantBoundaryCandidate(ordered, 'seif-2')?.id, '2-2-a');
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, 'seif-2'), null);
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-3');
});

test('next sibling is the exclusive boundary', () => {
  const seif = candidate('seif-2', 0, { source_item_start: 0 });
  const one = candidate('2-1', 1, { parent_candidate_id: 'seif-2', source_item_start: 4 });
  const two = candidate('2-2', 2, { parent_candidate_id: 'seif-2', source_item_start: 8 });
  assert.equal(nextNonDescendantBoundaryCandidate([seif, one, two], '2-1')?.id, '2-2');
});

test("next ancestor sibling is the exclusive boundary after a node's subtree", () => {
  const two = candidate('2-2', 0, { source_item_start: 0 });
  const alef = candidate('2-2-a', 1, { parent_candidate_id: '2-2', source_item_start: 2 });
  const bet = candidate('2-2-b', 2, { parent_candidate_id: '2-2', source_item_start: 4 });
  const three = candidate('2-3', 3, { source_item_start: 6 });
  const ordered = [two, alef, bet, three];
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2-b')?.id, '2-3');
  assert.equal(nextNonDescendantBoundaryCandidate(ordered, '2-2')?.id, '2-3');
  const pages = [itemsPage(1, ['(2)', 'ריווח', '(א)', 'עסק', '(ב)', 'משלח', '(3)', 'דיבידנד'])];
  const parentBody = captureExclusiveSourceBody(two, ordered, pages);
  assert.match(parentBody.text, /ריווח/);
  assert.doesNotMatch(parentBody.text, /עסק/);
  assert.doesNotMatch(parentBody.text, /דיבידנד/);
  assert.match(parentBody.subtree_text, /עסק/);
  assert.match(parentBody.subtree_text, /משלח/);
  assert.doesNotMatch(parentBody.subtree_text, /דיבידנד/);
  assert.equal(parentBody.next_non_descendant_id, '2-3');
  assert.equal(parentBody.first_descendant_id, '2-2-a');
});

test('source order uses layout evidence, not identifier lexical sorting', () => {
  const parent = candidate('p', 0, { source_item_start: 0 });
  const two = candidate('two', 1, {
    parent_candidate_id: 'p',
    source_item_start: 4,
    source_display_identifier: '2(2)',
  });
  const ten = candidate('ten', 2, {
    parent_candidate_id: 'p',
    source_item_start: 8,
    source_display_identifier: '2(10)',
  });
  const orderedByEvidence = [parent, two, ten];
  const lexicalChildren = ['2(2)', '2(10)'].sort((a, b) => a.localeCompare(b));
  assert.equal(nextNonDescendantBoundaryCandidate(orderedByEvidence, 'two')?.id, 'ten');
  assert.deepEqual(lexicalChildren, ['2(10)', '2(2)']);
  assert.ok(compareLayoutCursors({ page: 1, item: 4, certain: true }, { page: 1, item: 8, certain: true }) < 0);
});

test('OCR gap on the heading page stays uncertain and does not fabricate source', () => {
  const heading = candidate('seif-2', 0, {
    source_page: null,
    source_item_start: null,
    page_start: 16,
    page_end: 16,
    kind_label: 'סעיף',
    source_display_identifier: '2',
    title: 'מקורות הכנסה',
  });
  const pages = [
    {
      page_no: 16,
      status: 'needs_ocr',
      page_text: 'סעיף 2 מקורות הכנסה invented',
      page_text_items: { v: 1, h: 800, items: [] },
    },
  ];
  const captured = captureExclusiveSourceBody(heading, [heading], pages);
  assert.equal(captured.heading_status, 'ocr_gap');
  assert.equal(captured.boundary_status, 'uncertain');
  assert.equal(captured.text, '');
  assert.doesNotMatch(captured.text, /invented/);
});

test('parent own text does not duplicate descendant bodies; subtree region is reported separately', () => {
  const two = candidate('2-2', 0, {
    source_item_start: 0,
    kind_label: 'פסקה',
    source_display_identifier: '2(2)',
    printed_marker: '(2)',
  });
  const alef = candidate('2-2-a', 1, {
    parent_candidate_id: '2-2',
    source_item_start: 3,
    kind_label: 'פסקה',
    source_display_identifier: '2(2)(א)',
    printed_marker: '(א)',
  });
  const bet = candidate('2-2-b', 2, {
    parent_candidate_id: '2-2',
    source_item_start: 6,
    kind_label: 'פסקה',
    source_display_identifier: '2(2)(ב)',
    printed_marker: '(ב)',
  });
  const three = candidate('2-3', 3, {
    source_item_start: 9,
    kind_label: 'פסקה',
    source_display_identifier: '2(3)',
    printed_marker: '(3)',
  });
  const ordered = [two, alef, bet, three];
  const pages = [itemsPage(1, ['(2)', 'ריווח', 'מעבודה', '(א)', 'עסק', 'חקלאות', '(ב)', 'משלח', 'יד', '(3)', 'דיבידנד'])];
  const parentBody = captureExclusiveSourceBody(two, ordered, pages);
  const alefBody = captureExclusiveSourceBody(alef, ordered, pages);
  assert.doesNotMatch(parentBody.text, /חקלאות/);
  assert.match(alefBody.text, /חקלאות/);
  assert.match(parentBody.subtree_text, /חקלאות/);
  assert.notEqual(parentBody.text, parentBody.subtree_text);
});

test('TAX-634 review tree overlays drafts onto the document structure only', () => {
  const nodes = buildLegalTextReviewNodes(
    [
      { id: 'chelek', parent_candidate_id: null, candidate_kind: 'structure', kind_label: 'חלק', source_display_identifier: "חלק ב'", title: 'הכנסה', sort_order: 0 },
      { id: 'seif', parent_candidate_id: 'chelek', candidate_kind: 'structure', kind_label: 'סעיף', source_display_identifier: '2', title: null, sort_order: 1 },
      { id: 'note', parent_candidate_id: null, candidate_kind: 'reference', kind_label: 'הערה', sort_order: 2 },
    ],
    [
      {
        id: 'draft-seif',
        source_candidate_id: 'seif',
        parent_draft_id: null,
        review_status: 'ready',
        kind_label: 'סעיף',
        display_identifier: '2',
        printed_marker: '2.',
        title: 'הכנסה',
      },
    ],
  );
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.review_state, 'not_prepared');
  assert.equal(nodes[0]?.id, 'chelek');
  assert.equal(nodes[1]?.id, 'draft-seif');
  assert.equal(nodes[1]?.review_state, 'reviewed');
  assert.equal(nodes[1]?.parent_id, 'chelek');
  assert.equal(legalTextReviewStateFromDraft('ready'), 'reviewed');
  assert.match(legalTextReviewStateLabel('reviewed'), /נבדק/);
});

test('TAX-634 parent-first missing candidates skip existing drafts and wait for parents', () => {
  const missing = parentFirstMissingCandidates(
    [
      { id: 'root', parent_candidate_id: null, candidate_kind: 'structure', sort_order: 0 },
      { id: 'child', parent_candidate_id: 'root', candidate_kind: 'structure', sort_order: 1 },
      { id: 'grand', parent_candidate_id: 'child', candidate_kind: 'structure', sort_order: 2 },
    ],
    new Set(['root']),
  );
  assert.deepEqual(
    missing.map((row) => row.id),
    ['child', 'grand'],
  );
});


