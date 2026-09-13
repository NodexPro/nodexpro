import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPageLayoutProfile,
  canClaimLayoutPage,
  compactPdfJsTextItems,
  detectStructureCandidatesFromLayout,
  evaluateLineHeadingEvidence,
  fontSizeFromTransform,
  groupTextItemsIntoLines,
  layoutItemsEquivalent,
  layoutPersistPreservesPageText,
  isAmendmentDebris,
  isAmendmentYearStamp,
  lineLooksLikeAmendmentOrGazette,
  lineLooksLikeRunningCitation,
  parseRtlSectionNumber,
  queueLayoutStatusForPage,
  queueLayoutUpdatesByPageStatus,
  stagingStructureIdsToReplace,
  summarizeLayoutReadiness,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-layout.pure.js';
import {
  amendmentHistoryItems,
  bottomPageFootnoteItems,
  PAGE_HEIGHT,
  pageHeaderFooterItems,
  realHeadingItems,
  runningCitationItems,
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

test('font size is derived from transform hypot and items keep order/hasEOL', () => {
  assert.equal(fontSizeFromTransform([10, 0, 0, 10, 12, 40], 8), 10);
  const packed = compactPdfJsTextItems(
    [
      { str: '39.', width: 20, height: 14, transform: [12, 0, 0, 12, 40, 700], fontName: 'F1', hasEOL: true, dir: 'rtl' },
      { str: 'הגדרות', width: 60, height: 14, transform: [12, 0, 0, 12, 70, 700], fontName: 'F1', hasEOL: false, dir: 'rtl' },
    ],
    841.89,
  );
  assert.equal(packed.items[0].i, 0);
  assert.equal(packed.items[0].fs, 12);
  assert.equal(packed.items[0].eol, true);
  assert.equal(packed.items[1].i, 1);
  assert.equal(packed.h, 841.89);
  const again = compactPdfJsTextItems(
    [
      { str: '39.', width: 20, height: 14, transform: [12, 0, 0, 12, 40, 700], fontName: 'F1', hasEOL: true, dir: 'rtl' },
      { str: 'הגדרות', width: 60, height: 14, transform: [12, 0, 0, 12, 70, 700], fontName: 'F1', hasEOL: false, dir: 'rtl' },
    ],
    841.89,
  );
  assert.equal(layoutItemsEquivalent(packed, again), true);
});

test('synthetic heading is isolated; citation, footnote, amendment, header are not', () => {
  const heading = item({ s: 'סעיף 39 הגדרות', y: 620, fs: 13 });
  const citation = item({ s: 'לפי סעיף 39 לא יחולו הוראות אלה על הכנסה', y: 500, fs: 11 });
  const footnote = item({ s: 'הערת שוליים לפי סעיף 105י', y: 40, fs: 8 });
  const amendment = item({ s: "תיקון מס' 256", y: 300, fs: 10 });
  const gazette = item({ s: "עמ' 514", y: 280, fs: 10 });
  const header = item({ s: 'פקודת מס הכנסה', y: 820, fs: 9 });
  const lines = groupTextItemsIntoLines([heading, citation, footnote, amendment, gazette, header]);
  const profile = buildPageLayoutProfile(lines, 841);
  const headingLine = lines.find((line) => line.text.includes('הגדרות'))!;
  const citationLine = lines.find((line) => line.text.includes('לפי'))!;
  const footnoteLine = lines.find((line) => line.y < 50)!;
  assert.equal(evaluateLineHeadingEvidence(headingLine, {}, profile), 'isolated_heading');
  assert.equal(lineLooksLikeRunningCitation(citationLine.text), true);
  assert.equal(evaluateLineHeadingEvidence(citationLine, {}, profile), 'running_citation');
  assert.equal(evaluateLineHeadingEvidence(footnoteLine, {}, profile), 'header_or_footer');
  assert.equal(lineLooksLikeAmendmentOrGazette(amendment.s), true);
  assert.equal(lineLooksLikeAmendmentOrGazette(gazette.s), true);
  assert.equal(evaluateLineHeadingEvidence(lines.find((line) => line.text.includes('256'))!, {}, profile), 'amendment_or_gazette');
});

test('fixture citations, footnotes, amendments, and headers are not structural headings', () => {
  assert.equal(lineLooksLikeRunningCitation(runningCitationItems[1].s), true);
  assert.equal(lineLooksLikeRunningCitation('בהתאם לסעיף 105י במקרים אלה'), true);
  assert.equal(lineLooksLikeRunningCitation('סעיפים 38 ו-39 אינם חלים כאן'), true);
  assert.equal(lineLooksLikeAmendmentOrGazette(amendmentHistoryItems[0].s), true);
  assert.equal(lineLooksLikeAmendmentOrGazette(amendmentHistoryItems[1].s), true);
  const footnoteLines = groupTextItemsIntoLines(bottomPageFootnoteItems);
  const headerLines = groupTextItemsIntoLines(pageHeaderFooterItems);
  const profile = buildPageLayoutProfile([...footnoteLines, ...headerLines], PAGE_HEIGHT);
  assert.equal(evaluateLineHeadingEvidence(footnoteLines[0], {}, profile), 'header_or_footer');
  assert.equal(evaluateLineHeadingEvidence(headerLines[0], {}, profile), 'header_or_footer');
});

test('layout detector keeps standalone heading and rejects citation/amendment/gazette', () => {
  const { drafts } = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 12,
        text: 'ignored flattened לפי סעיף 39 תיקון מס 256 עמ 514',
        layout: {
          v: 1,
          h: 841,
          items: [
            item({ s: 'סעיף', y: 640, fs: 13, i: 0 }),
            item({ s: '1', y: 640, fs: 13, i: 1 }),
            item({ s: 'הגדרות', y: 640, fs: 13, i: 2, eol: true }),
            item({ s: 'לפי סעיף 39 לא יחול המס', y: 520, fs: 11, i: 3 }),
            item({ s: "תיקון מס' 256", y: 200, fs: 10, i: 4 }),
            item({ s: "עמ' 514", y: 180, fs: 10, i: 5 }),
          ],
        },
      },
    ],
    catalog,
  );
  assert.equal(drafts.some((row) => row.node_number === '1' && row.kind_label === 'סעיף'), true);
  assert.equal(drafts.some((row) => row.node_number === '39'), false);
  assert.equal(drafts.some((row) => row.node_number === '256'), false);
  assert.equal(drafts.some((row) => row.node_number === '514'), false);
  assert.equal(drafts[0]?.parent_index == null || typeof drafts[0].parent_index === 'number', true);

  const numbered = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 12,
        text: 'flattened לפי סעיף 39',
        layout: { v: 1, h: PAGE_HEIGHT, items: realHeadingItems },
      },
    ],
    catalog,
  );
  assert.equal(numbered.drafts.some((row) => row.kind_label === 'חלק' && row.node_number === "א'"), true);
  assert.equal(numbered.drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '39'), true);
  const seif = numbered.drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '39');
  const chelek = numbered.drafts.find((row) => row.kind_label === 'חלק');
  assert.ok(seif && chelek);
  assert.equal(seif.parent_index, numbered.drafts.indexOf(chelek));
  assert.equal(numbered.analysis.layout_used, true);

  const ordinanceShape = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 12,
        text: 'flattened לפי סעיף 39 חלק ממנו',
        layout: {
          v: 1,
          h: 841,
          items: [
            item({ s: "חלק א': פרשנות", y: 691, fs: 12, i: 0, eol: true }),
            item({ s: '[ 2 ] הגדרות', y: 672, fs: 13.5, i: 1, eol: true }),
            item({ s: 'בפקודה זו - . 1', y: 653, fs: 16, i: 2, eol: true }),
            item({ s: 'חלק ממנו', y: 500, fs: 13, i: 3, eol: true }),
            item({ s: 'פרק ראשון: המקור', y: 400, fs: 12, i: 4, eol: true }),
          ],
        },
      },
    ],
    catalog,
  );
  assert.equal(ordinanceShape.drafts.some((row) => row.kind_label === 'חלק' && row.node_number === "א'" && row.title === 'פרשנות'), true);
  assert.equal(ordinanceShape.drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '1' && row.title === 'הגדרות'), true);
  assert.equal(ordinanceShape.drafts.some((row) => row.kind_label === 'פרק' && /ראשון/.test(row.node_number) && /מקור/.test(row.title || '')), true);
  assert.equal(ordinanceShape.drafts.some((row) => row.kind_label === 'חלק' && row.node_number === 'מ'), false);

  const rtlBodyStart = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 16,
        text: 'flattened לפי סעיף 39',
        layout: {
          v: 1,
          h: 841,
          items: [
            item({ s: "2002 תשס\"ב- ( 132 תיקון מס' ) [ ( 1 ) 5 ] מקורות הכנסה", y: 80, fs: 13, i: 0, eol: true }),
            item({ s: 'מס הכנסה יהא משתלם, בכפוף להוראות פקודה זו, לכל שנת מס, בשיעורים . 2', y: 60, fs: 16, i: 1, eol: true }),
          ],
        },
      },
    ],
    catalog,
  );
  assert.equal(
    rtlBodyStart.drafts.some((row) => row.kind_label === 'סעיף' && row.node_number === '2' && /מקורות/.test(row.title || '')),
    true,
  );
});

