import assert from 'node:assert/strict';
import test from 'node:test';
import { detectStructureCandidatesFromLayout } from '../../src/domains/knowledge-trainer/knowledge-trainer-layout.pure.js';
import {
  composeChildIdentifier,
  collapseSameSourceOccurrenceDrafts,
  dropSameParentIdentityDuplicates,
  extractNestedStructureMarker,
  extractParenthesizedMarkersFromTokens,
  extractTrailingStructuralMarkers,
  kindLabelForNestedDepth,
  letterContinuesSequence,
  lineCitesExternalLegalProvision,
  lineLooksLikeDefiningNestedStructure,
  lineLooksLikeNestedCitationNoise,
  lineLooksLikeLeadingParenHeading,
  lineLooksLikeQuotedDefinitionTerm,
  recomposeParenthesizedInner,
  resolveNestedParent,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-nested.pure.js';

const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סעיף' },
  { id: '4', label: 'סעיף קטן' },
  { id: '5', label: 'פסקה' },
  { id: '6', label: 'תת-פסקה' },
];

function item(s: string, y: number, opts?: { x?: number; fs?: number; eol?: boolean; i?: number }) {
  return {
    i: opts?.i ?? 0,
    s,
    x: opts?.x ?? 40,
    y,
    w: 40,
    h: 12,
    fn: 'Times',
    fs: opts?.fs ?? 12,
    eol: opts?.eol === true,
    d: 'rtl',
  };
}

function page(items: ReturnType<typeof item>[]) {
  return {
    page_no: 16,
    text: items.map((row) => row.s).join(' '),
    layout: { v: 1 as const, h: 841.89, items: items.map((row, index) => ({ ...row, i: index })) },
  };
}

test('extracts isolated nested markers and rejects running citations', () => {
  assert.deepEqual(extractNestedStructureMarker('(1)'), { component: '1', title: null, isolated: true });
  assert.deepEqual(extractNestedStructureMarker('(ט1)'), { component: 'ט1', title: null, isolated: true });
  assert.deepEqual(extractNestedStructureMarker('(א) מקום'), { component: 'א', title: 'מקום', isolated: true });
  assert.equal(extractNestedStructureMarker('לפי סעיף 2(1)'), null);
  assert.equal(extractNestedStructureMarker('הכנסה כאמור בסעיף 3(ט)'), null);
  assert.equal(extractNestedStructureMarker('לפי סעיף 3(ט1) לא יחול'), null);
  assert.equal(lineLooksLikeNestedCitationNoise('לפי סעיף 2(1) של הפקודה'), true);
  assert.equal(lineCitesExternalLegalProvision('בסעיף קטן זה – ( 1 ) ( 1 ט )'), false);
  assert.equal(lineCitesExternalLegalProvision('בסעיף 3(ט1)'), true);
  assert.equal(lineLooksLikeDefiningNestedStructure('בסעיף קטן זה – ( 1 ) ( 1 ט )'), true);
  assert.equal(lineLooksLikeDefiningNestedStructure('לפי סעיף 3(ט1) לא יחול'), false);
  assert.deepEqual(
    extractTrailingStructuralMarkers('בסעיף קטן זה – ( 1 ) ( 1 ט )').map((row) => row.component),
    ['ט1', '1'],
  );
  assert.equal(letterContinuesSequence('ט', 'ט1'), true);
  assert.equal(letterContinuesSequence('ט1', 'י'), true);
  assert.deepEqual(
    extractTrailingStructuralMarkers('השתכרות או ריווח מכל עסק או משלח-יד שעסקו בו תקופת זמן כלשהי, או ( 1 )'),
    [{ component: '1', title: 'השתכרות או ריווח מכל עסק או משלח-יד שעסקו בו תקופת זמן כלשהי, או'.slice(0, 60), isolated: false }],
  );
  assert.deepEqual(
    extractTrailingStructuralMarkers('השתכרות או ריווח מעבודה; כל טובת הנאה או קצובה שניתנו לעובד ( א ) ( 2 )').map((row) => row.component),
    ['2', 'א'],
  );
  assert.deepEqual(extractTrailingStructuralMarkers("2002 תשס\"ב- ( 132 תיקון מס' )"), []);
  assert.deepEqual(extractTrailingStructuralMarkers('[ ( 1 ) 5 ] מקורות הכנסה'), []);
});

