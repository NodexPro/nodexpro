/**
 * Client Operations — period copy right-click UX contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCopyUserPeriodDataCommandBody,
  sourcePeriodsForUserPeriodDataCopy,
  targetPeriodHasConflictingUserEnteredData,
} from '../src/lib/client-operations-user-period-data-copy.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');

test('1-2 right-click grid opens menu; chrome unrelated not wired', () => {
  assert.match(viewSource, /onContextMenu=\{onGridContextMenu\}/);
  assert.match(viewSource, /data-testid="client-operations-grid-surface"/);
  assert.match(viewSource, /העתק מידע מחודש/);
  assert.match(viewSource, /nx-co-sheet__context-menu/);
  // Sidebar / route chrome are outside this component surface.
  assert.doesNotMatch(viewSource, /AppSidebar[\s\S]{0,40}onContextMenu/);
});

test('3 view-only user does not get copy action', () => {
  assert.match(viewSource, /if \(!canEdit \|\| !onRegistryCommand\) return/);
  assert.match(viewSource, /gridContextMenu && canEdit/);
});

test('4-5 current period excluded; source selection works', () => {
  assert.deepEqual(sourcePeriodsForUserPeriodDataCopy(['2026-07', '2026-08', '2026-09'], '2026-09'), [
    '2026-08',
    '2026-07',
  ]);
  assert.match(viewSource, /onSelectCopySourcePeriod/);
  assert.match(viewSource, /sourcePeriodsForUserPeriodDataCopy/);
  assert.match(viewSource, /userPeriodDataCopySourcePeriods/);
  assert.doesNotMatch(
    viewSource.slice(
      viewSource.indexOf('sourcePeriodsForCopy = useMemo'),
      viewSource.indexOf('collectTargetConflictSignals'),
    ),
    /period\?\.available_periods/,
  );
});

test('6-8 conflict UI + EMPTY_ONLY default + cancel', () => {
  assert.equal(
    targetPeriodHasConflictingUserEnteredData({
      customCellTexts: ['יש ערך'],
      manualCellTexts: [],
    }),
    true,
  );
  assert.match(viewSource, /העתק רק לתאים ריקים/);
  assert.match(viewSource, /החלף את הנתונים הקיימים/);
  assert.match(viewSource, /mode: 'empty_only'/);
  assert.match(viewSource, /setPeriodCopyDialog\(null\)/);
  assert.match(viewSource, /ביטול/);
});

test('9-12 one named command; no per-cell FE writes; aggregate apply; no hidden GET', () => {
  const body = buildCopyUserPeriodDataCommandBody({
    sourcePeriodKey: '2026-08',
    targetPeriodKey: '2026-09',
    mode: 'empty_only',
    query: { q: null, operational_period_key: '2026-09' },
  });
  assert.equal(body.command, 'copy_client_operations_user_period_data');
  assert.match(viewSource, /buildCopyUserPeriodDataCommandBody/);
  assert.match(viewSource, /executePeriodDataCopy/);
  assert.doesNotMatch(
    viewSource.slice(viewSource.indexOf('executePeriodDataCopy'), viewSource.indexOf('onSelectCopySourcePeriod')),
    /set_client_operations_custom_column_value|set_client_operations_manual_row_cell_value/,
  );
  assert.match(viewSource, /await onRegistryCommand\(/);
  assert.doesNotMatch(
    viewSource.slice(viewSource.indexOf('executePeriodDataCopy'), viewSource.indexOf('onSelectCopySourcePeriod')),
    /onReloadRegistry\(|apiFetch\(|apiJson\(/,
  );
});

test('FE binds copy menu to backend user_period_data_copy_source_periods only', () => {
  const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(pageSource, /user_period_data_copy_source_periods/);
  assert.match(pageSource, /setUserPeriodDataCopySourcePeriods/);
  assert.match(pageSource, /userPeriodDataCopySourcePeriods=\{userPeriodDataCopySourcePeriods\}/);
  assert.match(viewSource, /userPeriodDataCopySourcePeriods/);
  assert.doesNotMatch(viewSource, /buildClientOperationsOperationalPeriodKey\([\s\S]{0,80}copy/);
  assert.doesNotMatch(pageSource, /user_period_data_copy_source_periods[\s\S]{0,120}new Date/);
});

test('13-18 regressions retained for periods/search/folder/manual/custom', () => {
  assert.match(viewSource, /ClientOperationsPeriodSheetTabs/);
  assert.match(viewSource, /applyLiveSearch/);
  assert.match(viewSource, /120/);
  assert.match(viewSource, /openClientModal|ClientOperationsFolderIcon|nx-co-sheet__folder/);
  assert.match(viewSource, /manualRows/);
  assert.match(viewSource, /set_client_operations_custom_column_value/);
  assert.match(cssSource, /nx-co-sheet__context-menu/);
  assert.match(cssSource, /#082447|#0a2d55|#7decf7/i);
});