test('RTL letter-suffix seif skips year-stamp lookback and does not keep leftover years as titles', () => {
  assert.equal(parseRtlSectionNumber('השתכרות או רווח ( א ) א. 2'), '2א');
  assert.equal(parseRtlSectionNumber('לענין סעיף זה – ( א ) א. 3'), '3א');
  assert.equal(parseRtlSectionNumber('סכום שהגיע לידי אדם ( א ) . 3'), '3');
  assert.equal(parseRtlSectionNumber('הכנסה מסוימת ( ב ) ב. 4'), '4ב');
  assert.equal(parseRtlSectionNumber('. ( בוטל ) יא. 105'), null);
  assert.equal(parseRtlSectionNumber('. ( בוטל ) טז. 105'), null);
  assert.equal(parseRtlSectionNumber('. ( בוטל ) ב. 11'), '11ב');
  assert.equal(isAmendmentYearStamp('1968 תשכ"ח-'), true);
  assert.equal(isAmendmentYearStamp("2004 תשס\"ד- ( 138 תיקון מס' ) 1968 תשכ\"ח-"), true);
  assert.equal(isAmendmentYearStamp('הכנסות אחרות'), false);
  assert.equal(isAmendmentYearStamp('תשלומים'), false);
  assert.equal(isAmendmentDebris('2003 תשס"ג- ( 134 מס\''), true);
  assert.equal(isAmendmentDebris('מקום הפקת ההכנסה'), false);
  assert.equal(lineLooksLikeRunningCitation('לענין סעיף 39'), true);
  assert.equal(lineLooksLikeRunningCitation('לענין סעיף זה – ( א ) א. 3'), false);
  assert.equal(lineLooksLikeRunningCitation('לפי סעיף 39'), true);

  const { drafts } = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 17,
        text: 'flattened לפי סעיף 39',
        layout: {
          v: 1,
          h: 841,
          items: [
            item({ s: "חלק ב': הטלת המס", y: 700, fs: 12, i: 0, eol: true }),
            item({ s: 'פרק ראשון: המקור', y: 680, fs: 12, i: 1, eol: true }),
            item({ s: "( 134 תיקון מס' ) השתכרות או רווח מהימורים מהגרלות או מפרסים", y: 110, fs: 13, i: 2, eol: true }),
            item({ s: '2003 תשס"ג-', y: 98, fs: 10, i: 3, eol: true }),
            item({
              s: 'השתכרות או רווח של אדם תושב ישראל שהופקו או שנצמחו בישראל ( א ) א. 2',
              y: 79,
              fs: 16,
              i: 4,
              eol: true,
            }),
            item({
              s: "( 13 תיקון מס' ) 1965 תשכ\"ה- ( 6 תיקון מס' ) [ ( 2 ) 5 ] הכנסות אחרות",
              y: 620,
              fs: 13,
              i: 5,
              eol: true,
            }),
            item({ s: '2004 תשס"ד- ( 138 תיקון מס\' ) 1968 תשכ"ח-', y: 600, fs: 10, i: 6, eol: true }),
            item({ s: 'סכום שהגיע לידי אדם תושב ישראל ממקורות אחרים ( א ) . 3', y: 560, fs: 16, i: 7, eol: true }),
            item({ s: "1978 תשל\"ח- ( 32 תיקון מס' ) הכנסה מאזור", y: 500, fs: 13, i: 8, eol: true }),
            item({ s: 'לענין סעיף זה – ( א ) א. 3', y: 480, fs: 16, i: 9, eol: true }),
            item({ s: "1990 תש\"ן- ( 81 תיקון מס' )", y: 460, fs: 10, i: 10, eol: true }),
            item({ s: "תיקון ) 2002 תשס\"ב- ( 132 תיקון מס' ) מקום הפקת ההכנסה", y: 320, fs: 13, i: 11, eol: true }),
            item({ s: '2003 תשס"ג- ( 134 מס\'', y: 303, fs: 13, i: 12, eol: true }),
            item({ s: '[2]', y: 285, fs: 13, i: 13, eol: true }),
            item({
              s: 'המקום שבו הופקה או נצמחה הכנסה השתכרות או רווח ( א ) א. 4',
              y: 270,
              fs: 16,
              i: 14,
              eol: true,
            }),
            item({ s: '. ( בוטל ) יא. 105', y: 240, fs: 16, i: 15, eol: true }),
            item({ s: '. ( בוטל ) יב. 105', y: 220, fs: 16, i: 16, eol: true }),
            item({ s: '( ג 75 סעיף )', y: 200, fs: 12, i: 17, eol: true }),
            item({ s: '– לפי חוקי הולנד FOUNDATION . 1', y: 180, fs: 13, i: 18, eol: true }),
            item({ s: '. ( בוטל ) ב. 11', y: 160, fs: 16, i: 19, eol: true }),
          ],
        },
      },
    ],
    catalog,
  );
  const seif2a = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '2א');
  const seif3 = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '3');
  const seif3a = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '3א');
  assert.ok(seif2a);
  assert.match(String(seif2a.title), /הימורים|מפרסים/);
  assert.ok(seif3);
  assert.match(String(seif3.title), /הכנסות אחרות/);
  assert.equal(/1968|תשכ/.test(String(seif3.title)), false);
  assert.ok(seif3a);
  assert.match(String(seif3a.title), /הכנסה מאזור/);
  const seif4a = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '4א');
  assert.ok(seif4a);
  assert.match(String(seif4a.title), /מקום הפקת ההכנסה/);
  assert.equal(/(?:19|20)\d{2}|תשס/.test(String(seif4a.title)), false);
  assert.equal(drafts.some((row) => row.node_number === '105'), false);
  assert.equal(drafts.some((row) => row.node_number === '1' && /FOUNDATION|75/.test(String(row.title))), false);
  const seif11b = drafts.find((row) => row.kind_label === 'סעיף' && row.node_number === '11ב');
  assert.ok(seif11b);
  assert.match(String(seif11b.title), /בוטל/);
});