test('3(ט1) and 3(ט)(1) stay distinct after composition', () => {
  const a = composeChildIdentifier('3', 'ט1');
  const b = composeChildIdentifier('3', 'ט');
  const c = composeChildIdentifier('3(ט)', '1');
  assert.equal(a?.normalized_machine_identifier, '3(ט1)');
  assert.equal(c?.normalized_machine_identifier, '3(ט)(1)');
  assert.notEqual(a?.normalized_machine_identifier, c?.normalized_machine_identifier);
  assert.equal(b?.normalized_machine_identifier, '3(ט)');
});

test('sibling (1) under different parents is allowed by the stack', () => {
  const first: Parameters<typeof resolveNestedParent>[0] = [];
  const underTwo = resolveNestedParent(first, '1');
  first.push({ index: 1, component: '1', markerClass: 'number', depth: 1, display: '2(1)' });
  const second: Parameters<typeof resolveNestedParent>[0] = [];
  const underThree = resolveNestedParent(second, '1');
  assert.equal(underTwo.parent, null);
  assert.equal(underThree.parent, null);
});

test('layout detector reconstructs nested identifiers without stuffing node_number', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('2.', 720, { eol: true }),
        item('מקורות הכנסה', 700, { eol: true }),
        item('השתכרות או ריווח מכל עסק או משלח-יד שעסקו בו תקופת זמן כלשהי, או ( 1 )', 680, { eol: true }),
        item('(2)', 640, { eol: true }),
        item('(3)', 620, { eol: true }),
        item('4א.', 500, { eol: true }),
        item('מקום', 480, { eol: true }),
        item('(א)', 450, { eol: true }),
        item('לגבי הכנסה מעסק - המקום שבו מתקיימת הפעילות ( 1 )', 430, { eol: true }),
        item('לפי סעיף 2(1) לא יחול', 200, { eol: true }),
      ]),
    ],
    catalog,
  );
  const byId = new Map(
    detected.drafts.map((row) => [row.source_display_identifier ?? '', row]),
  );
  assert.ok(byId.get('2'));
  assert.equal(byId.get('2(1)')?.parent_index, detected.drafts.findIndex((row) => row.source_display_identifier === '2'));
  assert.equal(byId.get('2(2)')?.source_display_identifier, '2(2)');
  assert.equal(byId.get('2(3)')?.kind_label, 'סעיף קטן');
  assert.equal(byId.get('4א(א)')?.kind_label, 'סעיף קטן');
  assert.equal(byId.get('4א(א)(1)')?.kind_label, 'פסקה');
  assert.equal(byId.get('4א(א)(1)')?.node_number, '1');
  assert.equal(byId.get('4א(א)(1)')?.normalized_machine_identifier, '4א(א)(1)');
  assert.equal(
    detected.drafts.some((row) => row.node_number === '2(1)' || row.node_number === '4א(א)(1)'),
    false,
  );
  assert.equal(detected.drafts.some((row) => row.source_display_identifier === '2(1)' && /לפי/.test(row.excerpt ?? '')), false);
});

test('catalog owns nested kinds; frontend-like hardcoding is not required', () => {
  assert.equal(kindLabelForNestedDepth(1, catalog), 'סעיף קטן');
  assert.equal(kindLabelForNestedDepth(2, catalog), 'פסקה');
  assert.equal(kindLabelForNestedDepth(3, catalog), 'תת-פסקה');
  assert.equal(kindLabelForNestedDepth(2, catalog.slice(0, 4)), 'סעיף קטן');
  assert.equal(
    kindLabelForNestedDepth(3, [...catalog, { id: '7', label: 'פסקת משנה' }]),
    'פסקת משנה',
  );
});

