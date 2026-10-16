/**
 * Client Operations registry: navy text default, accidental purple, premium checkboxes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_REGISTRY_NAVY_TEXT,
  isAccidentalRegistryPurpleText,
  resolveRegistryCellTextColor,
} from '../src/lib/client-operations-registry-text-color.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSrc = readFileSync(join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'), 'utf8');
const checkCss = readFileSync(join(dir, '../src/styles/nx-premium-check.css'), 'utf8');
const sheetCss = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const workspaceSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');

test('unpainted registry cells use navy; brand-token purple is accidental', () => {
  assert.equal(CLIENT_OPERATIONS_REGISTRY_NAVY_TEXT, '#102a4c');
  assert.equal(isAccidentalRegistryPurpleText('#6657e8'), true);
  assert.equal(isAccidentalRegistryPurpleText('#8074f2'), true);
  assert.equal(isAccidentalRegistryPurpleText('#9d4edd'), false);
  assert.equal(resolveRegistryCellTextColor(undefined), undefined);
  assert.equal(resolveRegistryCellTextColor('#6657e8'), CLIENT_OPERATIONS_REGISTRY_NAVY_TEXT);
  assert.equal(resolveRegistryCellTextColor('#111827'), '#111827');
  assert.match(viewSrc, /color: resolveRegistryCellTextColor\(presentation\?\.color\)/);
  assert.match(sheetCss, /\.nx-co-sheet__table td \{\s*color: var\(--nx-text-primary\)/);
});

test('reusable premium checkbox styles cover registry and workspace native checkboxes', () => {
  assert.match(checkCss, /\.nx-premium-check/);
  assert.match(checkCss, /\.nx-co-sheet input\[type='checkbox'\]/);
  assert.match(checkCss, /\.nx-workspace-panel-root input\[type='checkbox'\]/);
  assert.match(checkCss, /:focus-visible/);
  assert.match(checkCss, /:disabled/);
  assert.match(checkCss, /:indeterminate/);
  assert.match(checkCss, /\.nx-fees-switch input\[type='checkbox'\]/);
  assert.match(sheetCss, /nx-premium-check\.css/);
  assert.match(workspaceSrc, /nx-premium-check\.css/);
  assert.match(viewSrc, /className="nx-co-sheet__checkbox"/);
  assert.match(viewSrc, /disabled=\{!active \|\| !canEdit/);
});
