/**
 * Core /clients registry presentation — toolbar, name, columns, checkboxes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, '../src/pages/Clients.tsx'), 'utf8');
const css = readFileSync(join(dir, '../src/styles/nx-clients.css'), 'utf8');

test('toolbar is a single nowrap row; page does not wrap controls', () => {
  assert.match(css, /\.nx-clients-toolbar \{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.nx-clients-toolbar__row \{[\s\S]*flex-wrap:\s*nowrap/);
  assert.doesNotMatch(src, /nx-clients-toolbar__row--split/);
  assert.match(src, /clients\.newClient/);
  assert.match(src, /clients\.importCsv/);
  assert.match(src, /clients\.exportCsv/);
  assert.match(src, /clients\.searchPlaceholder/);
  assert.match(src, /clients\.views\.label/);
  assert.match(src, /clients\.sort\.label/);
  assert.match(src, /clients\.perPage/);
  assert.match(src, /clients\.previous/);
  assert.match(src, /clients\.next/);
});

test('client name is plain text — no card navigation from the list', () => {
  assert.doesNotMatch(src, /nx-clients-table__name/);
  assert.doesNotMatch(src, /navigate\(clientCardPath/);
  assert.doesNotMatch(src, /<a[\s\S]*display_name/);
  assert.match(src, /\{c\.display_name\}/);
});

test('lifecycle column is not rendered; סוג uses backend business_type_display_he', () => {
  assert.doesNotMatch(src, /clients\.table\.lifecycle/);
  assert.doesNotMatch(src, /c\.lifecycle_state/);
  assert.match(src, /c\.business_type_display_he/);
  assert.doesNotMatch(src, /t\(`clients\.type\.\$\{c\.client_type\}`\)/);
  assert.doesNotMatch(src, /statusToUi|TABLE_COLUMNS\.match/);
});

test('tax-id header and cells share a stable aligned column', () => {
  assert.match(src, /nx-clients-table__tax/);
  assert.match(css, /\.nx-clients-table__tax \{[\s\S]*text-align:\s*start/);
  assert.match(css, /\.nx-clients-table__tax \{[\s\S]*white-space:\s*nowrap/);
});

test('row and select-all checkboxes are 22px and scoped to /clients table', () => {
  assert.match(css, /\.nx-clients-table__check input\[type='checkbox'\] \{[\s\S]*width:\s*22px/);
  assert.match(css, /\.nx-clients-table__check input\[type='checkbox'\] \{[\s\S]*height:\s*22px/);
  assert.doesNotMatch(css, /\.nx-co-sheet input\[type='checkbox'\][\s\S]*22px/);
});
