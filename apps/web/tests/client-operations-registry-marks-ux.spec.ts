/**
 * Client Operations registry mark UX — pending state, localized notice, scroll contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localizeClientOperationsRegistryCommandError,
  resolveClientOperationsRegistryCommandErrorKey,
} from '../src/lib/client-operations-registry-command-error.pure';

const dir = dirname(fileURLToPath(import.meta.url));
const view = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const css = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const service = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  clientOperations: { registry: { errors: Record<string, string> } };
};
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  clientOperations: { registry: { errors: Record<string, string> } };
};

test('registry loads every authorized row — no FE/API page slice on the sheet', () => {
  assert.doesNotMatch(service, /builtRows\.slice\(/);
  assert.doesNotMatch(service, /page_size|has_more|offset \+/);
  assert.match(css, /\.nx-co-sheet__canvas \{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.nx-co-sheet__table thead th \{[\s\S]*position:\s*sticky/);
});

test('payroll not-applicable code localizes through i18n, not a hardcoded language', () => {
  const key = resolveClientOperationsRegistryCommandErrorKey({
    code: 'CLIENT_OPERATIONS_PAYROLL_NOT_APPLICABLE',
  });
  assert.equal(key, 'clientOperations.registry.errors.payrollNotApplicable');
  const dict = {
    'clientOperations.registry.errors.payrollNotApplicable':
      he.clientOperations.registry.errors.payrollNotApplicable,
  };
  const heMsg = localizeClientOperationsRegistryCommandError(
    { code: 'CLIENT_OPERATIONS_PAYROLL_NOT_APPLICABLE', message: 'Payroll material is not applicable for this period' },
    (k) => dict[k] ?? k,
    'fallback',
  );
  assert.equal(heMsg, 'חומר שכר אינו רלוונטי לתקופה זו');
  assert.equal(
    en.clientOperations.registry.errors.payrollNotApplicable,
    'Payroll material is not applicable for this period',
  );
  assert.match(view, /localizeClientOperationsRegistryCommandError/);
  assert.doesNotMatch(view, /Payroll material is not applicable for this period/);
});

test('command notice sits next to the sheet and uses the cyan notice class', () => {
  const noticeIdx = view.indexOf('data-testid="client-operations-command-notice"');
  const canvasIdx = view.indexOf('renderSpreadsheetTable()');
  assert.ok(noticeIdx >= 0 && canvasIdx > noticeIdx);
  assert.match(css, /\.nx-co-sheet__command-notice \{[\s\S]*color:\s*#7decf7/);
  assert.doesNotMatch(css, /\.nx-co-sheet__command-notice \{[\s\S]*#b91c1c/);
});

test('mark click uses pending state and never locally flips the business checked value', () => {
  assert.match(view, /pendingMarkKey/);
  assert.match(view, /runMarkCommand/);
  assert.match(view, /aria-busy=\{saving\}/);
  assert.match(view, /if \(!cell\?\.editable\) return/);
  assert.doesNotMatch(view, /checked=\{\s*!current/);
  assert.doesNotMatch(view, /optimisticChecked|localChecked/);
  assert.match(css, /\.nx-co-sheet__material-slot\.is-saving/);
  assert.match(css, /\.nx-co-sheet__table td input\[type='checkbox'\]:checked[\s\S]*box-shadow:\s*none/);
});