test('amendment application and gazette-neighbor lines are not structural headings', () => {
  assert.equal(lineLooksLikeAmendmentOrGazette('סעיף 39 יחול'), true);
  assert.equal(lineLooksLikeAmendmentOrGazette('סעיף 105י יחול'), true);
  assert.equal(lineLooksLikeAmendmentOrGazette('סעיף 197 יחול תיקון 1984'), true);
  const { drafts } = detectStructureCandidatesFromLayout(
    [
      {
        page_no: 304,
        text: 'flattened סעיף 39 יחול סעיף 256 עמ 514',
        layout: {
          v: 1,
          h: 841,
          items: [
            item({ s: "תיקון מס' 197", y: 420, fs: 10, i: 0, eol: true }),
            item({ s: 'סעיף 256', y: 400, fs: 10, i: 1, eol: true }),
            item({ s: "עמ' 514", y: 380, fs: 10, i: 2, eol: true }),
            item({ s: 'סעיף 39 יחול', y: 360, fs: 10, i: 3, eol: true }),
            item({ s: 'סעיף 272 יחול', y: 340, fs: 10, i: 4, eol: true }),
          ],
        },
      },
    ],
    catalog,
  );
  assert.equal(drafts.some((row) => ['39', '256', '272', '197', '514'].includes(String(row.node_number))), false);
});

