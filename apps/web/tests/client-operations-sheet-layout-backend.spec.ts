import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND } from '../src/lib/client-operations-hidden-columns.pure.js';
import { CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND } from '../src/lib/client-operations-column-widths.pure.js';
import { omitClientOperationsCustomColumnKeys } from '../src/lib/client-operations-column-widths.pure.js';
import { sanitizeClientOperationsHiddenColumnKeys } from '../src/lib/client-operations-hidden-columns.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');

test('one hide toggle and one system resize each fire a single named command', () => {
  assert.equal(CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND, 'set_client_operations_user_hidden_columns');
  assert.equal(
    CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND,
    'set_client_operations_user_system_column_width',
  );
  const hideStart = viewSource.indexOf('const persistHiddenColumns =');
  const hideEnd = viewSource.indexOf('const formatSelectionRowIds =', hideStart);
  const hideSlice = viewSource.slice(hideStart, hideEnd > hideStart ? hideEnd : hideStart + 900);
  assert.match(hideSlice, /command: CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND/);
  assert.equal((hideSlice.match(/onRegistryCommand\(/g) ?? []).length, 1);
  const widthStart = viewSource.indexOf('const persistSystemColumnWidth =');
  const widthEnd = viewSource.indexOf('const persistCustomColumnWidth =', widthStart);
  const widthSlice = viewSource.slice(widthStart, widthEnd > widthStart ? widthEnd : widthStart + 900);
  assert.match(widthSlice, /command: CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND/);
  assert.equal((widthSlice.match(/onRegistryCommand\(/g) ?? []).length, 1);
});

test('custom column width stays on the org-owned command; personal widths omit custom keys', () => {
  assert.match(viewSource, /set_client_operations_custom_column_width/);
  assert.match(viewSource, /if \(column\.cell_kind === 'custom'\) persistCustomColumnWidth/);
  assert.match(viewSource, /else persistSystemColumnWidth/);
  assert.deepEqual(omitClientOperationsCustomColumnKeys({ vat: 160, user_slot_01: 200 }, ['user_slot_01']), {
    vat: 160,
  });
});

test('mandatory columns cannot be hidden; layout is not period-scoped', () => {
  assert.deepEqual(sanitizeClientOperationsHiddenColumnKeys(['folder', 'client_name', 'vat']), ['vat']);
  assert.doesNotMatch(pageSource, /user_hidden_column_keys[\s\S]{0,80}operational_period/);
  assert.doesNotMatch(viewSource, /userHiddenColumnKeys[\s\S]{0,80}operational_period_key/);
  assert.match(pageSource, /setUserHiddenColumnKeys/);
  assert.match(pageSource, /setUserSystemColumnWidths/);
});

test('reload hydrate uses aggregate truth, not localStorage', () => {
  assert.match(viewSource, /sanitizeClientOperationsHiddenColumnKeys\(userHiddenColumnKeys/);
  assert.match(viewSource, /omitClientOperationsCustomColumnKeys\(userSystemColumnWidths/);
  assert.doesNotMatch(viewSource, /loadClientOperationsHiddenColumns\(/);
  assert.doesNotMatch(viewSource, /saveClientOperationsColumnWidths\(/);
});
