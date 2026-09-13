import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV1PdfUpload,
  detectStructureCandidates,
  extractStructureCandidatesFromPages,
  hasParentCycle,
  isTocOrIndexPage,
  orderedPagesFromFutureInputs,
  pageHasUsableEmbeddedText,
  parseNumericIdentifier,
  sha256Hex,
  summarizeJobProgress,
  trainerInputOptions,
  usableKindCatalog,
  validateStructureCandidates,
  workerMustNotWriteCanonicalLaw,
} from '../../src/domains/knowledge-trainer/knowledge-trainer.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סימן' },
  { id: '4', label: 'סעיף' },
  { id: '5', label: 'סעיף קטן' },
  { id: '6', label: 'תוספת' },
];

test('checksum is deterministic', () => {
  assert.equal(sha256Hex(Buffer.from('same')), sha256Hex(Buffer.from('same')));
  assert.notEqual(sha256Hex(Buffer.from('same')), sha256Hex(Buffer.from('other')));
});

test('V1 accepts PDF magic and rejects other MIME/input/size', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(16, 1)]);
  assert.deepEqual(assertV1PdfUpload({ input_type: 'pdf', mime_type: 'application/pdf', bytes: pdf }), {
    input_type: 'pdf',
    mime_type: 'application/pdf',
  });
  assert.throws(() => assertV1PdfUpload({ input_type: 'image', mime_type: 'image/jpeg', bytes: pdf }), /PDF only/);
  assert.throws(() => assertV1PdfUpload({ input_type: 'pdf', mime_type: 'image/png', bytes: pdf }), /Unsupported MIME/);
  assert.throws(
    () => assertV1PdfUpload({ input_type: 'pdf', mime_type: 'application/pdf', bytes: Buffer.from('not-pdf') }),
    /not a PDF/,
  );
});

test('textless page is needs_ocr and is not invented', () => {
  assert.equal(pageHasUsableEmbeddedText('   '), false);
  assert.equal(pageHasUsableEmbeddedText('סעיף 1'), true);
});

test('deterministic Hebrew structure uses catalog labels and document-order parents', () => {
  const drafts = extractStructureCandidatesFromPages(
    [
      { page_no: 1, text: 'חלק א פרשנות\nסעיף 14 הכנסה\nסעיף 16 ניכוי' },
      { page_no: 2, text: 'חלק ב הוראות' },
    ],
    catalog,
  );
  assert.equal(drafts.length, 4);
  assert.equal(drafts[0].kind_label, 'חלק');
  assert.equal(drafts[1].kind_label, 'סעיף');
  assert.equal(drafts[1].parent_index, 0);
  assert.equal(drafts[2].parent_index, 0);
  assert.equal(drafts[3].kind_label, 'חלק');
  assert.equal(drafts[3].parent_index, null);
});

test('sequence gap warns and does not invent the missing section', () => {
  const drafts = validateStructureCandidates(
    extractStructureCandidatesFromPages([{ page_no: 1, text: 'סעיף 14 א\nסעיף 16 ב' }], catalog),
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.equal(drafts.some((row) => row.node_number === '15'), false);
  assert.ok(drafts.some((row) => row.validation_warnings.includes('sequence_anomaly')));
  assert.equal(parseNumericIdentifier('16'), 16);
});

test('hierarchy cycle and duplicate sibling are review warnings, not canonical writes', () => {
  assert.equal(hasParentCycle(0, new Map([[0, 1], [1, 0]])), true);
  const dups = validateStructureCandidates(
    [
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'סעיף',
        node_number: '1',
        title: 'A',
        parent_index: null,
        page_start: 1,
        page_end: 1,
        excerpt: 'סעיף 1 A',
        confidence: 0.5,
        validation_warnings: [],
      },
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'סעיף',
        node_number: '1',
        title: 'B',
        parent_index: null,
        page_start: 1,
        page_end: 1,
        excerpt: 'סעיף 1 B',
        confidence: 0.5,
        validation_warnings: [],
      },
    ],
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.ok(dups.every((row) => row.validation_warnings.includes('duplicate_sibling_identifier')));
});

test('future photo and pasted-text batches map onto the same ordered page model', () => {
  const photos = orderedPagesFromFutureInputs({
    input_type: 'image',
    items: [{ order: 3, text: null }, { order: 1, text: null }, { order: 2, text: null }],
  });
  assert.deepEqual(photos.map((page) => page.page_no), [1, 2, 3]);
  assert.equal(photos[0].extraction_method, 'ocr');
  const pasted = orderedPagesFromFutureInputs({
    input_type: 'text',
    items: [{ order: 1, text: 'סעיף 1' }],
  });
  assert.equal(pasted[0].extraction_method, 'manual_text');
});

