/**
 * Client Operations spreadsheet workspace — FE contract checks (no network).
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

test('uses spreadsheet variant and no Add Client', () => {
  assert.match(pageSource, /variant="spreadsheet"/);
  assert.doesNotMatch(pageSource, /הוסף לקוח/);
  assert.doesNotMatch(viewSource, /הוסף לקוח/);
});

test('keeps folder openClientModal entrypoint', () => {
  assert.match(viewSource, /openClientModal\(r\)/);
  assert.match(viewSource, /📁/);
});

test('renders toolbar from backend capabilities; add_column stays disabled wiring', () => {
  assert.match(pageSource, /toolbarCapabilities/);
  assert.match(viewSource, /capTitle\('add_column'\)/);
  assert.match(viewSource, /customColumnsCapability/);
  assert.match(viewSource, /onRegistryCommand/);
  assert.match(pageSource, /moduleClientOperationsRegistryCommands/);
  assert.doesNotMatch(viewSource, /cells.*localStorage|localStorage.*cells/i);
});

test('does not keep skeleton subtitle on standalone page', () => {
  assert.doesNotMatch(pageSource, /module v1 skeleton/);
});

test('has a shared fullscreen table and scoped width preferences', () => {
  assert.match(viewSource, /fullscreenOpen/);
  assert.match(viewSource, /setFullscreenOpen\(false\)/);
  assert.match(viewSource, /event\.key === 'Escape'/);
  assert.match(viewSource, /renderSpreadsheetTable/);
  assert.match(viewSource, /widthScope/);
  assert.match(viewSource, /saveClientOperationsColumnWidths/);
});
