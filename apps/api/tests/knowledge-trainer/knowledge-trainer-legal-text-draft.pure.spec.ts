import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegalIdentifier } from '../../src/domains/tax-knowledge/legal-identifier.pure.js';
import {
  captureExclusiveSourceBody,
  captureOwnerDefinedSourceBody,
  createDraftRequiresParentFirst,
  displayDraftLabel,
  draftIdentityKey,
  draftWouldCycle,
  findDraftIdentityConflict,
  hierarchyRankCompatible,
  notesOverlappingDraftSpan,
  reparentScopeError,
  validateDraftReady,
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