test('layout claim resumes after expired lease and is not for needs_ocr', () => {
  assert.equal(
    canClaimLayoutPage({ status: 'extracted', layout_status: 'pending', lease_expires_at: null }),
    true,
  );
  assert.equal(
    canClaimLayoutPage({
      status: 'extracted',
      layout_status: 'failed',
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
    true,
  );
  assert.equal(
    canClaimLayoutPage({
      status: 'extracted',
      layout_status: 'pending',
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
    false,
  );
  assert.equal(queueLayoutStatusForPage('needs_ocr', 'not_extracted'), 'skipped_needs_ocr');
  assert.equal(queueLayoutStatusForPage('extracted', 'ready'), 'pending');
  assert.equal(
    canClaimLayoutPage({
      status: 'extracted',
      layout_status: 'extracting',
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
    true,
  );
  assert.equal(
    canClaimLayoutPage({
      status: 'extracted',
      layout_status: 'extracting',
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
    false,
  );
  assert.equal(
    canClaimLayoutPage({ status: 'needs_ocr', layout_status: 'pending', lease_expires_at: null }),
    false,
  );
});

test('layout persist must not write page_text or status; readiness is additive', () => {
  assert.equal(layoutPersistPreservesPageText({ page_text_items: {}, layout_status: 'ready' }), true);
  assert.equal(layoutPersistPreservesPageText({ page_text: 'nope', layout_status: 'ready' }), false);
  const summary = summarizeLayoutReadiness([
    { status: 'extracted', layout_status: 'ready', layout_item_count: 10 },
    { status: 'needs_ocr', layout_status: 'skipped_needs_ocr', layout_item_count: 0 },
  ]);
  assert.equal(summary.ready_count, 1);
  assert.equal(summary.skipped_ocr_count, 1);
  assert.equal(summary.high_confidence_trusted, false);
  const processing = summarizeLayoutReadiness([
    { status: 'extracted', layout_status: 'pending' },
    { status: 'extracted', layout_status: 'ready' },
  ]);
  assert.equal(processing.readiness, 'processing');
  const failedOnly = summarizeLayoutReadiness([
    { status: 'extracted', layout_status: 'ready' },
    { status: 'extracted', layout_status: 'failed' },
  ]);
  assert.equal(failedOnly.readiness, 'partial');
  assert.equal(failedOnly.failed_count, 1);
  const queued = queueLayoutUpdatesByPageStatus([
    { id: 'p1', status: 'extracted', layout_status: 'not_extracted' },
    { id: 'p2', status: 'needs_ocr', layout_status: 'not_extracted' },
  ]);
  assert.deepEqual(queued.pendingIds, ['p1']);
  assert.deepEqual(queued.skippedIds, ['p2']);
});

test('TAX-625 is additive and 620-624 remain', () => {
  const sql625 = readFileSync(join(repoRoot, 'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql'), 'utf8');
  assert.match(sql625, /page_text_items jsonb/);
  assert.match(sql625, /layout_status/);
  assert.match(sql625, /legal_ingestion_claim_layout_page/);
  assert.doesNotMatch(sql625, /drop table public\.legal_ingestion_pages/i);
  assert.doesNotMatch(sql625, /drop column .*page_text/i);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/620_owner_country_legal_access.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql')), true);
});

test('rebuild replaces only non-accepted staging structure candidates', () => {
  const ids = stagingStructureIdsToReplace([
    { id: 'accepted', candidate_kind: 'structure', candidate_status: 'accepted', accepted_tax_legal_node_id: 'node-1' },
    { id: 'linked', candidate_kind: 'structure', candidate_status: 'proposed', accepted_tax_legal_node_id: 'node-2' },
    { id: 'staging', candidate_kind: 'structure', candidate_status: 'proposed', accepted_tax_legal_node_id: null },
    { id: 'rule', candidate_kind: 'rule', candidate_status: 'proposed', accepted_tax_legal_node_id: null },
  ]);
  assert.deepEqual(ids, ['staging']);
});
