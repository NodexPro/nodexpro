import assert from 'node:assert/strict';
import test from 'node:test';
import { detectStructureCandidatesFromLayout } from '../../src/domains/knowledge-trainer/knowledge-trainer-layout.pure.js';
import {
  composeChildIdentifier,
  extractNestedStructureMarker,
  extractParenthesizedMarkersFromTokens,
  extractTrailingStructuralMarkers,
  kindLabelForNestedDepth,
  lineLooksLikeNestedCitationNoise,
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
  assert.equal(lineLooksLikeNestedCitationNoise('לפי סעיף 2(1) של הפקודה'), true);
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
