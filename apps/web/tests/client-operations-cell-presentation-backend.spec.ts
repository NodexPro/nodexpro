import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientOperationsCellPresentationCommandCells,
  CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND,
  hydrateClientOperationsUserCellFormatting,
  parseClientOperationsPresentationMapKey,
  resolveClientOperationsPresentationRowIdentity,
} from '../src/lib/client-operations-cell-presentation.pure.js';
import { clientOperationsCellAllowsDecorativeFill } from '../src/lib/client-operations-format-selection.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');

const CLIENT_A = '11111111-1111-4111-8111-111111111111';

test('one cell and a selected range become a single named bulk command', () => {
  const previous = {};
  const next = {
    [`${CLIENT_A}::vat`]: { fill: '#9d4edd', fontSize: 16, bold: true },
    [`${CLIENT_A}::notes`]: { italic: true },
    'manual:01::client_name': { align: 'center' as const },
  };
  const cells = buildClientOperationsCellPresentationCommandCells({ previous, next });
  assert.equal(cells.length, 3);
  assert.equal(cells.every((cell) => cell.row_kind === 'client' || cell.row_kind === 'manual'), true);
  assert.equal(
    cells.some((cell) => cell.row_kind === 'client' && cell.row_id === CLIENT_A && cell.column_key === 'vat'),
    true,
  );
  assert.equal(
    cells.some((cell) => cell.row_kind === 'manual' && cell.row_id === 'manual:01' && cell.column_key === 'client_name'),
    true,
  );
  assert.equal(CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND, 'set_client_operations_cell_presentation');
  const persistStart = viewSource.indexOf('const persistCellPresentation =');
  const persistSlice = viewSource.slice(persistStart, persistStart + 1800);
  assert.match(persistSlice, /command: CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND/);
  assert.equal((persistSlice.match(/onRegistryCommand\(/g) ?? []).length, 1);
});

test('period switch clears painted formatting until the matching aggregate arrives', () => {
  assert.match(pageSource, /setUserCellFormatting\(\{\}\)/);
  assert.match(pageSource, /hydrateClientOperationsUserCellFormatting\(data\?\.user_cell_formatting\)/);
  const oct = hydrateClientOperationsUserCellFormatting({
    [`${CLIENT_A}::vat`]: { fill: '#ff0000' },
  });
  const empty = hydrateClientOperationsUserCellFormatting(undefined);
  assert.equal(oct[`${CLIENT_A}::vat`]?.fill, '#ff0000');
  assert.deepEqual(empty, {});
});

test('stable identities reject row index / display name; custom + manual keys survive reload hydrate', () => {
  assert.equal(resolveClientOperationsPresentationRowIdentity('3'), null);
  assert.equal(resolveClientOperationsPresentationRowIdentity('לקוח א'), null);
  assert.deepEqual(resolveClientOperationsPresentationRowIdentity(CLIENT_A), {
    row_kind: 'client',
    row_id: CLIENT_A,
  });
  assert.deepEqual(parseClientOperationsPresentationMapKey('manual:04::user_slot_02'), {
    identity: 'manual:04',
    columnKey: 'user_slot_02',
  });
  const hydrated = hydrateClientOperationsUserCellFormatting({
    [`${CLIENT_A}::user_slot_02`]: { wrap: true },
    'manual:04::notes': { underline: true },
    '3::vat': { bold: true },
  });
  assert.equal(hydrated[`${CLIENT_A}::user_slot_02`]?.wrap, true);
  assert.equal(hydrated['manual:04::notes']?.underline, true);
  assert.equal(hydrated['3::vat'], undefined);
});

test('system filing/payment/overdue chrome still beats decorative fill', () => {
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'vat',
      reportingTone: 'overdue',
    }),
    false,
  );
  assert.equal(
    clientOperationsCellAllowsDecorativeFill({
      columnKey: 'vat',
      filingChrome: 'filed_unpaid',
    }),
    false,
  );
  assert.match(viewSource, /background: statusToken \|\| !allowDecorativeFill \? undefined : presentation\?\.fill/);
  assert.match(viewSource, /paintCellManualStatus/);
});

test('view no longer writes localStorage for cell formatting; undo/redo use the same bulk command', () => {
  assert.doesNotMatch(viewSource, /saveClientOperationsCellPresentation\(/);
  assert.doesNotMatch(viewSource, /loadClientOperationsCellPresentation\(/);
  assert.match(viewSource, /persistCellPresentation\(previous, current\)/);
  assert.match(viewSource, /persistCellPresentation\(next\.presentation, current\)/);
});