test('split tokens ( 1 ט ) recompose to ט1 and stay distinct from (ט)(1)', () => {
  assert.equal(recomposeParenthesizedInner('1 ט'), 'ט1');
  assert.equal(recomposeParenthesizedInner('ט 1'), 'ט1');
  assert.equal(extractNestedStructureMarker('( 1 ט )')?.component, 'ט1');
  assert.deepEqual(
    extractTrailingStructuralMarkers('הכנסה לפי סעיף קטן זה ( 1 ט )').map((row) => row.component),
    [],
  );
  assert.deepEqual(extractTrailingStructuralMarkers('הכנסה חייבת במס ( 1 ט )').map((row) => row.component), ['ט1']);
  assert.deepEqual(extractTrailingStructuralMarkers('הכנסה חייבת במס ( ט ) ( 1 )').map((row) => row.component), [
    '1',
    'ט',
  ]);
  const mixed = extractParenthesizedMarkersFromTokens([
    { s: '(', x: 10, y: 200, w: 4, h: 12 },
    { s: '1', x: 16, y: 200, w: 6, h: 12 },
    { s: 'ט', x: 24, y: 200, w: 8, h: 12 },
    { s: ')', x: 34, y: 200, w: 4, h: 12 },
  ]);
  assert.deepEqual(mixed, [{ component: 'ט1', printed_marker: '(ט1)' }]);
  const separate = extractParenthesizedMarkersFromTokens([
    { s: '(', x: 10, y: 200, w: 4, h: 12 },
    { s: 'ט', x: 16, y: 200, w: 8, h: 12 },
    { s: ')', x: 26, y: 200, w: 4, h: 12 },
    { s: '(', x: 40, y: 200, w: 4, h: 12 },
    { s: '1', x: 46, y: 200, w: 6, h: 12 },
    { s: ')', x: 54, y: 200, w: 4, h: 12 },
  ]);
  assert.deepEqual(separate, [
    { component: 'ט', printed_marker: '(ט)' },
    { component: '1', printed_marker: '(1)' },
  ]);
  assert.equal(composeChildIdentifier('3', 'ט1')?.source_display_identifier, '3(ט1)');
  assert.equal(composeChildIdentifier('3(ט)', '1')?.source_display_identifier, '3(ט)(1)');
  assert.notEqual(
    composeChildIdentifier('3', 'ט1')?.normalized_machine_identifier,
    composeChildIdentifier('3(ט)', '1')?.normalized_machine_identifier,
  );
});

test('layout detector reconstructs 3(ט1) from split mixed tokens', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסה', 700, { eol: true }),
        item('הכנסה חייבת במס ( 1 ט )', 680, { x: 40, eol: true }),
        item('(ט)', 640, { x: 40, eol: true }),
        item('(1)', 620, { x: 80, eol: true }),
      ]),
    ],
    catalog,
  );
  const byId = new Map(detected.drafts.map((row) => [row.source_display_identifier ?? '', row]));
  assert.equal(byId.get('3(ט1)')?.printed_marker, '(ט1)');
  assert.equal(byId.get('3(ט)')?.printed_marker, '(ט)');
  assert.equal(byId.get('3(ט)(1)')?.printed_marker, '(1)');
  assert.ok(byId.get('3(ט1)'));
  assert.ok(byId.get('3(ט)(1)'));
  assert.notEqual(byId.get('3(ט1)')?.normalized_machine_identifier, byId.get('3(ט)(1)')?.normalized_machine_identifier);
});

test('self-referential בסעיף קטן זה defines 3(ט1) and stays distinct from 3(ט)(1)', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסות אחרות', 700, { eol: true }),
        item('(ט)', 680, { eol: true }),
        item('(1)', 660, { eol: true }),
        item('בסעיף קטן זה – ( 1 ) ( 1 ט )', 500, { eol: true }),
        item('לפי סעיף 3(ט1) לא יחול', 200, { eol: true }),
      ]),
    ],
    catalog,
  );
  const byId = new Map(detected.drafts.map((row) => [row.source_display_identifier ?? '', row]));
  assert.equal(byId.get('3(ט1)')?.printed_marker, '(ט1)');
  assert.equal(byId.get('3(ט1)')?.kind_label, 'סעיף קטן');
  assert.equal(byId.get('3(ט1)')?.parent_index, detected.drafts.findIndex((row) => row.source_display_identifier === '3'));
  assert.equal(byId.get('3(ט)(1)')?.printed_marker, '(1)');
  assert.notEqual(byId.get('3(ט1)')?.normalized_machine_identifier, byId.get('3(ט)(1)')?.normalized_machine_identifier);
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '3(ט1)').length, 1);
});

test('self-ref opener still defines when amendment stamp and footnote sit on the same line', () => {
  assert.equal(
    lineLooksLikeDefiningNestedStructure("2016 תשע\"ז- ( 235 תיקון מס' ) בסעיף קטן זה – ( 1 ) [1] ( 1 ט )"),
    true,
  );
  assert.deepEqual(
    extractTrailingStructuralMarkers("2016 תשע\"ז- ( 235 תיקון מס' ) בסעיף קטן זה – ( 1 ) [1] ( 1 ט )").map(
      (row) => row.component,
    ),
    ['ט1', '1'],
  );
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסות אחרות', 700, { eol: true }),
        item("2016 תשע\"ז- ( 235 תיקון מס' ) בסעיף קטן זה – ( 1 ) [1] ( 1 ט )", 500, { eol: true }),
        item('לפי סעיף 3(ט1) כנוסחו בסעיף לא יחול', 200, { eol: true }),
      ]),
    ],
    catalog,
  );
  const hits = detected.drafts.filter((row) => row.source_display_identifier === '3(ט1)');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.printed_marker, '(ט1)');
  assert.equal(hits[0]?.kind_label, 'סעיף קטן');
  assert.equal(
    detected.drafts.some((row) => row.source_display_identifier === '3(ט1)' && /לפי סעיף/.test(row.excerpt ?? '')),
    false,
  );
});

