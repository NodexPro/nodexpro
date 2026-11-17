import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_FILL_WHITE,
  clientOperationsFillPaletteFlat,
  clientOperationsFillPaletteGroups,
  normalizeClientOperationsFill,
} from '../src/lib/client-operations-fill-palette.pure.ts';
import {
  clientOperationsCellAllowsDecorativeFill,
  listClientOperationsFormatSelectionKeys,
} from '../src/lib/client-operations-format-selection.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);
const he = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');
const en = readFileSync(join(dir, '../src/i18n/en.json'), 'utf8');
const ru = readFileSync(join(dir, '../src/i18n/ru.json'), 'utf8');

test('palette has 8 groups × 10 shades = 80 plus white', () => {
  const groups = clientOperationsFillPaletteGroups();
  assert.equal(groups.length, 8);
  for (const group of groups) {
    assert.equal(group.length, 10);
    assert.ok(group[0]!.hex !== group[9]!.hex);
  }
  assert.equal(clientOperationsFillPaletteFlat().length, 80);
  assert.equal(CLIENT_OPERATIONS_FILL_WHITE, '#ffffff');
  assert.equal(normalizeClientOperationsFill(''), null);
  assert.equal(normalizeClientOperationsFill('#AABBCC'), '#aabbcc');
});

test('decorative fill is blocked on system obligation chrome', () => {
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'vat',
      filingChrome: 'filed_unpaid',
    }),
    false,
  );
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'vat',
      reportingTone: 'overdue',
    }),
    false,
  );
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'client_name',
    }),
    true,
  );
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'folder',
    }),
    false,
  );
});

test('rectangle selection lists every cell once; mixed kinds stay two keys', () => {
  const keys = listClientOperationsFormatSelectionKeys({
    range: {
      anchor: { clientId: 'a', colKey: 'client_name' },
      focus: { clientId: 'c', colKey: 'notes' },
    },
    focused: { clientId: 'c', colKey: 'notes' },
    rowIds: ['a', 'b', 'c'],
    columnKeys: ['folder', 'client_name', 'notes'],
  });
  assert.equal(keys.length, 6);
  assert.ok(keys.includes('a::client_name'));
  assert.ok(keys.includes('c::notes'));
  const mixed = listClientOperationsFormatSelectionKeys({
    range: {
      anchor: { clientId: 'a', colKey: 'client_name' },
      focus: { rowKey: 'manual:01', colKey: 'notes' },
    },
    focused: { rowKey: 'manual:01', colKey: 'notes' },
    rowIds: ['a', 'manual:01'],
    columnKeys: ['client_name', 'notes'],
  });
  assert.equal(mixed.length, 2);
});

test('toolbar uses one paint-bucket and persists the whole selection in one write', () => {
  assert.match(viewSource, /data-testid="fill-color-control"/);
  assert.match(viewSource, /nx-co-sheet__fill-bucket-btn/);
  assert.match(viewSource, /data-testid="fill-palette-grid"/);
  assert.match(viewSource, /data-testid="fill-remove"/);
  assert.match(viewSource, /data-testid="fill-white"/);
  assert.match(viewSource, /clientOperationsFillPaletteGroups/);
  assert.match(viewSource, /persistCellPresentation\(next\)/);
  const applyStart = viewSource.indexOf('const applyPresentation =');
  const applySlice = viewSource.slice(applyStart, applyStart + 1600);
  assert.match(applySlice, /for \(const key of targets\)/);
  assert.doesNotMatch(applySlice, /fetch\(|onRegistryCommand/);
  assert.match(viewSource, /clientOperationsCellAllowsDecorativeFill/);
  assert.match(cssSource, /\.nx-co-sheet__fill-palette/);
  assert.match(cssSource, /inset-inline-end:\s*0/);
});

test('fill labels are i18n in he/en/ru and include ללא מילוי', () => {
  assert.match(he, /"removeFill": "ללא מילוי"/);
  assert.match(en, /"removeFill": "No fill"/);
  assert.match(ru, /"removeFill": "Без заливки"/);
  assert.match(viewSource, /t\('clientOperations\.removeFill'\)/);
  assert.match(viewSource, /t\('clientOperations\.fillWhite'\)/);
  assert.match(viewSource, /t\('clientOperations\.chooseFillColor'\)/);
});

test('font-size dropdown is a popover, not a native select blocked by preventDefault', () => {
  const slice = viewSource.slice(
    viewSource.indexOf('data-testid="font-size-control"'),
    viewSource.indexOf('data-testid="font-size-control"') + 900,
  );
  assert.doesNotMatch(slice, /<select/);
  assert.match(viewSource, /nx-co-sheet__font-size-menu/);
  assert.match(viewSource, /CLIENT_OPERATIONS_FONT_SIZES\.map/);
  assert.match(viewSource, /fontSize: sz/);
});
