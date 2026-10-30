/**
 * Client Operations — palette stacking, hidden new-client toolbar button,
 * saturated status fills, 30% larger selection squares. Presentation only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const css = read('../src/styles/nx-client-operations-spreadsheet.css');
const view = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
const page = read('../src/pages/ClientOperationsRegistry.tsx');
const premium = read('../src/styles/nx-premium-check.css');

test('color palette stacks above the filter bar (z-index / overflow)', () => {
  assert.match(css, /\.nx-co-sheet__toolbar \{[\s\S]*?z-index:\s*12[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.nx-co-sheet__filter-bar \{[\s\S]*?z-index:\s*1/);
  assert.match(css, /\.nx-co-sheet__color-palette \{[\s\S]*?z-index:\s*80/);
  assert.match(css, /\.nx-co-sheet__color-picker-wrap \{[\s\S]*?overflow:\s*visible/);
});

test('לקוח חדש toolbar button is hidden; Core create command remains wired', () => {
  assert.doesNotMatch(view, /data-testid="co-create-core-client"/);
  assert.doesNotMatch(view, /t\('clients\.newClient'\)/);
  assert.match(page, /canCreateCoreClient=\{allowedActions\.includes\('create_core_client'\)\}/);
  assert.match(view, /showCreateClient && canCreateCoreClient/);
  assert.match(view, /submitCreateCoreClient/);
});

test('status paints use saturated ready / sent / completed fills', () => {
  assert.match(css, /td\.is-manual-status-ready \{\s*background:\s*#ffd43b/);
  assert.match(css, /td\.is-manual-status-sent_for_approval \{\s*background:\s*#3478e8/);
  assert.match(css, /td\.is-manual-status-completed \{\s*background:\s*#35d77a/);
  assert.match(view, /\.is-manual-status-ready \{ background: #ffd43b/);
  assert.match(view, /\.is-manual-status-sent_for_approval \{ background: #3478e8/);
  assert.match(view, /\.is-manual-status-completed \{ background: #35d77a/);
  assert.match(css, /status-mode--ready \.nx-co-sheet__status-mode-swatch \{\s*background:\s*#ffd43b/);
  assert.match(css, /status-mode--sent_for_approval \.nx-co-sheet__status-mode-swatch \{\s*background:\s*#3478e8/);
  assert.match(css, /status-mode--completed \.nx-co-sheet__status-mode-swatch \{\s*background:\s*#35d77a/);
});

test('CO sheet squares are 30% larger; other-page premium-check size stays 16px', () => {
  assert.match(css, /\.nx-co-sheet input\[type='checkbox'\][\s\S]*?width:\s*21px[\s\S]*?height:\s*21px/);
  assert.match(css, /\.nx-co-sheet__status-mode-swatch \{\s*width:\s*16px;\s*height:\s*16px/);
  assert.match(css, /\.nx-co-sheet__color-swatch \{\s*width:\s*29px;\s*height:\s*29px/);
  assert.match(css, /\.nx-co-sheet__table td input\[type='checkbox'\][\s\S]*?margin-inline:\s*auto/);
  assert.match(premium, /\.nx-premium-check,[\s\S]*?width:\s*16px;\s*height:\s*16px/);
  assert.match(premium, /\.nx-workspace-panel-root input\[type='checkbox'\]/);
});