test('amendment-history apparatus does not persist nested citations as structure', () => {
  const items = [
    item("תיקון מס' 197", 800, { fs: 11, eol: true }),
    item("158 עמ' 25.12.2013 מיום 2422 ס\"ח תשע\"ד מס'", 780, { fs: 11, eol: true }),
    item('לפקודה, כנוסחו בסעיף ( 1 ט ) 3 הוראות סעיף', 760, { fs: 11, eol: true }),
    item('פסקאות ( 1 ) עד ( 9 ) לא יחולו', 740, { fs: 11, eol: true }),
    item('12(13)(א) הכנסה שהופקה ביום האמור', 720, { fs: 11, eol: true }),
    item('והוראות מעבר.', 700, { fs: 11, eol: true }),
    item('. 30', 680, { fs: 11, eol: true }),
    item('העמית או העובד שאינו גמלאי כאמור לא נפטר לפני יום התחילה ( א )', 660, { fs: 11, eol: true }),
  ].map((row, index) => ({ ...row, i: index, fs: 11 }));
  const detected = detectStructureCandidatesFromLayout(
    [{ page_no: 307, text: items.map((row) => row.s).join(' '), layout: { v: 1 as const, h: 841.89, items } }],
    catalog,
  );
  assert.equal(detected.drafts.length, 0);
  assert.equal(detected.drafts.some((row) => row.source_display_identifier === '3(ט1)'), false);
  assert.equal(detected.drafts.some((row) => /12\(13\)/.test(row.source_display_identifier ?? '')), false);
  assert.equal(detected.drafts.some((row) => row.source_display_identifier === '30'), false);
  assert.equal(detected.drafts.some((row) => (row.source_display_identifier ?? '').includes('(1)')), false);
});

test('letter after a deeper list jumps back to the seif-katan sequence', () => {
  const stack: Parameters<typeof resolveNestedParent>[0] = [
    { index: 0, component: 'א', markerClass: 'letter', depth: 1, display: '1(א)' },
    { index: 1, component: '4', markerClass: 'number', depth: 2, display: '1(א)(4)' },
    { index: 2, component: 'ו', markerClass: 'letter', depth: 3, display: '1(א)(4)(ו)' },
  ];
  const resolved = resolveNestedParent(stack, 'ב');
  assert.equal(resolved.parent, null);
  assert.equal(stack.length, 0);
});

test('preferSeifKatan does not steal a nested letter that continues the current list', () => {
  const stack: Parameters<typeof resolveNestedParent>[0] = [
    { index: 0, component: 'א', markerClass: 'letter', depth: 1, display: '1(א)' },
    { index: 1, component: '2', markerClass: 'number', depth: 2, display: '1(א)(2)' },
    { index: 2, component: 'א', markerClass: 'letter', depth: 3, display: '1(א)(2)(א)' },
  ];
  const resolved = resolveNestedParent(stack, 'ב', { preferSeifKatan: true });
  assert.equal(resolved.action, 'sibling');
  assert.equal(resolved.parent?.display, '1(א)(2)');
  assert.equal(stack.length, 2);
});

test('same-source-span duplicates collapse; different lines with conflicting titles do not', () => {
  const base = {
    candidate_kind: 'structure' as const,
    candidate_status: 'needs_review' as const,
    kind_label: 'פסקה',
    node_number: '1',
    normalized_machine_identifier: '1(א)(1)',
    parent_index: 0,
    page_start: 14,
    page_end: 14,
    excerpt: 'פסקה 1(א)(1)',
    confidence: 0.58,
    validation_warnings: ['layout_needs_owner_review'],
  };
  const collapsed = collapseSameSourceOccurrenceDrafts([
    { ...base, title: 'לשם קביעת מקום מרכז חייו', source_line_index: 4, confidence: 0.58 },
    { ...base, title: 'לשם קביעת מקום מרכז חייו של יחיד', source_line_index: 4, confidence: 0.8, validation_warnings: [] },
  ]);
  assert.equal(collapsed.drafts.length, 1);
  assert.equal(collapsed.collapsed, 1);
  assert.equal(collapsed.drafts[0]?.confidence, 0.8);

  const kept = collapseSameSourceOccurrenceDrafts([
    { ...base, title: 'לשם קביעת מקום מרכז חייו', source_line_index: 4 },
    { ...base, title: 'הוא התאגד בישראל', source_line_index: 31 },
  ]);
  assert.equal(kept.drafts.length, 2);
  assert.equal(kept.collapsed, 0);
});

