import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clientOperationsMultiSelectTriggerLabel,
  isClientOperationsMultiSelectAll,
  parseClientOperationsMultiSelectCsv,
  toggleClientOperationsMultiSelectCsv,
} from '../src/lib/client-operations-filter-multi-select.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const view = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
const page = read('../src/pages/ClientOperationsRegistry.tsx');
const css = read('../src/styles/nx-client-operations-spreadsheet.css');
const multi = read('../src/components/client-operations/ClientOperationsMultiSelectFilter.tsx');

test('toggle הכל clears specifics; a value deselects הכל; empty is unrestricted', () => {
  assert.equal(toggleClientOperationsMultiSelectCsv(null, 'all'), null);
  assert.equal(toggleClientOperationsMultiSelectCsv('company', 'all'), null);
  assert.equal(toggleClientOperationsMultiSelectCsv(null, 'company'), 'company');
  assert.equal(toggleClientOperationsMultiSelectCsv('company', 'osek_murshe'), 'company,osek_murshe');
  assert.equal(toggleClientOperationsMultiSelectCsv('company,osek_murshe', 'company'), 'osek_murshe');
  assert.equal(toggleClientOperationsMultiSelectCsv('osek_murshe', 'osek_murshe'), null);
  assert.deepEqual(parseClientOperationsMultiSelectCsv('vat_monthly,vat_bimonthly'), [
    'vat_monthly',
    'vat_bimonthly',
  ]);
  assert.equal(isClientOperationsMultiSelectAll(null), true);
  assert.equal(isClientOperationsMultiSelectAll('all'), true);
  assert.equal(isClientOperationsMultiSelectAll('company'), false);
  assert.equal(clientOperationsMultiSelectTriggerLabel('סוג עסק', 'הכל', []), 'הכל');
  assert.equal(clientOperationsMultiSelectTriggerLabel('סוג עסק', 'הכל', ['a', 'b']), 'סוג עסק (2)');
});

test('multi-select is driven by backend selection_mode and aggregate options', () => {
  assert.match(view, /def\.selection_mode === 'multi'/);
  assert.match(view, /ClientOperationsMultiSelectFilter/);
  assert.match(view, /options=\{def\.options\}/);
  assert.doesNotMatch(view, /osek_murshe/);
  assert.doesNotMatch(view, /vat_monthly/);
  assert.doesNotMatch(page, /osek_murshe/);
  assert.match(multi, /aria-haspopup="listbox"/);
  assert.match(multi, /aria-multiselectable="true"/);
  assert.match(multi, /Escape/);
  assert.match(multi, /type="checkbox"/);
});

test('toolbar and six filters stretch across the workspace without stretching buttons', () => {
  assert.match(css, /\.nx-co-sheet__toolbar \{[\s\S]*?justify-content:\s*space-between/);
  assert.match(css, /\.nx-co-sheet__filter-control \{[\s\S]*?flex:\s*1 1 0/);
  assert.match(css, /\.nx-co-sheet__filter-bar-scroll \{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.nx-co-sheet__btn \{[\s\S]*?padding:\s*6px 12px/);
  assert.match(css, /\.nx-co-sheet__filter-multi-menu \{[\s\S]*?inset-inline-start:\s*0/);
  assert.match(css, /\.nx-co-sheet__filter-bar \{[\s\S]*?overflow:\s*visible/);
});

test('month switch keeps the current filter query in session state', () => {
  assert.match(
    page,
    /onPeriodChange[\s\S]*?operationalPeriodKey[\s\S]*?\.\.\.query[\s\S]*?operational_period_key: operationalPeriodKey/,
  );
  assert.match(page, /filter_reporting_type: nextQuery\.filter_reporting_type \?\? null/);
});

test('matching stays on the aggregate path — no FE rows.filter', () => {
  assert.doesNotMatch(view, /rows\.filter\s*\(/);
  assert.doesNotMatch(page, /rows\.filter\s*\(/);
  assert.match(view, /applyBusinessFilterChange[\s\S]*onQueryChange\(/);
});