test('312-page progress is page-checkpointed and not one HTTP batch', () => {
  const pages = Array.from({ length: 312 }, (_, index) => ({
    status: index < 154 ? 'extracted' : index === 154 ? 'failed' : 'pending',
  }));
  const progress = summarizeJobProgress(pages);
  assert.equal(progress.extracted_page_count, 154);
  assert.equal(progress.failed_page_count, 1);
  assert.equal(progress.job_status, 'extracting');
  const afterFail = summarizeJobProgress(
    pages.map((page, index) => (index > 154 ? { status: 'extracted' } : page)),
  );
  assert.equal(afterFail.extracted_page_count, 311);
  assert.equal(afterFail.job_status, 'partially_extracted');
});

test('worker isolation forbids canonical legal tables', () => {
  assert.equal(workerMustNotWriteCanonicalLaw('tax_legal_nodes'), true);
  assert.equal(workerMustNotWriteCanonicalLaw('tax_domains'), true);
  assert.equal(workerMustNotWriteCanonicalLaw('legal_ingestion_pages'), false);
});

test('upload/accept are not activate; reject is review; edit is draft_edit', () => {
  assert.equal(capabilityRequiredForOwnerCommand('upload_legal_training_document'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('rebuild_legal_structure_candidates'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('reextract_legal_document_layout'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('rebuild_legal_structure_with_layout'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('accept_legal_structure_candidate'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('update_legal_extraction_candidate'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('reject_legal_extraction_candidate'), 'legal_knowledge.review');
  assert.equal(capabilityRequiredForOwnerCommand('activate_tax_source'), 'legal_knowledge.activate');
  assert.notEqual(capabilityRequiredForOwnerCommand('upload_legal_training_document'), 'legal_knowledge.activate');
});

test('flattened detector never marks layout_used', () => {
  const detected = detectStructureCandidates([{ page_no: 1, text: 'חלק א פרשנות\nסעיף 1 הגדרות' }], catalog);
  assert.equal(detected.analysis.layout_used, false);
  assert.equal(detected.drafts.some((row) => row.candidate_status === 'accepted'), false);
});

test('TOC line with multiple Go tokens is not a canonical-quality candidate', () => {
  const detected = detectStructureCandidates(
    [
      {
        page_no: 2,
        text: 'פרק שני: ניכויים וקיזוזים Go 78 סימן א\': ניכויי הוצאות Go 78 17 סעיף הניכויים המותרים Go 81',
      },
    ],
    catalog,
  );
  assert.equal(detected.drafts.some((row) => (row.title || '').includes('Go')), false);
  assert.ok(detected.analysis.toc_index_rejected > 0);
  assert.equal(detected.drafts.every((row) => row.confidence < 0.85 || row.candidate_status !== 'proposed' || !row.title?.includes('Go')), true);
});

test('index page does not explode into false structure nodes', () => {
  const toc =
    'תוכן ענינים חלק א\': פרשנות Go 35 1 סעיף הגדרות Go 35 חלק ב\': הטלת המס Go 39 פרק ראשון: המקור Go 39';
  assert.equal(isTocOrIndexPage(toc, catalog.map((row) => row.label)), true);
  const drafts = extractStructureCandidatesFromPages([{ page_no: 1, text: toc }], catalog);
  assert.equal(drafts.length, 0);
});

test('clean חלק heading creates one candidate', () => {
  const drafts = extractStructureCandidatesFromPages([{ page_no: 12, text: 'חלק א — פרשנות' }], catalog);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind_label, 'חלק');
  assert.equal(drafts[0].node_number, 'א');
  assert.equal(drafts[0].title, 'פרשנות');
});

test('clean פרק heading creates one candidate', () => {
  const drafts = extractStructureCandidatesFromPages([{ page_no: 16, text: 'פרק ראשון: המקור' }], catalog);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind_label, 'פרק');
  assert.equal(drafts[0].node_number, 'ראשון');
  assert.equal(drafts[0].title, 'המקור');
});

test('clean סימן heading creates one candidate', () => {
  const drafts = extractStructureCandidatesFromPages([{ page_no: 61, text: 'סימן א: ניכויי הוצאות' }], catalog);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind_label, 'סימן');
  assert.equal(drafts[0].node_number, 'א');
});

test('clean סעיף heading creates one candidate', () => {
  const drafts = extractStructureCandidatesFromPages([{ page_no: 12, text: 'סעיף 1 הגדרות' }], catalog);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind_label, 'סעיף');
  assert.equal(drafts[0].node_number, '1');
});

test('subsection candidate requires סעיף context', () => {
  const lonely = extractStructureCandidatesFromPages([{ page_no: 20, text: 'הגדרה כללית (א) קרן השתלמות' }], catalog);
  assert.equal(lonely.some((row) => row.kind_label === 'סעיף קטן'), false);
  const withSeif = extractStructureCandidatesFromPages([{ page_no: 20, text: 'סעיף 9 פטור (א) קרן' }], catalog);
  assert.ok(withSeif.some((row) => row.kind_label === 'סעיף קטן' && row.candidate_status === 'needs_review'));
});

test('long merged line is rejected or downgraded', () => {
  const validated = validateStructureCandidates(
    [
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'פרק',
        node_number: 'שני',
        title: 'הניכויים המותרים Go 78 סימן א ניכויי הוצאות Go 81 סעיף 17',
        parent_index: null,
        page_start: 2,
        page_end: 2,
        excerpt: 'פרק שני הניכויים המותרים Go 78 סימן א ניכויי הוצאות Go 81',
        confidence: 0.9,
        validation_warnings: [],
      },
    ],
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.ok(validated[0].validation_warnings.includes('toc_or_merged_heading'));
  assert.ok(validated[0].confidence < 0.5);
});

test('duplicate candidate is suppressed', () => {
  const drafts = extractStructureCandidatesFromPages(
    [
      { page_no: 1, text: 'חלק א פרשנות' },
      { page_no: 1, text: 'חלק א פרשנות' },
    ],
    catalog,
  );
  assert.equal(drafts.filter((row) => row.kind_label === 'חלק' && row.node_number === 'א').length, 1);
});

test('ambiguous parent gets warning and does not invent a parent', () => {
  const drafts = extractStructureCandidatesFromPages([{ page_no: 28, text: 'פרק שני: המקום' }], catalog);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].parent_index, null);
  assert.ok(drafts[0].validation_warnings.includes('unresolved_parent'));
  assert.equal(drafts.some((row) => row.kind_label === 'חלק'), false);
});