test('1(א)(1) is not reused for later 1(ב)(1); citation parens are not siblings', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('1.', 720, { eol: true }),
        item('הגדרות', 700, { eol: true }),
        item('לגבי יחיד – מי שמרכז חייו בישראל; ולענין זה יחולו הוראות אלה: ( א )', 680, { eol: true }),
        item('לשם קביעת מקום מרכז חייו של יחיד, יובאו בחשבון מכלול קשריו ( 1 )', 660, { eol: true }),
        item('מקום ביתו הקבוע; ( א )', 640, { eol: true }),
        item('מקום המגורים שלו ושל בני משפחתו; ( ב )', 620, { eol: true }),
        item('חזקה היא שמרכז חייו של יחיד בשנת המס הוא בישראל - ( 2 )', 600, { eol: true }),
        item('ימים או יותר; 183 אם שהה בישראל בשנת המס ( א )', 590, { eol: true }),
        item('ימים או יותר, וסך כל תקופת שהייתו 30 אם שהה בישראל בשנת המס ( ב )', 580, { eol: true }),
        item('שר האוצר, באישור ועדת הכספים של הכנסת, רשאי לקבוע תנאים ולפיהם ( 4 )', 560, { eol: true }),
        item('הוא עובד מדינת ישראל; ( א )', 540, { eol: true }),
        item('הוא עובד רשות מקומית בישראל; ( ב )', 520, { eol: true }),
        item('הוא עובד חברה ממשלתית; ( ה )', 500, { eol: true }),
        item('הוא עובד רשות ממלכתית או תאגיד שהוקם לפי חוק, ( ו )', 480, { eol: true }),
        item('כתושב ישראל, ובלבד ( 2 ) ו- ( 1 ) יראו יחיד שאינו תושב ישראל לפי פסקאות', 460, { eol: true }),
        item('לגבי חבר בני אדם - חבר בני אדם שהתקיים בו אחד מאלה: ( ב )', 440, { eol: true }),
        item('הוא התאגד בישראל; ( 1 )', 420, { eol: true }),
      ]),
    ],
    catalog,
  );
  const hitsA = detected.drafts.filter((row) => row.source_display_identifier === '1(א)(1)');
  const hitsB = detected.drafts.filter((row) => row.source_display_identifier === '1(ב)(1)');
  const seifKatanB = detected.drafts.filter((row) => row.source_display_identifier === '1(ב)');
  assert.equal(hitsA.length, 1);
  assert.equal(hitsB.length, 1);
  assert.equal(seifKatanB.length, 1);
  assert.match(String(seifKatanB[0]?.title), /חבר בני אדם/);
  assert.match(String(hitsA[0]?.title), /מרכז חייו/);
  assert.match(String(hitsB[0]?.title), /התאגד/);
  assert.equal(
    detected.drafts.some((row) => row.source_display_identifier === '1(ב)' && /ימים או יותר/.test(row.title ?? '')),
    false,
  );
  assert.ok(detected.drafts.some((row) => row.source_display_identifier === '1(א)(2)(ב)'));
  assert.equal(
    detected.drafts.some((row) => row.source_display_identifier === '1(א)(1)' && /התאגד/.test(row.title ?? '')),
    false,
  );
});

test('locative בסעיף 3(ט) attaches to the seif, not the previous seif-katan child', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסות אחרות', 700, { eol: true }),
        item('אדם שקיבל סכומים מפדיון של מניות ( 1 ) ( ג )', 680, { eol: true }),
        item('על חלק מסכום ההכנסה שעד 35%, יהיה חייב במס בשיעור של ( ט ) 3 בסעיף', 660, { eol: true }),
        item('"חלק מסכום ההכנסה שעד למועד הקובע" – חלק מסכום ההכנסה שיחסו לכלל', 650, { eol: true }),
        item('"יתרת סכום ההכנסה" – הסכום המתקבל מהפחתת חלק מסכום ההכנסה שעד', 640, { eol: true }),
        item('( 1 ) החברה המשלמת תנכה את המס בעת תשלום הסכומים כאמור בפסקה ( 2 )', 630, { eol: true }),
      ]),
    ],
    catalog,
  );
  const t = detected.drafts.filter((row) => row.source_display_identifier === '3(ט)');
  const t1 = detected.drafts.filter((row) => row.source_display_identifier === '3(ט)(1)');
  assert.equal(t.length, 1);
  assert.equal(t1.length, 1);
  assert.match(String(t1[0]?.title), /החברה המשלמת/);
  assert.equal(detected.drafts.some((row) => row.source_display_identifier === '3(ב)(1)' && /החברה/.test(row.title ?? '')), false);
});

