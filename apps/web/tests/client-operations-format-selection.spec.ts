/**
 * Spreadsheet format selection — click / shift / drag / ctrl / ctrl+a.
 * Presentation-only: no backend command and no persisted selection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyFormatSelectionGesture,
  clientOperationsSelectionFrameEdges,
  clientOperationsSelectionGesture,
  formatDragExceededThreshold,
  listClientOperationsFormatSelectionKeys,
  listClientOperationsTableSelectionKeys,
  shouldSuppressFormatSelectionClick,
  tableSelectionRange,
} from '../src/lib/client-operations-format-selection.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../src/lib/client-operations-format-selection.pure.ts'),
  'utf8',
);

const rowIds = ['c1', 'c2', 'c3'];
const columnKeys = ['client_name', 'vat', 'notes'];
const columnKeysWithFolder = ['client_name', 'vat', 'folder', 'notes'];

test('click selects one cell; shift builds a rectangle; ctrl adds a disjoint cell', () => {
  assert.equal(clientOperationsSelectionGesture({}), 'replace');
  assert.equal(clientOperationsSelectionGesture({ shiftKey: true }), 'extend');
  assert.equal(clientOperationsSelectionGesture({ ctrlKey: true }), 'add');
  assert.equal(clientOperationsSelectionGesture({ metaKey: true }), 'add');
  const click = applyFormatSelectionGesture({
    gesture: 'replace',
    next: { clientId: 'c2', colKey: 'vat' },
    ranges: [],
    focused: null,
  });
  const shift = applyFormatSelectionGesture({
    gesture: 'extend',
    next: { clientId: 'c3', colKey: 'notes' },
    ranges: click,
    focused: click[0]!.focus,
  });
  const keys = listClientOperationsFormatSelectionKeys({
    range: null,
    ranges: shift,
    focused: shift[0]!.focus,
    rowIds,
    columnKeys,
  });
  assert.deepEqual(keys, ['c2::vat', 'c2::notes', 'c3::vat', 'c3::notes']);
  const added = applyFormatSelectionGesture({
    gesture: 'add',
    next: { clientId: 'c1', colKey: 'client_name' },
    ranges: shift,
    focused: shift[0]!.focus,
  });
  const addedKeys = listClientOperationsFormatSelectionKeys({
    range: null,
    ranges: added,
    focused: added[added.length - 1]!.focus,
    rowIds,
    columnKeys,
  });
  assert.ok(addedKeys.includes('c1::client_name'));
  assert.ok(addedKeys.includes('c2::vat'));
  assert.equal(addedKeys.includes('c1::vat'), false);
});

test('ctrl+a selects the available table area and skips folder', () => {
  const keys = listClientOperationsTableSelectionKeys({
    clientIds: ['c1', 'c2'],
    manualRowKeys: ['manual:01'],
    columnKeys: columnKeysWithFolder,
  });
  assert.ok(keys.includes('c1::vat'));
  assert.ok(keys.includes('manual:01::notes'));
  assert.equal(keys.some((key) => key.endsWith('::folder')), false);
  const range = tableSelectionRange({
    clientIds: ['c1', 'c2'],
    manualRowKeys: ['manual:01'],
    columnKeys,
  });
  assert.equal(range?.anchor.clientId, 'c1');
  assert.equal(range?.focus.rowKey, 'manual:01');
});

test('selection frame uses logical edges so RTL and scroll keep one rectangle', () => {
  const keys = ['c1::vat', 'c1::notes', 'c2::vat', 'c2::notes'];
  const topStart = clientOperationsSelectionFrameEdges({
    keys,
    cell: { clientId: 'c1', colKey: 'vat' },
    rowIds,
    columnKeys,
  });
  assert.deepEqual(topStart, {
    blockStart: true,
    blockEnd: false,
    inlineStart: true,
    inlineEnd: false,
  });
  const inner = clientOperationsSelectionFrameEdges({
    keys,
    cell: { clientId: 'c2', colKey: 'notes' },
    rowIds,
    columnKeys,
  });
  assert.equal(inner?.blockEnd, true);
  assert.equal(inner?.inlineEnd, true);
  assert.match(cssSource, /--nx-co-sel-inline-start/);
  assert.match(cssSource, /is-sel-edge-inline-start/);
});

test('drag click leftover and modifier gestures do not reset the range', () => {
  assert.equal(shouldSuppressFormatSelectionClick({ dragMoved: true, gesture: 'replace' }), true);
  assert.equal(shouldSuppressFormatSelectionClick({ dragMoved: false, gesture: 'extend' }), true);
  assert.equal(shouldSuppressFormatSelectionClick({ dragMoved: false, gesture: 'replace' }), false);
  assert.equal(
    formatDragExceededThreshold({ startX: 0, startY: 0, x: 4, y: 0 }),
    true,
  );
  assert.match(viewSource, /consumeFormatSelectionClick/);
  assert.match(viewSource, /beginFormatPointerSelection/);
  assert.match(viewSource, /selectAllFormatCells/);
  assert.match(viewSource, /event\.key\.toLowerCase\(\) === 'a'/);
  assert.doesNotMatch(pureSource, /fetch\(|onRegistryCommand|set_client_operations/);
});
