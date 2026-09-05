import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

test('TAX-K4A 22: no latest-version resolver', () => {
  assert.equal(hasLatestVersionResolver(), false);
  mustBlockedMissingLatest();
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('latest_version'), false, file);
    assert.equal(text.includes('resolveLatest'), false, file);
    assert.equal(/latest[-_ ]version/.test(text), false, file);
    assert.doesNotMatch(text, /organization_id/);
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