test('leading (1) that cites another paragraph is kept; later לפי פסקאות (1) is not', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסות', 700, { eol: true }),
        item('(ט)', 680, { eol: true }),
        item('( 1 ) החברה המשלמת תנכה את המס בעת תשלום הסכומים כאמור בפסקה ( 2 )', 660, { eol: true }),
        item('לא יחול על סכומים שקיבל תושב חוץ ( 2 ) ו- ( 1 ) החיוב על פי פסקאות ( 4 )', 640, { eol: true }),
        item('ששולמו על ידי החברה לא יינתנו כניכוי לפי ( 1 ) הסכומים כאמור בפסקה ( 3 )', 620, { eol: true }),
      ]),
    ],
    catalog,
  );
  const hits = detected.drafts.filter((row) => row.source_display_identifier === '3(ט)(1)');
  assert.equal(hits.length, 1);
  assert.match(String(hits[0]?.title), /החברה המשלמת/);
});

test('4א(א)(1) is not reused for 4א(ג)(1)', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('4א.', 720, { eol: true }),
        item('מקום הפקת ההכנסה', 700, { eol: true }),
        item('המקום שבו הופקה או נצמחה הכנסה ( א )', 680, { eol: true }),
        item('לגבי הכנסה מעסק - המקום שבו מתקיימת הפעילות העסקית מניבת ( 1 )', 660, { eol: true }),
        item('לגבי הכנסה מעסקה או מעסק אקראי בעלי אופי מסחרי - המקום שבו ( 2 )', 640, { eol: true }),
        item('לגבי דיבידנד - מקום מושבו של חבר בני האדם משלם הדיבידנד; ( 10 )', 620, { eol: true }),
        item('לגבי השתכרות או רווח מהימורים ( 11 )', 600, { eol: true }),
        item('(ב)', 580, { eol: true }),
        item('על אף האמור בסעיף קטן זה', 570, { eol: true }),
        item('שר האוצר, באישור ועדת הכספים של הכנסת, רשאי לקבוע - ( ג )', 560, { eol: true }),
        item('לגבי הכנסה שהופקה ביותר ממקום אחד ולא נקבעה לגביה הוראה אחרת - ( 1 )', 540, { eol: true }),
      ]),
    ],
    catalog,
  );
  const a1 = detected.drafts.filter((row) => row.source_display_identifier === '4א(א)(1)');
  const c1 = detected.drafts.filter((row) => row.source_display_identifier === '4א(ג)(1)');
  assert.equal(a1.length, 1);
  assert.equal(c1.length, 1);
  assert.match(String(a1[0]?.title), /מעסק/);
  assert.match(String(c1[0]?.title), /יותר ממקום אחד/);
});

test('schedule חלק א is parented under תוספת and not collapsed into body חלק א', () => {
  const withAppendix = [...catalog, { id: '7', label: 'תוספת' }];
  const body = {
    page_no: 12,
    text: "חלק א': פרשנות",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [
        item("חלק א': פרשנות", 700, { eol: true, i: 0 }),
        item('1.', 680, { eol: true, i: 1 }),
        item('הגדרות', 660, { eol: true, i: 2 }),
      ],
    },
  };
  const schedule = {
    page_no: 269,
    text: "תוספת ראשונה חלק א'",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [
        item('תוספת ראשונה', 400, { eol: true, i: 0 }),
        item('( 11 סעיף )', 380, { eol: true, i: 1 }),
        item("חלק א'", 360, { eol: true, i: 2 }),
      ],
    },
  };
  const detected = detectStructureCandidatesFromLayout([body, schedule], withAppendix);
  const chelek = detected.drafts.filter((row) => row.kind_label === 'חלק' && row.source_display_identifier === "א'");
  const tosefet = detected.drafts.find((row) => row.kind_label === 'תוספת');
  assert.equal(chelek.length, 2);
  assert.ok(tosefet);
  assert.equal(chelek[0]?.parent_index, null);
  assert.equal(chelek[0]?.page_start, 12);
  assert.equal(chelek[1]?.page_start, 269);
  assert.equal(chelek[1]?.parent_index, detected.drafts.findIndex((row) => row.kind_label === 'תוספת'));
});

