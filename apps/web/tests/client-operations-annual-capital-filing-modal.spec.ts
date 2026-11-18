import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addCalendarMonths,
  buildFilingCalendarCells,
  formatFilingDateDisplay,
  nextAnnualCapitalPendingKind,
  parseIsoDate,
  placeFilingCalendar,
} from '../src/lib/client-operations-filing-date-field.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const modalSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsAnnualCapitalFilingModal.tsx'),
  'utf8',
);
const dateFieldSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsFilingDateField.tsx'),
  'utf8',
);
const cssSource = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const overlayCss = readFileSync(join(dir, '../src/styles/nx-clients.css'), 'utf8');
const heSource = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');
const enSource = readFileSync(join(dir, '../src/i18n/en.json'), 'utf8');
const ruSource = readFileSync(join(dir, '../src/i18n/ru.json'), 'utf8');

test('native date picker is not used in annual/capital filing modals', () => {
  assert.doesNotMatch(modalSource, /type=["']date["']/);
  assert.doesNotMatch(dateFieldSource, /type=["']date["']/);
  assert.doesNotMatch(modalSource, /showPicker/);
  assert.doesNotMatch(dateFieldSource, /showPicker/);
  assert.match(cssSource, /backdrop-filter: blur[\s\S]*custom calendar portaled to document\.body/);
});

test('calendar is a body portal above the modal overlay', () => {
  assert.match(dateFieldSource, /createPortal\(/);
  assert.match(dateFieldSource, /document\.body/);
  assert.match(dateFieldSource, /client-operations-filing-calendar/);
  assert.match(cssSource, /\.nx-co-filing-calendar\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(cssSource, /\.nx-co-filing-calendar\s*\{[\s\S]*?z-index:\s*1200/);
  assert.match(overlayCss, /\.nx-clients-overlay\s*\{[\s\S]*?z-index:\s*80/);
});

test('calendar placement stays on-screen for both RTL and LTR anchors', () => {
  const rtl = placeFilingCalendar({
    anchor: { left: 400, right: 620, top: 120, bottom: 152 },
    viewportWidth: 1280,
    viewportHeight: 720,
    dir: 'rtl',
  });
  assert.ok(rtl.left + rtl.width <= 1280);
  assert.ok(rtl.top >= 8);
  const ltr = placeFilingCalendar({
    anchor: { left: 24, right: 220, top: 640, bottom: 672 },
    viewportWidth: 800,
    viewportHeight: 700,
    dir: 'ltr',
  });
  assert.ok(ltr.top + 20 < 700);
  assert.equal(ltr.left, 24);
});

test('selecting a calendar day yields an ISO date without statutory math', () => {
  assert.deepEqual(parseIsoDate('2026-10-15'), { year: 2026, month: 10, day: 15 });
  assert.equal(parseIsoDate('2026-02-30'), null);
  const cells = buildFilingCalendarCells(2026, 11, 'he');
  assert.equal(cells.length, 42);
  assert.equal(cells[0]?.iso, '2026-11-01');
  const mondayStart = buildFilingCalendarCells(2026, 11, 'en');
  assert.equal(mondayStart[0]?.iso, '2026-10-26');
  assert.deepEqual(addCalendarMonths(2026, 1, -1), { year: 2025, month: 12 });
  assert.match(formatFilingDateDisplay('2026-10-15', 'he'), /15/);
});

test('compact Deep Ocean layout keeps client/target on the start side and date on the end side', () => {
  assert.match(modalSource, /nx-co-annual-capital-modal__identity/);
  assert.match(modalSource, /nx-co-annual-capital-modal__date/);
  assert.match(
    modalSource,
    /nx-co-annual-capital-modal__identity[\s\S]*ClientOperationsFilingDateField/,
  );
  assert.match(cssSource, /grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(0,\s*0\.9fr\)/);
  assert.match(cssSource, /font-family:\s*Arial, sans-serif/);
  assert.match(cssSource, /\.nx-co-annual-capital-modal \.nx-clients-form__body\s*\{[\s\S]*?flex:\s*0 1 auto/);
  assert.match(modalSource, /tax_year_label_key/);
  assert.match(modalSource, /confirmOtherYear/);
});

test('paperclip replaces the attach text button; pending files can be previewed and removed', () => {
  assert.match(modalSource, /client-operations-annual-capital-paperclip/);
  assert.match(modalSource, /clientOperations\.annual\.attachFile/);
  assert.doesNotMatch(modalSource, /clientOperations\.registry\.reporting\.filing\.attach/);
  assert.doesNotMatch(modalSource, />\s*\{t\('clientOperations\.registry\.reporting\.filing\.attach'\)\}/);
  assert.match(modalSource, /onRemovePendingFile/);
  assert.match(modalSource, /clientOperations\.annual\.removeFile/);
  assert.match(modalSource, /previewFile/);
  assert.match(modalSource, /URL\.createObjectURL/);
  assert.match(heSource, /"previewFile": "תצוגה מקדימה"/);
  assert.match(enSource, /"previewFile": "Preview"/);
  assert.match(ruSource, /"previewFile": "Просмотр"/);
});

test('successful filing still uses named commands then closes on refreshed aggregate', () => {
  assert.match(viewSource, /command: 'file_client_operations_annual_report'/);
  assert.match(viewSource, /command: 'file_client_operations_capital_declaration'/);
  assert.match(viewSource, /confirm_other_tax_year: annualCapitalModal\.confirmOtherTaxYear/);
  assert.match(viewSource, /setAnnualCapitalModal\(null\)/);
  const successBranch = viewSource.slice(
    viewSource.indexOf('const confirmAnnualCapitalFiling'),
    viewSource.indexOf('const createColumn'),
  );
  assert.match(successBranch, /setAnnualCapitalModal\(null\)/);
  assert.doesNotMatch(successBranch, /pendingFiles: \[\]/);
});

test('switching tax year does not keep the previous submitted date or tab-year files', () => {
  assert.match(modalSource, /submittedOn: option\?\.submitted_on \?\? ''/);
  assert.match(modalSource, /state\.taxYear !== annualFiling\.tab_tax_year \? \[\] : filing\.modal\.files/);
});

test('annual first attachment stays form 1301; capital and later files stay additional', () => {
  assert.equal(
    nextAnnualCapitalPendingKind({ filingKind: 'annual_report', hasForm1301: false }),
    'form_1301',
  );
  assert.equal(
    nextAnnualCapitalPendingKind({ filingKind: 'annual_report', hasForm1301: true }),
    'additional',
  );
  assert.equal(
    nextAnnualCapitalPendingKind({ filingKind: 'capital_declaration', hasForm1301: false }),
    'additional',
  );
  assert.match(viewSource, /nextAnnualCapitalPendingKind/);
  assert.match(viewSource, /file_client_operations_annual_report/);
  assert.match(viewSource, /file_client_operations_capital_declaration/);
});
