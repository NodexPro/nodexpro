import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatCustomExcelCellDisplay,
  isSystemDashDisplayAllowed,
} from '../src/lib/client-operations-custom-cell-display.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);
const savePureSource = readFileSync(
  join(dir, '../src/lib/client-operations-custom-cell-save.pure.ts'),
  'utf8',
);

test('1-2: empty USER cell renders blank, never em-dash', () => {
  assert.equal(formatCustomExcelCellDisplay(null), '');
  assert.equal(formatCustomExcelCellDisplay(''), '');
  assert.equal(formatCustomExcelCellDisplay('—'), '');
  assert.equal(formatCustomExcelCellDisplay('-'), '');
  assert.equal(formatCustomExcelCellDisplay('הערה'), 'הערה');
  assert.match(viewSource, /formatCustomExcelCellDisplay/);
  assert.match(
    viewSource,
    /if \(col\.cell_kind === 'custom'\) return displayCustomColumnValue\(r, col\);/,
  );
  assert.doesNotMatch(
    viewSource,
    /if \(col\.cell_kind === 'custom'\) return '—'/,
  );
});

test('3: system N/A / empty can still render em-dash', () => {
  assert.equal(isSystemDashDisplayAllowed('checkbox'), true);
  assert.equal(isSystemDashDisplayAllowed('text'), true);
  assert.equal(isSystemDashDisplayAllowed('custom'), false);
  assert.match(viewSource, /if \(value == null \|\| value === ''\) return '—'/);
});

test('4-5: editor fills entire custom cell; no nested input chrome', () => {
  assert.match(cssSource, /\.nx-co-sheet__custom-cell-input\s*\{[^}]*border:\s*0/s);
  assert.match(cssSource, /\.nx-co-sheet__custom-cell-input\s*\{[^}]*outline:\s*0/s);
  assert.match(cssSource, /\.nx-co-sheet__custom-cell-input\s*\{[^}]*background:\s*transparent/s);
  assert.match(cssSource, /\.nx-co-sheet__custom-cell-input\s*\{[^}]*width:\s*100%/s);
  assert.match(cssSource, /\.nx-co-sheet__custom-cell-input\s*\{[^}]*height:\s*100%/s);
  assert.match(cssSource, /\.nx-co-sheet__table td\.is-editing-custom/);
  assert.doesNotMatch(cssSource, /\.nx-co-sheet__custom-cell-input[^{]*\{[^}]*border:\s*1px solid/s);
});

test('6-8: single click activates editor with immediate focus/value', () => {
  assert.match(viewSource, /beginCustomCellEdit/);
  assert.match(viewSource, /beginCustomCellEdit\(row, column\)/);
  assert.match(viewSource, /autoFocus/);
  assert.match(viewSource, /setCellDraft\(displayCustomColumnValue\(row, column\)\)/);
  // Spreadsheet path: single-click via td → beginCustomCellEdit (no button chrome).
  assert.match(viewSource, /is-editing-custom/);
  assert.doesNotMatch(viewSource, /nx-co-sheet__custom-cell-input[\s\S]{0,200}title="לחיצה לעריכה"/);
});

test('9: clicking another cell flushes previous dirty draft', () => {
  assert.match(viewSource, /onBlur=\{\(\) => void commitCustomCellEdit/);
  assert.match(viewSource, /clearEditingKey/);
  assert.match(
    viewSource,
    /setEditingCellKey\(\(current\) => \(current === options\.clearEditingKey \? null : current\)\)/,
  );
});

test('10-15: autosave / concurrency / Enter / blur / period flush preserved', () => {
  assert.match(viewSource, /500/);
  assert.match(viewSource, /scheduleCustomCellAutosave/);
  assert.match(viewSource, /tryStartCustomCellSave/);
  assert.match(viewSource, /rememberCustomCellDraft/);
  assert.match(viewSource, /shouldApplyCellSaveAggregate/);
  assert.match(viewSource, /applyAggregate:\s*false/);
  assert.match(viewSource, /event\.key === 'Enter'/);
  assert.match(viewSource, /flushDirtyBeforePeriodChange/);
  assert.match(savePureSource, /completeCustomCellSaveSuccess/);
  assert.match(savePureSource, /customCellSaveKey/);
});

test('16-18: gear only on custom columns; isolated from rename/resize', () => {
  assert.match(viewSource, /nx-co-sheet__col-gear/);
  assert.match(viewSource, /settings_available/);
  assert.match(viewSource, /cell_kind === 'custom'[\s\S]*nx-co-sheet__col-gear/);
  assert.match(viewSource, /openColumnSettings\(column\)/);
  assert.match(viewSource, /nx-co-sheet__resize-handle/);
  assert.match(viewSource, /beginResize\(event, column\)/);
  assert.match(cssSource, /\.nx-co-sheet__col-gear-icon\s*\{[^}]*width:\s*17px/s);
  assert.match(cssSource, /\.nx-co-sheet__col-gear\s*\{[^}]*width:\s*28px/s);
  assert.match(cssSource, /\.nx-co-sheet__col-gear\s*\{[^}]*height:\s*28px/s);
  assert.match(cssSource, /#123756|var\(--nx-co-brand\)/);
});

test('blank custom display never falls back to NBSP content', () => {
  assert.doesNotMatch(
    viewSource,
    /displayCustomColumnValue[\s\S]{0,120}\\u00A0/,
  );
  assert.doesNotMatch(
    viewSource,
    /formatPresentationValue\(\s*displayCustomColumnValue[\s\S]{0,80}\|\| '\\u00A0'/,
  );
});
