/**
 * Client Operations — backend-owned manual spreadsheet rows (WEB source contracts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const activeCellSource = readFileSync(
  join(dir, '../src/lib/client-operations-active-cell.pure.ts'),
  'utf8',
);
const printSource = readFileSync(join(dir, '../src/lib/client-operations-print.pure.ts'), 'utf8');

test('עוד toolbar button is hidden (menu implementation retained)', () => {
  assert.match(viewSource, /עוד…/);
  assert.match(viewSource, /data-testid="co-toolbar-more"/);
  const moreBtnIdx = viewSource.indexOf('data-testid="co-toolbar-more"');
  assert.ok(moreBtnIdx > 0);
  const slice = viewSource.slice(moreBtnIdx - 180, moreBtnIdx + 120);
  assert.match(slice, /\bhidden\b/);
  // Underlying more menu (fill / number / borders) must remain in source.
  assert.match(viewSource, /nx-co-sheet__more-menu/);
  assert.match(viewSource, /צבע רקע/);
  assert.match(viewSource, /פורמט מספר/);
  assert.match(viewSource, /גבולות/);
  assert.match(viewSource, /setMoreOpen/);
});

test('page reads manual_rows from aggregate and passes to View', () => {
  assert.match(pageSource, /manual_rows/);
  assert.match(pageSource, /setManualRows/);
  assert.match(pageSource, /manualRows=\{manualRows\}/);
  assert.match(pageSource, /ClientOperationsManualRegistryRow/);
  assert.doesNotMatch(pageSource, /endpoints\.ts/);
});

test('page fires named init command when manual_rows_period_setup.needed (never invents carry)', () => {
  assert.match(pageSource, /manual_rows_period_setup/);
  assert.match(pageSource, /initialize_client_operations_manual_rows_for_period/);
  assert.doesNotMatch(pageSource, /previousOperationalPeriodKey/);
  assert.doesNotMatch(pageSource, /planManualRowCarryForward/);
  assert.doesNotMatch(pageSource, /TABLE_COLUMNS\.match|statusToUi/);
});

test('View renders manual rows from aggregate after client rows', () => {
  assert.match(viewSource, /manualRows\s*=\s*\[\]/);
  assert.match(viewSource, /data-row-kind="manual"/);
  assert.match(viewSource, /data-testid=\{`co-manual-row-\$\{row\.manual_row_slot\}`\}/);
  assert.match(viewSource, /manualRows\.map\(\(row\) =>/);
  // Branch only on backend row_kind / cell_presentation — not column===vat business logic for manual.
  assert.match(viewSource, /cellPres\?\.cell_kind === 'folder'/);
  assert.match(viewSource, /cellPres\?\.cell_kind === 'manual_text'/);
  assert.doesNotMatch(
    viewSource,
    /row_kind === 'manual'[\s\S]{0,200}if \(column(?:\.key)? === 'vat'\)/,
  );
});

test('manual typing uses set_client_operations_manual_row_cell_value — not VAT/payroll commands', () => {
  assert.match(viewSource, /set_client_operations_manual_row_cell_value/);
  assert.match(viewSource, /scheduleManualRowCellAutosave/);
  assert.match(viewSource, /manual_row_slot:\s*meta\.manualRowSlot/);
  assert.match(viewSource, /column_key:\s*meta\.column\.key/);
  const manualSchedule = viewSource.slice(
    viewSource.indexOf('const scheduleManualRowCellAutosave'),
    viewSource.indexOf('const commitManualRowCellEdit'),
  );
  // Immediate first save — no 500ms debounce for manual rows.
  assert.doesNotMatch(manualSchedule, /setTimeout/);
  assert.doesNotMatch(manualSchedule, /,\s*500\)/);
  assert.match(manualSchedule, /kickCustomCellSave/);
  assert.doesNotMatch(manualSchedule, /set_client_operations_cell_manual_status/);
  assert.doesNotMatch(manualSchedule, /set_client_operations_material/);
  assert.doesNotMatch(manualSchedule, /set_client_operations_custom_column_value/);
  // Manual execute branch sends only the manual_row command (slot + column_key).
  const manualCmdIdx = viewSource.indexOf("command: 'set_client_operations_manual_row_cell_value'");
  assert.ok(manualCmdIdx > 0);
  const manualCmdSlice = viewSource.slice(manualCmdIdx, manualCmdIdx + 350);
  assert.match(manualCmdSlice, /manual_row_slot/);
  assert.match(manualCmdSlice, /column_key/);
  assert.doesNotMatch(manualCmdSlice, /client_id:/);
});

test('manual cell editor has no nested form-control border; grid cell is boundary', () => {
  assert.match(viewSource, /nx-co-sheet__manual-cell-input/);
  assert.match(viewSource, /is-editing-manual/);
  const css = readFileSync(
    join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
    'utf8',
  );
  assert.match(css, /\.nx-co-sheet__manual-cell-input/);
  assert.match(css, /border:\s*0\s*!important/);
  assert.match(css, /border-radius:\s*0\s*!important/);
  assert.match(css, /box-shadow:\s*none\s*!important/);
  assert.match(css, /td\.is-editing-manual/);
});

test('manual save path uses applyAggregateRecommended + dirty draft reconcile', () => {
  assert.match(viewSource, /applyAggregateRecommended/);
  assert.match(viewSource, /reconcileManualRowsWithDirtyDrafts/);
  assert.match(viewSource, /manualDraftOverlay/);
  assert.match(viewSource, /manualDraftOverlayKey/);
  assert.match(viewSource, /shouldWriteManualDraftOverlay/);
  assert.match(viewSource, /shouldCacheCellSaveAggregate/);
  // Off-period completion caches via onApplyAggregate without painting.
  assert.match(viewSource, /Off-period completion: cache under response period only/);
  // Persistence starts on change — Enter is optional navigation only.
  assert.match(viewSource, /persistence already started on each keystroke/);
});

test('P0: period switch clears overlay + cellDraft; overlay keys include period', () => {
  assert.match(viewSource, /setManualDraftOverlay\(\{\}\)/);
  assert.match(viewSource, /setCellDraft\(''\)/);
  assert.match(viewSource, /manualDraftOverlayKey\(/);
  assert.match(viewSource, /viewedPeriodForOverlay/);
  assert.match(viewSource, /manualDraftOverlay\[overlayPk\]/);
});

test('formatting / presentation key uses row_key for manual (no fabricated client_id)', () => {
  assert.match(activeCellSource, /rowKey\?:/);
  assert.match(activeCellSource, /clientOperationsPresentationCellKey/);
  assert.match(viewSource, /clientOperationsPresentationCellKey\(focusedCell\)/);
  assert.match(viewSource, /selectActiveFormatCell\(row\.row_key, column, \{ rowKey: row\.row_key \}\)/);
  assert.match(viewSource, /cellKey\(row\.row_key, column\.key\)/);
  // Focused identity for manual uses rowKey — never invents a client UUID.
  assert.doesNotMatch(
    viewSource,
    /row_kind === 'manual'[\s\S]{0,200}clientId:\s*['`]fake/,
  );
  assert.doesNotMatch(
    viewSource,
    /focusedCell:\s*\{\s*clientId:\s*row\.row_key/,
  );
});

test('print excludes empty manual rows; includes filled via selectPrintableManualRows', () => {
  assert.match(printSource, /isManualRowCompletelyEmptyForPrint/);
  assert.match(printSource, /selectPrintableManualRows/);
  assert.match(viewSource, /selectPrintableManualRows\(manualRows\)/);
  assert.match(viewSource, /data-row-kind="manual"/);
});

test('paint mode does not call paint status on manual cells; no client modal / quick profile', () => {
  const manualBlock = viewSource.slice(
    viewSource.indexOf('manualRows.map((row) =>'),
    viewSource.indexOf('manualRows.map((row) =>') + 3500,
  );
  assert.match(manualBlock, /NOT eligible for status paint|are NOT eligible for status paint/i);
  assert.doesNotMatch(manualBlock, /paintCellManualStatus/);
  assert.doesNotMatch(manualBlock, /openClientModal/);
  assert.doesNotMatch(manualBlock, /openQuickProfile/);
  assert.doesNotMatch(manualBlock, /set_client_operations_cell_manual_status/);
});