test('hierarchy cycle is broken rather than persisted', () => {
  const cyclic = validateStructureCandidates(
    [
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'פרק',
        node_number: 'א',
        title: 'A',
        parent_index: 1,
        page_start: 1,
        page_end: 1,
        excerpt: 'פרק א A',
        confidence: 0.9,
        validation_warnings: [],
      },
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'חלק',
        node_number: 'א',
        title: 'B',
        parent_index: 0,
        page_start: 1,
        page_end: 1,
        excerpt: 'חלק א B',
        confidence: 0.9,
        validation_warnings: [],
      },
    ],
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.equal(hasParentCycle(0, new Map(cyclic.map((row, index) => [index, row.parent_index]))), false);
});

test('cross-reference plus amendment year is not a סעיף candidate', () => {
  const drafts = extractStructureCandidatesFromPages(
    [{ page_no: 49, text: 'מכוח סעיף 2012 תשע"ב- ( 190 תיקון מס\' ) סכומים ששולמו' }],
    catalog,
  );
  assert.equal(drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '2012'), false);
});

test('trailing לפי סעיף after a reversed number is not a heading', () => {
  const drafts = extractStructureCandidatesFromPages(
    [{ page_no: 22, text: 'חוק מס עזבון, תש"ט- א. 125 עליהם לפי סעיף' }],
    catalog,
  );
  assert.equal(drafts.some((row) => row.node_number === '125א' || row.node_number === '125'), false);
});

test('RTL body heading ". 1" with bracket title creates one סעיף', () => {
  const drafts = extractStructureCandidatesFromPages(
    [{ page_no: 12, text: 'חלק א\': פרשנות [ 2 ] הגדרות בפקודה זו -. 1 "אדם" - לרבות חברה' }],
    catalog,
  );
  const seif = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '1');
  assert.ok(seif);
  assert.equal(seif?.title, 'הגדרות');
  assert.equal(drafts.filter((row) => row.kind_label === 'חלק').length, 1);
});

test('LTR 1. and 1א. headings create סעיף candidates', () => {
  const drafts = extractStructureCandidatesFromPages(
    [{ page_no: 12, text: '[ 2 ] הגדרות 1. אדם\n[ 3 ] הכנסה 1א. מקור' }],
    catalog,
  );
  assert.ok(drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '1'));
  assert.ok(drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '1א'));
});

test('mid-sentence חלק with paren leftovers is not a heading', () => {
  const drafts = extractStructureCandidatesFromPages(
    [{ page_no: 96, text: 'לא יחולו על חברת בית. 104 הוראות חלק ה\' ( ח ) ז, לא יחולו על חברת בית.' }],
    catalog,
  );
  assert.equal(drafts.some((row) => row.kind_label === 'חלק'), false);
});

test('compound catalog label does not make חלק an unresolved child', () => {
  const dirty = [{ id: '0', label: 'חלק א' }, ...catalog];
  assert.deepEqual(usableKindCatalog(dirty).map((row) => row.label), catalog.map((row) => row.label));
  const drafts = extractStructureCandidatesFromPages([{ page_no: 12, text: 'חלק א — פרשנות' }], dirty);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind_label, 'חלק');
  assert.equal(drafts[0].parent_index, null);
  assert.equal(drafts[0].validation_warnings.includes('unresolved_parent'), false);
});

test('Photos and Text stay unavailable in V1 input options', () => {
  const options = trainerInputOptions(true);
  assert.equal(options.find((row) => row.input_type === 'pdf')?.available, true);
  assert.equal(options.find((row) => row.input_type === 'image')?.available, false);
  assert.equal(options.find((row) => row.input_type === 'text')?.available, false);
  assert.equal(options.find((row) => row.input_type === 'image')?.status_label, 'Coming next');
});