test('schedule תוספת near the page bottom is not dropped as a running header', () => {
  const withAppendix = [...catalog, { id: '7', label: 'תוספת' }];
  const body = {
    page_no: 12,
    text: "חלק א': פרשנות",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [item("חלק א': פרשנות", 700, { eol: true, i: 0, fs: 14 })],
    },
  };
  const schedule = {
    page_no: 269,
    text: "תוספת ראשונה חלק א'",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [
        item('סעיף 243', 400, { eol: true, i: 0, fs: 12 }),
        item('תוספת ראשונה', 167, { eol: true, i: 1, fs: 9 }),
        item("חלק א'", 138, { eol: true, i: 2, fs: 12 }),
      ],
    },
  };
  const detected = detectStructureCandidatesFromLayout([body, schedule], withAppendix);
  const tosefet = detected.drafts.filter((row) => row.kind_label === 'תוספת');
  const chelek = detected.drafts.filter((row) => row.kind_label === 'חלק' && row.source_display_identifier === "א'");
  assert.equal(tosefet.length, 1);
  assert.equal(tosefet[0]?.page_start, 269);
  assert.equal(chelek.length, 2);
  assert.equal(chelek[1]?.parent_index, detected.drafts.findIndex((row) => row.kind_label === 'תוספת'));
});

test('schedule running header תוספת ראשונה א does not steal the schedule parent', () => {
  const withAppendix = [...catalog, { id: '7', label: 'תוספת' }];
  const body = {
    page_no: 12,
    text: "חלק א': פרשנות",
    layout: { v: 1 as const, h: 841.89, items: [item("חלק א': פרשנות", 700, { eol: true, i: 0, fs: 14 })] },
  };
  const bodyB = {
    page_no: 16,
    text: "חלק ב': הטלת המס",
    layout: { v: 1 as const, h: 841.89, items: [item("חלק ב': הטלת המס", 700, { eol: true, i: 0, fs: 14 })] },
  };
  const scheduleEnd = {
    page_no: 269,
    text: "תוספת ראשונה חלק א'",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [
        item('תוספת ראשונה', 167, { eol: true, i: 0, fs: 9 }),
        item("חלק א'", 138, { eol: true, i: 1, fs: 12 }),
      ],
    },
  };
  const scheduleNext = {
    page_no: 270,
    text: "תוספת ראשונה א' חלק ב' התוספת השניה",
    layout: {
      v: 1 as const,
      h: 841.89,
      items: [
        item("תוספת ראשונה א'", 760, { eol: true, i: 0, fs: 9 }),
        item("חלק ב'", 700, { eol: true, i: 1, fs: 12 }),
        item('התוספת השניה', 400, { eol: true, i: 2, fs: 12 }),
      ],
    },
  };
  const detected = detectStructureCandidatesFromLayout([body, bodyB, scheduleEnd, scheduleNext], withAppendix);
  const tosefetFirst = detected.drafts.filter((row) => row.kind_label === 'תוספת' && row.source_display_identifier === 'ראשונה');
  const chelekA = detected.drafts.filter((row) => row.kind_label === 'חלק' && row.source_display_identifier === "א'");
  const chelekB = detected.drafts.filter((row) => row.kind_label === 'חלק' && row.source_display_identifier === "ב'");
  const firstSchedule = detected.drafts.findIndex((row) => row.kind_label === 'תוספת' && row.source_display_identifier === 'ראשונה');
  assert.equal(tosefetFirst.length, 1);
  assert.equal(tosefetFirst[0]?.page_start, 269);
  assert.equal(chelekA[1]?.parent_index, firstSchedule);
  assert.equal(chelekB[1]?.parent_index, firstSchedule);
});

test('repeated (1) under the same parent is skipped, not stored as a sibling', () => {
  const stack: Parameters<typeof resolveNestedParent>[0] = [
    { index: 0, component: 'ט', markerClass: 'letter', depth: 1, display: '3(ט)' },
    { index: 1, component: '1', markerClass: 'number', depth: 2, display: '3(ט)(1)' },
  ];
  const resolved = resolveNestedParent(stack, '1');
  assert.equal(resolved.action, 'skip');
  assert.equal(stack.length, 2);
});

test('mixed ה3 attaches to the seif so later (1) is not another 3(ט)(1)', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('3.', 720, { eol: true }),
        item('הכנסות', 700, { eol: true }),
        item('(ט)', 680, { eol: true }),
        item('( 1 ) החברה המשלמת תנכה את המס בעת תשלום הסכומים כאמור בפסקה ( 2 )', 660, { eol: true }),
        item('סכומים ששילמו כל מעבידיו של עובד, בעבורו, לקופות גמל לקצבה, על ( 1 ) ( 3 ה )', 640, { eol: true }),
      ]),
    ],
    catalog,
  );
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '3(ט)(1)').length, 1);
  assert.ok(detected.drafts.some((row) => row.source_display_identifier === '3(ה3)'));
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '3(ה3)(1)').length, 1);
});

