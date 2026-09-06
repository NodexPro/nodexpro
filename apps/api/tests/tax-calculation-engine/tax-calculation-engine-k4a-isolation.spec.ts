import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateTaxCalculation,
  hasLatestVersionResolver,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-evaluate.pure.js';

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/tax-calculation-engine');

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(SOURCE_DIR, name));
}

function isCommandBoundaryValidationFile(file: string): boolean {
  return basename(file) === 'tax-calculation-engine-calculate.pure.ts';
}

function assertTenantFieldsAreRejectionOnly(text: string, file: string): void {
  assert.match(text, /'organization_id'/, `${file} must reject organization_id by literal`);
  assert.match(text, /'client_id'/, `${file} must reject client_id by literal`);
  assert.match(text, /does not accept/, `${file} must use command-boundary rejection`);
  assert.doesNotMatch(text, /organization_id\s*[?:]/, `${file} must not model organization_id`);
  assert.doesNotMatch(text, /client_id\s*[?:]/, `${file} must not model client_id`);
}

test('TAX-K4A 22: no latest-version resolver', () => {
  assert.equal(hasLatestVersionResolver(), false);
  mustBlockedMissingLatest();
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('latest_version'), false, file);
    assert.equal(text.includes('resolveLatest'), false, file);
    assert.equal(/latest[-_ ]version/.test(text), false, file);
    if (isCommandBoundaryValidationFile(file)) {
      assertTenantFieldsAreRejectionOnly(text, file);
    } else {
      assert.doesNotMatch(text, /organization_id/, file);
      assert.doesNotMatch(text, /client_id/, file);
    }
    assert.doesNotMatch(text, /\beval\s*\(/);
    assert.doesNotMatch(text, /new Function/);
    assert.doesNotMatch(text, /Math\.round/);
  }
});

function mustBlockedMissingLatest(): void {
  const result = evaluateTaxCalculation({
    expression: { op: 'legal_value', node_id: 'lv', value_key: 'vat_rate' },
    legal_values: [{ legal_value_version_id: 'lv-1', value_key: 'vat_rate', type: 'percentage', value: '17' }],
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected blocked');
  assert.equal(result.blocked.code, 'invalid_expression');
}

test('TAX-K4A 23: no imports from Accounting Base / Work Engine / Income calculator', () => {
  const forbidden = [
    'accounting-base',
    'work-engine',
    'income-draft',
    'income-document-draft-totals',
    'income-draft-line-compute',
    'income-draft-vat',
    '../income/',
    '../accounting-base/',
    '../work-engine/',
  ];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});