test('long רשאי letter after numbered children is the next seif-katan, not a duplicate (1)', () => {
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('4א.', 720, { eol: true }),
        item('מקום הפקת ההכנסה', 700, { eol: true }),
        item('המקום שבו הופקה או נצמחה הכנסה ( א )', 680, { eol: true }),
        item('לגבי הכנסה מעסק - המקום שבו מתקיימת הפעילות העסקית מניבת ( 1 )', 660, { eol: true }),
        item('לגבי דיבידנד - מקום מושבו של חבר בני האדם משלם הדיבידנד; ( 10 )', 640, { eol: true }),
        item('לגבי השתכרות או רווח מהימורים ( 11 )', 620, { eol: true }),
        item('(ב)', 600, { eol: true }),
        item('על אף האמור בסעיף קטן זה', 580, { eol: true }),
        item('(1)', 560, { eol: true }),
        item('שר האוצר, באישור ועדת הכספים של הכנסת, רשאי לקבוע - ( ג )', 540, { eol: true }),
        item('לגבי הכנסה שהופקה ביותר ממקום אחד ולא נקבעה לגביה הוראה אחרת - ( 1 )', 520, { eol: true }),
      ]),
    ],
    catalog,
  );
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '4א(א)(1)').length, 1);
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '4א(ב)(1)').length, 1);
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '4א(ג)').length, 1);
  assert.equal(detected.drafts.filter((row) => row.source_display_identifier === '4א(ג)(1)').length, 1);
  assert.match(String(detected.drafts.find((row) => row.source_display_identifier === '4א(ג)(1)')?.title), /יותר ממקום אחד/);
});

test('quoted definition term local (1) does not duplicate the prior seif-katan paragraph', () => {
  assert.equal(lineLooksLikeQuotedDefinitionTerm('"קיצבה" –'), true);
  assert.equal(lineLooksLikeLeadingParenHeading('( 1 ) החברה המשלמת תנכה'), true);
  const detected = detectStructureCandidatesFromLayout(
    [
      page([
        item('1.', 720, { eol: true }),
        item('הגדרות', 700, { eol: true }),
        item('לגבי חבר בני אדם - חבר בני אדם שהתקיים בו אחד מאלה: ( ב )', 680, { eol: true }),
        item('הוא התאגד בישראל; ( 1 )', 660, { eol: true }),
        item('השליטה על עסקיו וניהולם מופעלים בישראל; ( 2 )', 640, { eol: true }),
        item('"קיצבה" –', 620, { eol: true }),
        item('קיצבה המשתלמת מאת מעביד לשעבר; ( 1 )', 600, { eol: true }),
        item('קיצבה המשתלמת מאת קופת גמל; ( 2 )', 580, { eol: true }),
      ]),
    ],
    catalog,
  );
  const b1 = detected.drafts.filter((row) => row.source_display_identifier === '1(ב)(1)');
  assert.equal(b1.length, 1);
  assert.match(String(b1[0]?.title), /התאגד/);
  assert.equal(
    detected.drafts.some((row) => row.source_display_identifier === '1(ב)(1)' && /קיצב/.test(row.title ?? '')),
    false,
  );
});

test('same-parent identity extras are dropped and conflicting survivor stays needs review', () => {
  const base = {
    candidate_kind: 'structure' as const,
    candidate_status: 'proposed' as const,
    kind_label: 'פסקה',
    node_number: '1',
    normalized_machine_identifier: '3(ט)(1)',
    parent_index: 4,
    page_start: 19,
    page_end: 19,
    excerpt: 'פסקה 3(ט)(1)',
    confidence: 0.8,
    validation_warnings: [] as string[],
  };
  const dropped = dropSameParentIdentityDuplicates([
    { ...base, title: 'החברה המשלמת', source_line_index: 13 },
    { ...base, title: 'לפחות מהון המניות', source_line_index: 40, page_start: 23, confidence: 0.58 },
  ]);
  assert.equal(dropped.drafts.length, 1);
  assert.equal(dropped.dropped, 1);
  assert.equal(dropped.drafts[0]?.title, 'החברה המשלמת');
  assert.equal(dropped.drafts[0]?.candidate_status, 'needs_review');
  assert.ok(dropped.drafts[0]?.validation_warnings.includes('duplicate_identity_resolved'));
});

